"""Compute per-shot-type ideal angle ranges from pro player data.

Replaces the hardcoded IDEAL_RANGES in swingAnalyzer.ts with data-driven
ranges derived from professional player samples.
"""

import argparse
import json
import numpy as np
from collections import defaultdict
from pathlib import Path

from config import SHOT_TYPES, EXPORT_DIR
from dataset import load_dataset


# Metric extraction matching swingAnalyzer.ts extractMetrics()
LM = {
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
    "LEFT_KNEE": 25,
    "RIGHT_KNEE": 26,
    "LEFT_ANKLE": 27,
    "RIGHT_ANKLE": 28,
}

PHASE_TYPES = ["ready", "backswing", "forwardSwing", "contact", "followThrough"]

METRIC_NAMES = [
    "shoulderRotation",
    "hipRotation",
    "elbowAngle",
    "kneeFlex",
    "spineAngle",
    "wristVelocity",
]


def vec2_angle(ax, ay, bx, by):
    return abs(np.degrees(np.arctan2(by - ay, bx - ax)))


def angle_between(a, b, c):
    """Angle at vertex b formed by points a-b-c."""
    ba = np.array([a[0] - b[0], a[1] - b[1]])
    bc = np.array([c[0] - b[0], c[1] - b[1]])
    dot = np.dot(ba, bc)
    mag_ba = np.linalg.norm(ba)
    mag_bc = np.linalg.norm(bc)
    if mag_ba == 0 or mag_bc == 0:
        return 0
    cos_angle = np.clip(dot / (mag_ba * mag_bc), -1, 1)
    return np.degrees(np.arccos(cos_angle))


def extract_metrics_from_landmarks(landmarks, dominant):
    """Extract PhaseMetrics from a single frame's landmarks (matching TS logic)."""
    lms = landmarks

    ls = lms[LM["LEFT_SHOULDER"]]
    rs = lms[LM["RIGHT_SHOULDER"]]
    lh = lms[LM["LEFT_HIP"]]
    rh = lms[LM["RIGHT_HIP"]]

    shoulder_rot = vec2_angle(ls["x"], ls["y"], rs["x"], rs["y"])
    hip_rot = vec2_angle(lh["x"], lh["y"], rh["x"], rh["y"])

    side = "RIGHT" if dominant == "right" else "LEFT"
    shoulder = lms[LM[f"{side}_SHOULDER"]]
    elbow = lms[LM[f"{side}_ELBOW"]]
    wrist = lms[LM[f"{side}_WRIST"]]
    hip = lms[LM[f"{side}_HIP"]]
    knee = lms[LM[f"{side}_KNEE"]]
    ankle = lms[LM[f"{side}_ANKLE"]]

    elbow_angle = angle_between(
        (shoulder["x"], shoulder["y"]),
        (elbow["x"], elbow["y"]),
        (wrist["x"], wrist["y"]),
    )
    knee_flex = angle_between(
        (hip["x"], hip["y"]),
        (knee["x"], knee["y"]),
        (ankle["x"], ankle["y"]),
    )

    shoulder_mid = ((ls["x"] + rs["x"]) / 2, (ls["y"] + rs["y"]) / 2)
    hip_mid = ((lh["x"] + rh["x"]) / 2, (lh["y"] + rh["y"]) / 2)
    spine_angle = abs(
        90 - abs(vec2_angle(hip_mid[0], hip_mid[1], shoulder_mid[0], shoulder_mid[1]))
    )

    return {
        "shoulderRotation": shoulder_rot,
        "hipRotation": hip_rot,
        "elbowAngle": elbow_angle,
        "kneeFlex": knee_flex,
        "spineAngle": spine_angle,
    }


def compute_phase_metrics(sample):
    """Compute average metrics per phase for a sample."""
    phases = sample["phases"]
    frames = sample["landmarks"]
    dominant = sample["dominantSide"]
    results = {}

    for phase in phases:
        phase_type = phase["type"]
        start = phase["startFrame"]
        end = phase["endFrame"]

        phase_frames = frames[start : end + 1]
        if not phase_frames:
            continue

        metrics_list = [
            extract_metrics_from_landmarks(f["landmarks"], dominant)
            for f in phase_frames
        ]

        avg_metrics = {}
        for key in METRIC_NAMES:
            if key == "wristVelocity":
                continue  # velocity depends on timing, skip for ranges
            values = [m[key] for m in metrics_list if key in m]
            if values:
                avg_metrics[key] = np.mean(values)

        results[phase_type] = avg_metrics

    return results


