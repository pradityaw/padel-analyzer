#!/usr/bin/env python3
"""Extract short swing clips from longer padel videos using motion detection.

Scans the video for periods of high motion (indicating active play/swings),
then extracts those segments as individual clips ready for the padel analyzer.

Usage:
    python3 scripts/extract_clips.py <video_path> [--output-dir clips/] [--min-duration 1.5] [--max-duration 6]
"""

import argparse
import subprocess
import json
import os
import sys
from pathlib import Path


def get_video_info(video_path: str) -> dict:
    """Get video metadata using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)


def detect_motion_segments(
    video_path: str,
    threshold: float = 0.02,
    min_duration: float = 1.5,
    max_duration: float = 6.0,
    min_gap: float = 1.0,
):
    """Detect segments with significant motion using ffmpeg scene detection.

    Uses the 'select' filter to find frames with high scene change scores,
    then groups them into continuous motion segments.
    """
    # Use ffmpeg to detect scene changes
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"select='gt(scene,{threshold})',showinfo",
        "-vsync", "vfr",
        "-f", "null", "-"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    # Parse timestamps from showinfo output
    timestamps = []
    for line in result.stderr.split("\n"):
        if "pts_time:" in line:
            try:
                pts_part = line.split("pts_time:")[1].split()[0]
                timestamps.append(float(pts_part))
            except (IndexError, ValueError):
                continue

    if not timestamps:
        print("No motion detected. Try lowering --threshold.")
        return []

    # Group timestamps into segments
    segments = []
    seg_start = timestamps[0]
    seg_end = timestamps[0]

    for ts in timestamps[1:]:
        if ts - seg_end > min_gap:
            # Gap detected — close current segment
            duration = seg_end - seg_start
            if min_duration <= duration <= max_duration:
                segments.append((seg_start, seg_end))
            elif duration > max_duration:
                # Split long segments into max_duration chunks
                t = seg_start
                while t + min_duration <= seg_end:
                    end = min(t + max_duration, seg_end)
                    segments.append((t, end))
                    t = end
            seg_start = ts
        seg_end = ts

    # Don't forget last segment
    duration = seg_end - seg_start
    if min_duration <= duration <= max_duration:
        segments.append((seg_start, seg_end))

    return segments


def extract_clip(
    video_path: str, start: float, end: float, output_path: str
) -> bool:
    """Extract a clip from the video using ffmpeg."""
    duration = end - start
    # Add 0.5s padding on each side for context
    padded_start = max(0, start - 0.5)
    padded_duration = duration + 1.0

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{padded_start:.2f}",
        "-i", video_path,
        "-t", f"{padded_duration:.2f}",
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-an",  # no audio needed for analysis
        "-loglevel", "error",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return result.returncode == 0


def main():
    parser = argparse.ArgumentParser(description="Extract swing clips from padel videos")
    parser.add_argument("video", help="Path to input video")
    parser.add_argument("--output-dir", "-o", default=None, help="Output directory for clips")
    parser.add_argument("--threshold", "-t", type=float, default=0.015,
                        help="Scene change threshold (lower = more sensitive, default 0.015)")
    parser.add_argument("--min-duration", type=float, default=1.5,
                        help="Minimum clip duration in seconds (default 1.5)")
    parser.add_argument("--max-duration", type=float, default=6.0,
                        help="Maximum clip duration in seconds (default 6.0)")
    parser.add_argument("--min-gap", type=float, default=1.0,
                        help="Minimum gap between segments in seconds (default 1.0)")
    parser.add_argument("--prefix", "-p", default=None,
                        help="Filename prefix for clips (default: video filename)")
    args = parser.parse_args()

    video_path = args.video
    if not os.path.exists(video_path):
        print(f"Error: video not found: {video_path}")
        sys.exit(1)

    # Set output directory
    if args.output_dir:
        output_dir = args.output_dir
    else:
        output_dir = os.path.join(os.path.dirname(video_path), "clips")
    os.makedirs(output_dir, exist_ok=True)

    # Set prefix
    prefix = args.prefix or Path(video_path).stem[:20]

    # Get video info
    info = get_video_info(video_path)
    video_stream = next(
        (s for s in info.get("streams", []) if s["codec_type"] == "video"), None
    )
    if video_stream:
        duration = float(info["format"]["duration"])
        print(f"Video: {Path(video_path).name}")
        print(f"Duration: {duration:.1f}s, Resolution: {video_stream['width']}x{video_stream['height']}")
    else:
        print("Error: no video stream found")
        sys.exit(1)

    # Detect motion segments
    print(f"\nScanning for motion segments (threshold={args.threshold})...")
    segments = detect_motion_segments(
        video_path,
        threshold=args.threshold,
        min_duration=args.min_duration,
        max_duration=args.max_duration,
        min_gap=args.min_gap,
    )

    if not segments:
        print("No suitable swing segments found.")
        print("Try: --threshold 0.01 (more sensitive) or --min-duration 1.0 (shorter clips)")
        sys.exit(0)

    print(f"Found {len(segments)} potential swing segments\n")

    # Extract clips
    extracted = 0
    for i, (start, end) in enumerate(segments):
        clip_name = f"{prefix}_clip{i+1:03d}_{start:.1f}s-{end:.1f}s.mp4"
        clip_path = os.path.join(output_dir, clip_name)

        duration = end - start
        print(f"  [{i+1}/{len(segments)}] {start:.1f}s → {end:.1f}s ({duration:.1f}s) → {clip_name}")

        if extract_clip(video_path, start, end, clip_path):
            extracted += 1
        else:
            print(f"    FAILED to extract clip")

    print(f"\nExtracted {extracted}/{len(segments)} clips to {output_dir}/")
    print(f"\nNext steps:")
    print(f"  1. Upload these clips to the padel analyzer app")
    print(f"  2. Go to /annotate to label shot types and mark as 'Pro Reference'")
    print(f"  3. Export training data when you have enough labels")


if __name__ == "__main__":
    main()
