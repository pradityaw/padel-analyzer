#!/usr/bin/env python3
"""Run server-side swing analysis for a single video file.

Outputs a JSON AnalysisResult-compatible payload to stdout.
Accepts a local filesystem path or HTTPS presigned object-store URI.
"""

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

CV_DIR = SCRIPT_DIR / "cv"
if str(CV_DIR) not in sys.path:
    sys.path.insert(0, str(CV_DIR))

from bulk_process import analyze_swing, extract_landmarks
from video_source import open_video_source


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze one padel swing video")
    parser.add_argument(
        "video_source",
        help="Local path or HTTPS URI to the video (presigned object-store URL supported)",
    )
    parser.add_argument("--sample-fps", type=int, default=15, help="Sampling FPS")
    parser.add_argument(
        "--rally-windows",
        dest="rally_windows",
        default=None,
        help="JSON file with active rally windows from dead-time detection",
    )
    args = parser.parse_args()

    try:
        with open_video_source(args.video_source) as video_path:
            frames = extract_landmarks(
                video_path,
                args.sample_fps,
                rally_windows_path=args.rally_windows,
            )
            result = analyze_swing(frames)
            result["frameLandmarks"] = frames
            print(json.dumps(result))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