def main():
    parser = argparse.ArgumentParser(description="Compute ideal ranges from pro data")
    parser.add_argument("--data", type=str, required=True, help="Training data JSON")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Use all samples, not just pro references",
    )
    parser.add_argument(
        "--export-benchmarks",
        action="store_true",
        help="Also export pro_benchmarks.json with per-shot-type average metrics",
    )
    args = parser.parse_args()

    samples = load_dataset(args.data)

    if not args.all:
        pro_samples = [s for s in samples if s.get("isProReference")]
        if len(pro_samples) < 5:
            print(
                f"Warning: only {len(pro_samples)} pro samples. "
                f"Using all {len(samples)} samples instead."
            )
            pro_samples = samples
    else:
        pro_samples = samples

    # Collect metrics grouped by (shotType, phaseType)
    grouped = defaultdict(lambda: defaultdict(list))  # shot -> phase -> [metrics]

    for sample in pro_samples:
        shot_type = sample["shotType"]
        phase_metrics = compute_phase_metrics(sample)
        for phase_type, metrics in phase_metrics.items():
            for metric_name, value in metrics.items():
                grouped[shot_type][f"{phase_type}.{metric_name}"].append(value)

    # Compute ranges
    ranges = {}

    # Generic fallback (current hardcoded values from swingAnalyzer.ts)
    ranges["generic"] = {
        "ready": {
            "kneeFlex": {"range": [150, 170], "weight": 0.4},
            "spineAngle": {"range": [0, 15], "weight": 0.3},
            "shoulderRotation": {"range": [0, 20], "weight": 0.3},
        },
        "backswing": {
            "shoulderRotation": {"range": [30, 60], "weight": 0.4},
            "hipRotation": {"range": [15, 35], "weight": 0.3},
            "elbowAngle": {"range": [70, 110], "weight": 0.3},
        },
        "forwardSwing": {
            "shoulderRotation": {"range": [20, 50], "weight": 0.35},
            "hipRotation": {"range": [25, 50], "weight": 0.35},
            "elbowAngle": {"range": [90, 140], "weight": 0.3},
        },
        "contact": {
            "elbowAngle": {"range": [140, 165], "weight": 0.3},
            "shoulderRotation": {"range": [40, 60], "weight": 0.25},
            "hipRotation": {"range": [35, 55], "weight": 0.2},
            "kneeFlex": {"range": [150, 170], "weight": 0.15},
            "spineAngle": {"range": [0, 15], "weight": 0.1},
        },
        "followThrough": {
            "shoulderRotation": {"range": [50, 80], "weight": 0.4},
            "elbowAngle": {"range": [100, 160], "weight": 0.3},
            "spineAngle": {"range": [0, 20], "weight": 0.3},
        },
    }

    # Per-shot-type ranges from data
    for shot_type in SHOT_TYPES:
        if shot_type not in grouped:
            continue

        shot_ranges = {}
        for phase_type in PHASE_TYPES:
            phase_ranges = {}
            metrics_for_phase = {
                k.split(".")[1]: v
                for k, v in grouped[shot_type].items()
                if k.startswith(f"{phase_type}.")
            }

            if not metrics_for_phase:
                continue

            for metric_name, values in metrics_for_phase.items():
                if len(values) < 3:
                    continue  # not enough data

                mean = float(np.mean(values))
                std = float(np.std(values))

                # Range: mean +/- 1 std, clamped to [0, 180]
                lo = max(0, round(mean - std, 1))
                hi = min(180, round(mean + std, 1))

                # Weight: inverse coefficient of variation
                cv = std / mean if mean > 1e-6 else 1.0
                weight = round(1.0 / (1.0 + cv), 3)

                phase_ranges[metric_name] = {"range": [lo, hi], "weight": weight}

            if phase_ranges:
                shot_ranges[phase_type] = phase_ranges

        if shot_ranges:
            ranges[shot_type] = shot_ranges

    # Write output
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = EXPORT_DIR / "shot_type_ranges.json"
    with open(output_path, "w") as f:
        json.dump(ranges, f, indent=2)

    print(f"\nIdeal ranges written to {output_path}")
    for shot_type, phases in ranges.items():
        n_metrics = sum(len(m) for m in phases.values())
        print(f"  {shot_type}: {len(phases)} phases, {n_metrics} metrics")

    # Export pro benchmarks (average metrics per shot type per phase)
    if args.export_benchmarks:
        benchmarks = {}
        for shot_type in SHOT_TYPES:
            shot_samples = [s for s in pro_samples if s["shotType"] == shot_type]
            if not shot_samples:
                continue

            phase_avgs = {}
            for phase_type in PHASE_TYPES:
                metric_avgs = {}
                for metric_name in METRIC_NAMES:
                    if metric_name == "wristVelocity":
                        continue
                    key = f"{phase_type}.{metric_name}"
                    values = grouped[shot_type].get(key, [])
                    if values:
                        metric_avgs[metric_name] = round(float(np.mean(values)), 2)
                if metric_avgs:
                    phase_avgs[phase_type] = metric_avgs

            if phase_avgs:
                benchmarks[shot_type] = {
                    "sampleCount": len(shot_samples),
                    "phases": phase_avgs,
                }

        benchmarks_path = EXPORT_DIR / "pro_benchmarks.json"
        with open(benchmarks_path, "w") as f:
            json.dump(benchmarks, f, indent=2)

        print(f"\nPro benchmarks written to {benchmarks_path}")
        for st, data in benchmarks.items():
            print(f"  {st}: {data['sampleCount']} samples, {len(data['phases'])} phases")


if __name__ == "__main__":
    main()
