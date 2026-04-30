#!/usr/bin/env python3
"""Run server-side swing analysis for a single video file.

Outputs a JSON AnalysisResult-compatible payload to stdout.
"""

import argparse
import json
import sys

from bulk_process import analyze_swing, extract_landmarks


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze one padel swing video")
    parser.add_argument("video_path", help="Absolute path to the local video file")
    parser.add_argument("--sample-fps", type=int, default=15, help="Sampling FPS")
    args = parser.parse_args()

    try:
        frames = extract_landmarks(args.video_path, args.sample_fps)
        result = analyze_swing(frames)
        result["frameLandmarks"] = frames
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
