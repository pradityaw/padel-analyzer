#!/usr/bin/env python3
"""Bulk process video clips: extract landmarks via MediaPipe Python,
run swing analysis, and save results to the padel analyzer database.

Usage:
    pip install mediapipe opencv-python
    python3 scripts/bulk_process.py <clips_dir> [--pro] [--shot-type volley]

This replicates the app's client-side MediaPipe + swingAnalyzer pipeline
but runs server-side for batch processing.
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision


# ── Landmark extraction ──────────────────────────────────────────────

def extract_landmarks(video_path: str, sample_fps: int = 15) -> list[dict]:
    """Extract pose landmarks from video using MediaPipe Pose Landmarker.

    Returns list of FrameLandmarks matching the app's TypeScript format:
    { frameIndex, timestamp, landmarks: [{x, y, z, visibility}, ...] }
    """
    # Download model if not cached
    model_path = Path(__file__).parent / "pose_landmarker_full.task"
    if not model_path.exists():
        print("  Downloading MediaPipe pose model...")
        import urllib.request
        url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
        urllib.request.urlretrieve(url, str(model_path))

    # Create landmarker
    base_options = mp_python.BaseOptions(model_asset_path=str(model_path))
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    landmarker = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / video_fps if video_fps > 0 else 0
    frame_interval = max(1, int(video_fps / sample_fps))

    frames_data = []
    frame_idx = 0
    sample_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp_ms = int((frame_idx / video_fps) * 1000)

            # Convert to MediaPipe image
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)

            # Detect pose
            result = landmarker.detect_for_video(mp_image, timestamp_ms)

            if result.pose_landmarks and len(result.pose_landmarks) > 0:
                landmarks = []
                h, w = frame.shape[:2]
                for lm in result.pose_landmarks[0]:
                    landmarks.append({
                        "x": round(lm.x, 6),
                        "y": round(lm.y, 6),
                        "z": round(lm.z, 6),
                        "visibility": round(lm.visibility, 4),
                    })

                frames_data.append({
                    "frameIndex": sample_idx,
                    "timestamp": timestamp_ms,
                    "landmarks": landmarks,
                })

            sample_idx += 1
        frame_idx += 1

    cap.release()
    landmarker.close()

    return frames_data


# ── Swing analysis (mirrors swingAnalyzer.ts) ─────────────────────────

def vec2_angle(ax, ay, bx, by):
    return abs(math.degrees(math.atan2(by - ay, bx - ax)))


def angle_between(a, b, c):
    """Angle at vertex b."""
    ba = (a["x"] - b["x"], a["y"] - b["y"])
    bc = (c["x"] - b["x"], c["y"] - b["y"])
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.sqrt(ba[0]**2 + ba[1]**2)
    mag_bc = math.sqrt(bc[0]**2 + bc[1]**2)
    if mag_ba == 0 or mag_bc == 0:
        return 0
    cos_angle = max(-1, min(1, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cos_angle))


def distance(a, b):
    return math.sqrt((a["x"] - b["x"])**2 + (a["y"] - b["y"])**2)


LM = {
    "LEFT_SHOULDER": 11, "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13, "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15, "RIGHT_WRIST": 16,
    "LEFT_HIP": 23, "RIGHT_HIP": 24,
    "LEFT_KNEE": 25, "RIGHT_KNEE": 26,
    "LEFT_ANKLE": 27, "RIGHT_ANKLE": 28,
}


def detect_dominant_side(frames):
    left_activity = 0
    right_activity = 0
    for i in range(1, len(frames)):
        prev = frames[i-1]["landmarks"]
        curr = frames[i]["landmarks"]
        left_activity += distance(prev[LM["LEFT_WRIST"]], curr[LM["LEFT_WRIST"]])
        right_activity += distance(prev[LM["RIGHT_WRIST"]], curr[LM["RIGHT_WRIST"]])
    return "right" if right_activity >= left_activity else "left"


def extract_metrics(landmarks, dominant, prev_landmarks=None, dt=None):
    ls = landmarks[LM["LEFT_SHOULDER"]]
    rs = landmarks[LM["RIGHT_SHOULDER"]]
    lh = landmarks[LM["LEFT_HIP"]]
    rh = landmarks[LM["RIGHT_HIP"]]

    shoulder_rot = vec2_angle(ls["x"], ls["y"], rs["x"], rs["y"])
    hip_rot = vec2_angle(lh["x"], lh["y"], rh["x"], rh["y"])

    side = "RIGHT" if dominant == "right" else "LEFT"
    shoulder = landmarks[LM[f"{side}_SHOULDER"]]
    elbow = landmarks[LM[f"{side}_ELBOW"]]
    wrist = landmarks[LM[f"{side}_WRIST"]]
    hip = landmarks[LM[f"{side}_HIP"]]
    knee = landmarks[LM[f"{side}_KNEE"]]
    ankle = landmarks[LM[f"{side}_ANKLE"]]

    elbow_angle = angle_between(shoulder, elbow, wrist)
    knee_flex = angle_between(hip, knee, ankle)

    shoulder_mid = {"x": (ls["x"]+rs["x"])/2, "y": (ls["y"]+rs["y"])/2}
    hip_mid = {"x": (lh["x"]+rh["x"])/2, "y": (lh["y"]+rh["y"])/2}
    spine_angle = abs(90 - abs(vec2_angle(hip_mid["x"], hip_mid["y"],
                                           shoulder_mid["x"], shoulder_mid["y"])))

    wrist_vel = 0
    if prev_landmarks and dt and dt > 0:
        prev_wrist = prev_landmarks[LM[f"{side}_WRIST"]]
        wrist_vel = distance(wrist, prev_wrist) / dt

    return {
        "shoulderRotation": round(shoulder_rot, 2),
        "hipRotation": round(hip_rot, 2),
        "elbowAngle": round(elbow_angle, 2),
        "kneeFlex": round(knee_flex, 2),
        "spineAngle": round(spine_angle, 2),
        "wristVelocity": round(wrist_vel, 4),
    }


def detect_phases(frames, dominant):
    if len(frames) < 10:
        return []

    metrics_per_frame = []
    for i, frame in enumerate(frames):
        prev = frames[i-1]["landmarks"] if i > 0 else None
        dt = (frames[i]["timestamp"] - frames[i-1]["timestamp"]) / 1000 if i > 0 else None
        metrics_per_frame.append(extract_metrics(frame["landmarks"], dominant, prev, dt))

    # Find peak wrist velocity (contact)
    peak_vel = 0
    peak_frame = 0
    for i, m in enumerate(metrics_per_frame):
        if m["wristVelocity"] > peak_vel:
            peak_vel = m["wristVelocity"]
            peak_frame = i

    contact_start = max(0, peak_frame - 3)
    contact_end = min(len(frames) - 1, peak_frame + 3)

    vel_threshold = peak_vel * 0.15
    backswing_start = 0
    for i in range(contact_start - 1, -1, -1):
        if metrics_per_frame[i]["wristVelocity"] < vel_threshold:
            backswing_start = i
            break

    forward_start = backswing_start + int((contact_start - backswing_start) * 0.5)

    follow_end = len(frames) - 1
    for i in range(contact_end + 1, len(frames)):
        if metrics_per_frame[i]["wristVelocity"] < vel_threshold:
            follow_end = i
            break

    def avg_metrics(start, end):
        sl = metrics_per_frame[start:end+1]
        n = len(sl) or 1
        return {
            key: round(sum(m[key] for m in sl) / n, 2)
            for key in sl[0]
        } if sl else metrics_per_frame[0]

    # Ideal ranges for scoring
    IDEAL_RANGES = {
        "ready": {"kneeFlex": ([150,170], 0.4), "spineAngle": ([0,15], 0.3), "shoulderRotation": ([0,20], 0.3)},
        "backswing": {"shoulderRotation": ([30,60], 0.4), "hipRotation": ([15,35], 0.3), "elbowAngle": ([70,110], 0.3)},
        "forwardSwing": {"shoulderRotation": ([20,50], 0.35), "hipRotation": ([25,50], 0.35), "elbowAngle": ([90,140], 0.3)},
        "contact": {"elbowAngle": ([140,165], 0.3), "shoulderRotation": ([40,60], 0.25), "hipRotation": ([35,55], 0.2), "kneeFlex": ([150,170], 0.15), "spineAngle": ([0,15], 0.1)},
        "followThrough": {"shoulderRotation": ([50,80], 0.4), "elbowAngle": ([100,160], 0.3), "spineAngle": ([0,20], 0.3)},
    }

    def score_phase(phase_type, metrics):
        ranges = IDEAL_RANGES[phase_type]
        total = 0
        total_w = 0
        for key, (rng, weight) in ranges.items():
            val = metrics.get(key, 0)
            lo, hi = rng
            if lo <= val <= hi:
                sc = 100
            else:
                dist = lo - val if val < lo else val - hi
                span = hi - lo or 1
                sc = max(0, 100 - (dist / span) * 100)
            total += sc * weight
            total_w += weight
        return round(total / total_w) if total_w > 0 else 50

    phases = [
        {"type": "ready", "startFrame": 0, "endFrame": backswing_start,
         "metrics": avg_metrics(0, backswing_start)},
        {"type": "backswing", "startFrame": backswing_start, "endFrame": forward_start,
         "metrics": avg_metrics(backswing_start, forward_start)},
        {"type": "forwardSwing", "startFrame": forward_start, "endFrame": contact_start,
         "metrics": avg_metrics(forward_start, contact_start)},
        {"type": "contact", "startFrame": contact_start, "endFrame": contact_end,
         "metrics": avg_metrics(contact_start, contact_end)},
        {"type": "followThrough", "startFrame": contact_end, "endFrame": follow_end,
         "metrics": avg_metrics(contact_end, follow_end)},
    ]

    for p in phases:
        p["score"] = score_phase(p["type"], p["metrics"])

    return phases


def analyze_swing(frames):
    dominant = detect_dominant_side(frames)
    phases = detect_phases(frames, dominant)
    overall = round(sum(p["score"] for p in phases) / len(phases)) if phases else 0
    duration_ms = frames[-1]["timestamp"] if frames else 0

    return {
        "overallScore": overall,
        "dominantSide": dominant,
        "phases": phases,
        "durationMs": duration_ms,
        "frameCount": len(frames),
        "sampleFps": 15,
    }


# ── Database operations ──────────────────────────────────────────────

def save_to_db(db_path, video_name, analysis, frames_data, shot_type=None, is_pro=False):
    """Save analysis results to the padel analyzer SQLite database."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    now = datetime.now().isoformat()

    cursor.execute(
        """INSERT INTO analyses
           (video_file_name, created_at, overall_score, dominant_side,
            duration_ms, frame_count, sample_fps, phases_json, landmarks_json,
            shot_type, shot_confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            video_name, now, analysis["overallScore"], analysis["dominantSide"],
            analysis["durationMs"], analysis["frameCount"], analysis["sampleFps"],
            json.dumps(analysis["phases"]), json.dumps(frames_data),
            shot_type, 1.0 if shot_type else None,
        ),
    )
    analysis_id = cursor.lastrowid

    if is_pro and shot_type:
        cursor.execute(
            """INSERT INTO annotations
               (analysis_id, shot_type, is_pro_reference, annotated_at, notes)
               VALUES (?, ?, 1, ?, ?)""",
            (analysis_id, shot_type, now, f"Bulk processed pro reference"),
        )

    conn.commit()
    conn.close()

    return analysis_id


# ── Main ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Bulk process padel video clips")
    parser.add_argument("clips_dir", help="Directory containing video clips")
    parser.add_argument("--pro", action="store_true", help="Mark as pro reference")
    parser.add_argument("--shot-type", "-s", default=None, help="Shot type label")
    parser.add_argument("--db", default=None, help="Path to padel.db")
    parser.add_argument("--sample-fps", type=int, default=15, help="Sampling FPS")
    args = parser.parse_args()

    clips_dir = Path(args.clips_dir)
    if not clips_dir.exists():
        print(f"Error: directory not found: {clips_dir}")
        sys.exit(1)

    # Find DB
    db_path = args.db or str(Path(__file__).parent.parent / "data" / "padel.db")
    if not os.path.exists(db_path):
        print(f"Error: database not found: {db_path}")
        sys.exit(1)

    # Find video files
    video_exts = {".mp4", ".mov", ".webm", ".avi"}
    video_files = sorted(
        f for f in clips_dir.iterdir()
        if f.suffix.lower() in video_exts
    )

    if not video_files:
        print(f"No video files found in {clips_dir}")
        sys.exit(0)

    print(f"Found {len(video_files)} video clips in {clips_dir}")
    if args.pro:
        print("Mode: PRO REFERENCE")
    if args.shot_type:
        print(f"Shot type: {args.shot_type}")
    print(f"Database: {db_path}")
    print()

    processed = 0
    failed = 0
    total_frames = 0

    for i, video_path in enumerate(video_files):
        print(f"[{i+1}/{len(video_files)}] {video_path.name}")

        try:
            # Extract landmarks
            frames = extract_landmarks(str(video_path), args.sample_fps)
            if len(frames) < 5:
                print(f"  → Skipped: only {len(frames)} frames detected")
                failed += 1
                continue

            # Analyze swing
            analysis = analyze_swing(frames)
            total_frames += len(frames)

            # Save to database
            analysis_id = save_to_db(
                db_path, video_path.name, analysis, frames,
                shot_type=args.shot_type, is_pro=args.pro,
            )

            phases_summary = ", ".join(
                f"{p['type']}:{p['score']}" for p in analysis["phases"]
            )
            print(f"  → #{analysis_id}: {len(frames)} frames, "
                  f"score={analysis['overallScore']}, "
                  f"{analysis['dominantSide']}-hand")
            print(f"    Phases: {phases_summary}")

            processed += 1

        except Exception as e:
            print(f"  → FAILED: {e}")
            failed += 1

    print(f"\nDone: {processed} processed, {failed} failed, {total_frames} total frames")
    if args.pro and args.shot_type:
        print(f"All clips annotated as '{args.shot_type}' pro references.")
        print(f"\nYou can now:")
        print(f"  1. View results in the app at / (Sessions)")
        print(f"  2. Compare with your swings at /pro-compare")
        print(f"  3. Export training data from /annotate")


if __name__ == "__main__":
    main()
