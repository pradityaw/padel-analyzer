"""Run one CV analysis agent and emit a compact JSON payload.

Stdout is reserved for the final JSON object. Any diagnostics from imported
modules are redirected to stderr so the Node orchestrator can parse safely.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import inspect
import json
import os
from pathlib import Path
import sys
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from run_pipeline import to_json_safe
from video_source import is_remote_video_uri, open_video_source


def run_court_agent(video_path: str) -> dict[str, Any]:
    import court_mapping

    court = court_mapping.build_court_homography(video_path)
    return {
        "agent": "courtCalibration",
        "court": court,
        "summary": {
            "confidence": float(court.get("confidence", 0.0) or 0.0),
            "has_homography": court.get("homography") is not None,
        },
    }


def _call_ball_tracking_api(
    api: Callable[..., Any],
    video_path: str,
    rally_windows_path: str | None,
) -> Any:
    try:
        signature = inspect.signature(api)
    except (TypeError, ValueError):
        return api(video_path, rally_windows_path=rally_windows_path)

    accepts_kwargs = any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )
    if "rally_windows_path" in signature.parameters or accepts_kwargs:
        return api(video_path, rally_windows_path=rally_windows_path)
    return api(video_path)


def _track_ball_with_tracknet(
    court_mapping: Any,
    video_path: str,
    rally_windows_path: str | None,
) -> dict[str, Any]:
    for function_name in (
        "track_ball_and_shots_tracknet",
        "track_ball_and_shots_with_tracknet",
    ):
        tracker_function = getattr(court_mapping, function_name, None)
        if callable(tracker_function):
            payload = _call_ball_tracking_api(
                tracker_function, video_path, rally_windows_path
            )
            if isinstance(payload, dict):
                return payload
            raise TypeError(
                f"court_mapping.{function_name} returned {type(payload).__name__}"
            )

    tracker_class = getattr(court_mapping, "TrackNetBallTracker", None)
    if not callable(tracker_class):
        raise RuntimeError("court_mapping TrackNet API is unavailable")

    try:
        tracker = tracker_class()
    except TypeError:
        tracker = tracker_class(video_path)

    for method_name in ("track_ball_and_shots", "track_video", "track"):
        tracker_method = getattr(tracker, method_name, None)
        if callable(tracker_method):
            payload = _call_ball_tracking_api(
                tracker_method, video_path, rally_windows_path
            )
            if isinstance(payload, dict):
                return payload
            raise TypeError(
                f"TrackNetBallTracker.{method_name} returned {type(payload).__name__}"
            )

    raise RuntimeError("TrackNetBallTracker has no supported tracking method")


def _track_ball_with_opencv(
    court_mapping: Any,
    video_path: str,
    rally_windows_path: str | None,
) -> dict[str, Any]:
    payload = _call_ball_tracking_api(
        court_mapping.track_ball_and_shots, video_path, rally_windows_path
    )
    if not isinstance(payload, dict):
        raise TypeError("court_mapping.track_ball_and_shots returned a non-object payload")
    return payload


def _ball_agent_payload(
    payload: dict[str, Any],
    backend: str,
    backend_fallback: bool = False,
) -> dict[str, Any]:
    summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
    result_summary: dict[str, Any] = {
        "frames_processed": int(summary.get("frames_processed", 0) or 0),
        "track_points": int(summary.get("track_points", 0) or 0),
        "shot_count": int(summary.get("shot_count", 0) or 0),
        "backend": backend,
    }
    if backend_fallback:
        result_summary["backend_fallback"] = True

    return {
        "agent": "ballTrajectory",
        "court": payload.get("court"),
        "ball_track": payload.get("ball_track", []),
        "shots": payload.get("shots", []),
        "summary": result_summary,
    }


def run_ball_agent(video_path: str, rally_windows_path: str | None = None) -> dict[str, Any]:
    import court_mapping

    requested_backend = (os.environ.get("PADEL_BALL_BACKEND") or "opencv").strip().lower()
    if requested_backend == "tracknet":
        try:
            try:
                from tracknet_ball import tracknet_config_from_env
            except ImportError:
                from scripts.cv.tracknet_ball import tracknet_config_from_env

            config = tracknet_config_from_env()
            model_path = Path(config.model_path)
            print(
                f"[cv-agent:ball] TrackNet model={model_path} exists={model_path.exists()}",
                file=sys.stderr,
            )
            payload = _track_ball_with_tracknet(
                court_mapping, video_path, rally_windows_path
            )
            return _ball_agent_payload(payload, backend="tracknet")
        except Exception as exc:
            print(
                f"[cv-agent:ball] TrackNet backend failed ({exc}); falling back to OpenCV",
                file=sys.stderr,
            )
            payload = _track_ball_with_opencv(
                court_mapping, video_path, rally_windows_path
            )
            return _ball_agent_payload(
                payload, backend="opencv", backend_fallback=True
            )

    if requested_backend not in ("", "opencv"):
        print(
            f"[cv-agent:ball] Unknown PADEL_BALL_BACKEND={requested_backend!r}; using OpenCV",
            file=sys.stderr,
        )

    payload = _track_ball_with_opencv(court_mapping, video_path, rally_windows_path)
    return _ball_agent_payload(payload, backend="opencv")


def _load_landmarks(landmarks_path: str) -> list[dict[str, Any]]:
    with open(landmarks_path, "r", encoding="utf8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError("landmarks file must contain a JSON array of FrameLandmarks")
    return [item for item in payload if isinstance(item, dict)]


def run_racket_agent(
    video_path: str,
    landmarks_path: str | None,
    dominant_side: str,
    player_id: int,
) -> dict[str, Any]:
    """Run the racket-head tracker for a single dominant arm.

    The agent is intentionally cheap when there are no landmarks
    available: instead of crashing it returns an empty payload so the
    orchestrator can degrade gracefully to wrist-as-racket display.
    """

    import racket_tracking

    if not landmarks_path:
        return {
            "agent": "racketTracking",
            "players": [],
            "summary": {
                "sample_count": 0,
                "refined_count": 0,
                "interpolated_count": 0,
                "video_width": 0,
                "video_height": 0,
                "extrapolation_k": float(racket_tracking.RACKET_EXTRAPOLATION_K),
                "reason": "no_landmarks_provided",
            },
        }

    frame_landmarks = _load_landmarks(landmarks_path)
    payload = racket_tracking.track_racket_heads_from_landmarks(
        video_path,
        frame_landmarks,
        dominant_side=dominant_side,
        player_id=player_id,
    )
    payload["agent"] = "racketTracking"
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a single Padel CV agent stage.")
    parser.add_argument(
        "--stage", choices=["court", "ball", "racket"], required=True
    )
    parser.add_argument("--video-path", required=True)
    parser.add_argument(
        "--landmarks-path",
        help="Path to a JSON file containing FrameLandmarks[] (required for --stage=racket).",
    )
    parser.add_argument(
        "--dominant-side",
        choices=["left", "right"],
        default="right",
        help="Dominant arm to track for racket-head extrapolation.",
    )
    parser.add_argument(
        "--player-id",
        type=int,
        default=1,
        help="Player id to tag racket samples with (default: 1).",
    )
    parser.add_argument(
        "--rally-windows",
        dest="rally_windows",
        default=None,
        help="JSON file with active rally windows for ball tracking.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if not is_remote_video_uri(args.video_path) and not os.path.isfile(args.video_path):
            raise FileNotFoundError(f"Video file does not exist: {args.video_path}")
        with open_video_source(args.video_path) as video_path:
            with redirect_stdout(sys.stderr):
                if args.stage == "court":
                    payload = run_court_agent(video_path)
                elif args.stage == "ball":
                    payload = run_ball_agent(video_path, args.rally_windows)
                else:
                    payload = run_racket_agent(
                        video_path,
                        args.landmarks_path,
                        args.dominant_side,
                        args.player_id,
                    )
            print(json.dumps(to_json_safe(payload), allow_nan=False, separators=(",", ":")))
        return 0
    except Exception as exc:
        print(f"[cv-agent:{args.stage}] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

