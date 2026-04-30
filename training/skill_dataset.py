"""Dataset loader for the curated amateur/pro skill model."""

import json
import numpy as np
import torch
from pathlib import Path
from torch.utils.data import Dataset

from config import QUALITY_BANDS, SHOT_TYPES

PHASE_ORDER = ["ready", "backswing", "forwardSwing", "contact", "followThrough"]
METRIC_ORDER = [
    "shoulderRotation",
    "hipRotation",
    "elbowAngle",
    "kneeFlex",
    "spineAngle",
    "wristVelocity",
]
PHASE_METRIC_DIM = len(PHASE_ORDER) * len(METRIC_ORDER)
SHOT_ONE_HOT_DIM = len(SHOT_TYPES)
SKILL_INPUT_DIM = PHASE_METRIC_DIM + SHOT_ONE_HOT_DIM


def load_skill_json(path: str | Path) -> dict:
    with open(path) as f:
        return json.load(f)


def sample_to_feature_vector(sample: dict) -> np.ndarray:
    """Flatten phase metrics + shot one-hot into a single feature vector."""
    phases_by_type = {phase["type"]: phase for phase in sample["phases"]}

    values = []
    for phase_type in PHASE_ORDER:
        metrics = phases_by_type.get(phase_type, {}).get("metrics", {})
        for metric in METRIC_ORDER:
            values.append(float(metrics.get(metric, 0.0)))

    shot_one_hot = np.zeros(SHOT_ONE_HOT_DIM, dtype=np.float32)
    shot_idx = SHOT_TYPES.index(sample["shotType"])
    shot_one_hot[shot_idx] = 1.0

    return np.concatenate([np.array(values, dtype=np.float32), shot_one_hot], axis=0)


class PadelSkillDataset(Dataset):
    """Dataset for predicting a quality band from analyzed swing metrics."""

    def __init__(self, samples: list[dict]):
        self.samples = samples
        self.label_map = {name: i for i, name in enumerate(QUALITY_BANDS)}

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        features = sample_to_feature_vector(sample)
        label = self.label_map[sample["qualityBand"]]
        return torch.from_numpy(features), torch.tensor(label, dtype=torch.long)


def load_skill_dataset(json_path: str | Path) -> list[dict]:
    data = load_skill_json(json_path)
    samples = data.get("samples", [])

    valid = []
    for sample in samples:
        if sample.get("shotType") not in SHOT_TYPES:
            print(f"Warning: skipping unknown shot type for sample {sample.get('id')}")
            continue
        if sample.get("qualityBand") not in QUALITY_BANDS:
            print(f"Warning: skipping unknown quality band for sample {sample.get('id')}")
            continue
        if sample.get("referenceTier") not in {"pro", "amateur_curated"}:
            print(f"Warning: skipping non-reference sample {sample.get('id')}")
            continue
        valid.append(sample)

    print(f"Loaded {len(valid)} valid skill samples from {len(samples)} total")

    from collections import Counter

    label_dist = Counter(sample["qualityBand"] for sample in valid)
    for band in QUALITY_BANDS:
        print(f"  {band}: {label_dist.get(band, 0)}")

    return valid
