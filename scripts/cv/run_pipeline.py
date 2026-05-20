"""CLI bridge for the server-side OpenCV match analysis pipeline.

Stdout is reserved for the final JSON payload. Diagnostics and unexpected
module output are redirected to stderr so Node can parse stdout safely.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from dataclasses import asdict, is_dataclass
import importlib
import json
import math
import os
from pathlib import Path
import sys
from typing import Any
from urllib.parse import quote

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from dead_time_trimmer import (
    DeadTimeTrimmer,
    Rally,
    TrimmerConfig,
    analyze_video,
    export_condensed_video,
)
from rally_detector import (
    RallyDetectionInputs,
    RallyDetectorConfig,
    detect_rally_windows,
    extract_audio_onsets_ms,
)


def to_json_safe(value: Any) -> Any:
    """Convert numpy/dataclass values into JSON-safe Python primitives."""

    if is_dataclass(value):
        return to_json_safe(asdict(value))
    if isinstance(value, np.ndarray):
        return to_json_safe(value.tolist())
    if isinstance(value, np.generic):
        return to_json_safe(value.item())
    if isinstance(value, dict):
        return {str(key): to_json_safe(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(item) for item in value]
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _load_optional_module(module_name: str) -> Any | None:
    try:
        return importlib.import_module(module_name)
    except ImportError as exc:
        print(f"[cv-pipeline] optional module unavailable: {module_name}: {exc}", file=sys.stderr)
        return None


def _rally_start(rally: dict[str, Any]) -> float:
    return float(rally.get("start", rally.get("start_sec", 0.0)) or 0.0)


def _rally_end(rally: dict[str, Any]) -> float:
    return float(rally.get("end", rally.get("end_sec", 0.0)) or 0.0)


def _shots_for_rally(shots: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    return [
        shot
        for shot in shots
        if start <= float(shot.get("timestamp_sec", shot.get("time", 0.0)) or 0.0) <= end
    ]


def _max_speed_for_rally(
    rally: dict[str, Any],
    ball_points: list[dict[str, Any]],
    start: float,
    end: float,
) -> float:
    speeds = [
        float(point["velocity_px_per_frame"])
        for point in ball_points
        if point.get("velocity_px_per_frame") is not None
        and start <= float(point.get("timestamp_sec", 0.0) or 0.0) <= end
    ]
    if speeds:
        return max(speeds)
    return float(rally.get("max_speed", rally.get("avg_ball_velocity", 0.0)) or 0.0)


def _heatmaps_for_rally(
    player_tracking: dict[str, Any] | None,
    rally_id: int,
    start: float,
    end: float,
) -> list[Any]:
    if not player_tracking:
        return []

    per_rally = player_tracking.get("rallies")
    if isinstance(per_rally, list):
        for item in per_rally:
            if not isinstance(item, dict):
                continue
            item_id = item.get("rally_id")
            same_id = item_id is not None and int(item_id) == rally_id
            same_window = (
                item_id is None
                and abs(float(item.get("start", item.get("start_sec", -1.0))) - start) < 1e-3
                and abs(float(item.get("end", item.get("end_sec", -1.0))) - end) < 1e-3
            )
            if same_id or same_window:
                candidate = item.get("player_heatmaps", item.get("heatmaps", []))
                return candidate if isinstance(candidate, list) else []

    heatmaps = player_tracking.get("player_heatmaps")
    if isinstance(heatmaps, list):
        return heatmaps

    return []


def _call_player_tracking(
    module: Any,
    video_path: str,
    rallies: list[dict[str, Any]],
    ball_tracking: dict[str, Any] | None,
) -> dict[str, Any]:
    analyze = getattr(module, "analyze_player_movement")
    court_payload = (ball_tracking or {}).get("court")
    call_attempts = [
        lambda: analyze(video_path, rallies, court_payload),
        lambda: analyze(video_path, rallies),
        lambda: analyze(video_path),
    ]
    last_error: Exception | None = None
    for call in call_attempts:
        try:
            result = call()
            return result if isinstance(result, dict) else {"result": result}
        except TypeError as exc:
            last_error = exc
            continue
    raise last_error or RuntimeError("player tracking failed")


def _trimmed_video_url(output_path: Path, public_prefix: str) -> str:
    prefix = public_prefix.rstrip("/")
    return f"{prefix}/{quote(output_path.name)}"


def _shot_events_ms_from(ball_tracking: dict[str, Any] | None) -> list[float]:
    """Extract shot/bounce event timestamps (ms) from a court-mapping payload."""

    if not ball_tracking:
        return []
    shots = ball_tracking.get("shots", [])
    if not isinstance(shots, list):
        return []
    out: list[float] = []
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        ts = shot.get("timestamp_sec", shot.get("time"))
        if ts is None:
            continue
        try:
            out.append(float(ts) * 1_000.0)
        except (TypeError, ValueError):
            continue
    return out


def _fuse_rally_windows(
    video_path: str,
    fps: float,
    motion: list[float],
    velocity: list[Any],
    shake: list[float],
    ball_tracking: dict[str, Any] | None,
) -> dict[str, Any]:
    """Run the multi-signal rally detector and return its dict payload."""

    audio_onsets = extract_audio_onsets_ms(video_path)
    shot_events_ms = _shot_events_ms_from(ball_tracking) if ball_tracking else None
    inputs = RallyDetectionInputs(
        fps=fps,
        frame_count=len(motion),
        motion=motion,
        velocity=velocity,
        shake=shake,
        audio_onsets_ms=audio_onsets,
        shot_events_ms=shot_events_ms,
    )
    result = detect_rally_windows(inputs, RallyDetectorConfig())
    return to_json_safe(result.to_dict())


def run_pipeline(
    video_path: str,
    output_dir: str | None = None,
    public_prefix: str | None = None,
    skip_export: bool = False,
) -> dict[str, Any]:
    # Run the trimmer manually so we keep the raw motion/velocity/shake
    # signals available for the multi-signal rally detector (no second pass
    # over the video frames).
    trimmer_cfg = TrimmerConfig()
    trimmer = DeadTimeTrimmer(trimmer_cfg)
    try:
        fps, motion, velocity, shake = trimmer.collect_signals(video_path)
    except FileNotFoundError:
        # Fall back to the original API for parity with the test suite.
        trimming = to_json_safe(analyze_video(video_path))
        rally_detection: dict[str, Any] = {
            "fps": 0.0,
            "frame_count": 0,
            "duration_ms": 0.0,
            "total_active_ms": 0.0,
            "total_dead_ms": 0.0,
            "audio_available": False,
            "capabilities": {},
            "rallies": [],
        }
        fps = 0.0
        motion = []
        velocity = []
        shake = []
    else:
        # Visual-only rally windows from the classic dead-time trimmer.
        if motion:
            activity = trimmer._build_activity_signal(motion, velocity)
            classic_rallies = trimmer._run_state_machine(activity, motion, velocity, fps)
        else:
            classic_rallies = []

        total_duration_sec = float(len(motion) / fps) if fps > 0 else 0.0
        total_active_sec = float(sum(r.duration_sec for r in classic_rallies))
        total_dead_sec = float(max(0.0, total_duration_sec - total_active_sec))
        trim_ratio = (
            float(total_dead_sec / total_duration_sec) if total_duration_sec > 0 else 0.0
        )

        trimming = to_json_safe(
            {
                "rallies": [
                    {
                        "rally_id": int(r.rally_id),
                        "start_sec": float(r.start_sec),
                        "end_sec": float(r.end_sec),
                        "duration_sec": float(r.duration_sec),
                        "avg_motion": float(r.avg_motion),
                        "avg_ball_velocity": float(r.avg_ball_velocity),
                    }
                    for r in classic_rallies
                ],
                "total_active_sec": round(total_active_sec, 4),
                "total_dead_sec": round(total_dead_sec, 4),
                "trim_ratio": round(trim_ratio, 6),
            }
        )

    trim_rallies = trimming.get("rallies", []) if isinstance(trimming, dict) else []
    if not isinstance(trim_rallies, list):
        trim_rallies = []

    trimmed_video_url: str | None = None
    if output_dir and public_prefix and not skip_export and trim_rallies:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        source = Path(video_path)
        output_path = out_dir / f"{source.stem}_condensed.mp4"
        export_condensed_video(video_path, trim_rallies, str(output_path))
        trimmed_video_url = _trimmed_video_url(output_path, public_prefix)

    court_module = _load_optional_module("court_mapping")
    ball_tracking: dict[str, Any] | None = None
    court_mapping_available = bool(court_module and hasattr(court_module, "track_ball_and_shots"))
    if court_mapping_available:
        ball_tracking = to_json_safe(court_module.track_ball_and_shots(video_path))

    # ── Multi-signal rally fusion (audio + motion + velocity + shots) ───
    rally_detection = _fuse_rally_windows(
        video_path,
        fps,
        motion,
        velocity,
        shake,
        ball_tracking,
    )
    fused_rallies: list[dict[str, Any]] = list(rally_detection.get("rallies", []))
    # When the fusion detector returns at least one window, prefer it for the
    # downstream consumers (rally video export, player tracking, scoring) so
    # they all agree on the same set of "active rally windows".
    if fused_rallies:
        trim_rallies = fused_rallies

    player_module = _load_optional_module("player_tracking")
    player_tracking: dict[str, Any] | None = None
    player_tracking_available = bool(player_module and hasattr(player_module, "analyze_player_movement"))
    if player_tracking_available and player_module is not None:
        player_tracking = to_json_safe(
            _call_player_tracking(player_module, video_path, trim_rallies, ball_tracking)
        )

    # Racket-head tracking — depends on MediaPipe-style landmarks, which
    # the match pipeline does not extract. We still expose an empty
    # payload (and a capability flag) so downstream consumers can rely
    # on the field's presence without a feature-flag dance. The mobile /
    # swing analysis flow runs the dedicated `racket` agent stage via
    # `run_agent_stage.py`, where landmarks are available.
    racket_module = _load_optional_module("racket_tracking")
    racket_tracking_available = bool(
        racket_module and hasattr(racket_module, "track_racket_heads_from_landmarks")
    )
    racket_tracking: dict[str, Any] | None = None
    if racket_tracking_available and racket_module is not None:
        racket_tracking = to_json_safe(
            {
                "players": [],
                "summary": {
                    "sample_count": 0,
                    "refined_count": 0,
                    "interpolated_count": 0,
                    "video_width": 0,
                    "video_height": 0,
                    "extrapolation_k": float(
                        getattr(racket_module, "RACKET_EXTRAPOLATION_K", 1.2)
                    ),
                    "reason": "match_pipeline_has_no_landmarks",
                },
            }
        )

    shots = (ball_tracking or {}).get("shots", [])
    if not isinstance(shots, list):
        shots = []
    ball_points = (ball_tracking or {}).get("ball_track", [])
    if not isinstance(ball_points, list):
        ball_points = []

    rallies = []
    for index, rally in enumerate(trim_rallies, start=1):
        if not isinstance(rally, dict):
            continue
        start = _rally_start(rally)
        end = _rally_end(rally)
        rally_id = int(rally.get("rally_id", index))
        signals = rally.get("signals")
        rallies.append(
            {
                "rally_id": rally_id,
                "start": start,
                "end": end,
                "duration_sec": float(rally.get("duration_sec", max(0.0, end - start)) or 0.0),
                "start_ms": float(rally.get("start_ms", start * 1_000.0)),
                "end_ms": float(rally.get("end_ms", end * 1_000.0)),
                "start_frame": rally.get("start_frame"),
                "end_frame": rally.get("end_frame"),
                "confidence": float(rally.get("confidence", 0.0) or 0.0),
                "signals": signals if isinstance(signals, dict) else {},
                "max_speed": _max_speed_for_rally(rally, ball_points, start, end),
                "shot_positions": _shots_for_rally(shots, start, end),
                "player_heatmaps": _heatmaps_for_rally(player_tracking, rally_id, start, end),
            }
        )

    scoring_module = _load_optional_module("scoring")
    scoring: dict[str, Any] | None = None
    scoring_available = bool(scoring_module and hasattr(scoring_module, "score_match"))
    if scoring_available and scoring_module is not None:
        scoring = to_json_safe(
            scoring_module.score_match(trim_rallies, ball_tracking)
        )

    rally_caps = rally_detection.get("capabilities", {}) if isinstance(rally_detection, dict) else {}
    if not isinstance(rally_caps, dict):
        rally_caps = {}

    summary = {
        "rally_count": len(rallies),
        "total_active_sec": float(
            rally_detection.get("total_active_sec", trimming.get("total_active_sec", 0.0)) or 0.0
        ),
        "total_dead_sec": float(
            rally_detection.get("total_dead_sec", trimming.get("total_dead_sec", 0.0)) or 0.0
        ),
        "trim_ratio": float(rally_detection.get("trim_ratio", trimming.get("trim_ratio", 0.0)) or 0.0),
        "shot_count": len(shots),
        "audio_available": bool(rally_detection.get("audio_available", False)),
    }

    return to_json_safe(
        {
            "trimmed_video_url": trimmed_video_url,
            "rallies": rallies,
            "summary": summary,
            "raw": {
                "trimming": trimming,
                "rally_detection": rally_detection,
                "ball_tracking": ball_tracking,
                "player_tracking": player_tracking,
                "racket_tracking": racket_tracking,
                "scoring": scoring,
            },
            "capabilities": {
                "dead_time_trimming": True,
                "court_mapping": court_mapping_available,
                "player_tracking": player_tracking_available,
                "player_tracking_available": player_tracking_available,
                "racket_tracking": racket_tracking_available,
                "scoring": scoring_available,
                "audio_onsets": bool(rally_caps.get("audio", False)),
                "multi_signal_rallies": True,
            },
        }
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Padel OpenCV analysis pipeline.")
    parser.add_argument("--video-path", required=True, help="Path to an uploaded video file.")
    parser.add_argument("--output-dir", help="Directory for the condensed video export.")
    parser.add_argument("--public-prefix", help="Public URL prefix for exported videos.")
    parser.add_argument("--skip-export", action="store_true", help="Skip condensed video export.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if not os.path.isfile(args.video_path):
            raise FileNotFoundError(f"Video file does not exist: {args.video_path}")
        with redirect_stdout(sys.stderr):
            payload = run_pipeline(
                video_path=args.video_path,
                output_dir=args.output_dir,
                public_prefix=args.public_prefix,
                skip_export=args.skip_export,
            )
        print(json.dumps(payload, allow_nan=False, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"[cv-pipeline] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
