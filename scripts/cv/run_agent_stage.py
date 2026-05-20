"""Run one CV analysis agent and emit a compact JSON payload.

Stdout is reserved for the final JSON object. Any diagnostics from imported
modules are redirected to stderr so the Node orchestrator can parse safely.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from run_pipeline import to_json_safe


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


def run_ball_agent(video_path: str) -> dict[str, Any]:
    import court_mapping

    payload = court_mapping.track_ball_and_shots(video_path)
    summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
    return {
        "agent": "ballTrajectory",
        "court": payload.get("court") if isinstance(payload, dict) else None,
        "ball_track": payload.get("ball_track", []) if isinstance(payload, dict) else [],
        "shots": payload.get("shots", []) if isinstance(payload, dict) else [],
        "summary": {
            "frames_processed": int(summary.get("frames_processed", 0) or 0),
            "track_points": int(summary.get("track_points", 0) or 0),
            "shot_count": int(summary.get("shot_count", 0) or 0),
        },
    }


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
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if not os.path.isfile(args.video_path):
            raise FileNotFoundError(f"Video file does not exist: {args.video_path}")
        with redirect_stdout(sys.stderr):
            if args.stage == "court":
                payload = run_court_agent(args.video_path)
            elif args.stage == "ball":
                payload = run_ball_agent(args.video_path)
            else:
                payload = run_racket_agent(
                    args.video_path,
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

