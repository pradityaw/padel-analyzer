"""Dataset loader for paired (player, pro) comparison data.

Loads v2.0 exported paired data for future ML-based gap analysis.
Each item preprocesses both player and pro samples using the existing
preprocessing pipeline from dataset.py.
"""

import json
import numpy as np
import torch
from torch.utils.data import Dataset
from pathlib import Path

from config import SHOT_TYPES, MAX_FRAMES, TOTAL_FEATURES
from dataset import preprocess_sample


def load_paired_json(path: str | Path) -> dict:
    """Load v2.0 paired training data JSON."""
    with open(path) as f:
        data = json.load(f)
    assert data.get("version") == "2.0", f"Expected version 2.0, got {data.get('version')}"
    return data


class PadelGapDataset(Dataset):
    """PyTorch Dataset for paired player-pro comparison data.

    Each item returns:
        - player_features: (MAX_FRAMES, TOTAL_FEATURES) tensor
        - player_mask: (MAX_FRAMES,) tensor
        - pro_features: (MAX_FRAMES, TOTAL_FEATURES) tensor
        - pro_mask: (MAX_FRAMES,) tensor
        - gap_target: per-metric importance scores from gap analysis
        - shot_type_label: integer class index
    """

    def __init__(self, pairs: list[dict], augment: bool = False):
        self.pairs = [p for p in pairs if p.get("pro") is not None]
        self.augment = augment
        self.label_map = {name: i for i, name in enumerate(SHOT_TYPES)}

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        pair = self.pairs[idx]

        # Build sample dicts matching the format expected by preprocess_sample
        player_sample = {
            "landmarks": pair["player"]["landmarks"],
            "dominantSide": pair["player"]["dominantSide"],
        }
        pro_sample = {
            "landmarks": pair["pro"]["landmarks"],
            "dominantSide": pair["pro"]["dominantSide"],
        }

        player_features, player_mask = preprocess_sample(
            player_sample, augment=self.augment
        )
        pro_features, pro_mask = preprocess_sample(
            pro_sample, augment=self.augment
        )

        # Extract gap importance targets from stored gap analysis
        gap_analysis = pair.get("gapAnalysis", {})
        metric_gaps = gap_analysis.get("metricGaps", [])

        # Flatten to a fixed-size importance vector
        # Order: 5 phases x 6 metrics = 30 potential slots
        phase_order = ["ready", "backswing", "forwardSwing", "contact", "followThrough"]
        metric_order = [
            "shoulderRotation", "hipRotation", "elbowAngle",
            "kneeFlex", "spineAngle", "wristVelocity",
        ]
        gap_target = np.zeros(len(phase_order) * len(metric_order), dtype=np.float32)

        for mg in metric_gaps:
            phase_idx = phase_order.index(mg["phase"]) if mg["phase"] in phase_order else -1
            metric_idx = metric_order.index(mg["metric"]) if mg["metric"] in metric_order else -1
            if phase_idx >= 0 and metric_idx >= 0:
                gap_target[phase_idx * len(metric_order) + metric_idx] = mg["importance"]

        shot_label = self.label_map.get(pair["shotType"], 0)

        return (
            torch.from_numpy(player_features),
            torch.from_numpy(player_mask),
            torch.from_numpy(pro_features),
            torch.from_numpy(pro_mask),
            torch.from_numpy(gap_target),
            torch.tensor(shot_label, dtype=torch.long),
        )


def load_paired_dataset(json_path: str | Path) -> list[dict]:
    """Load and validate paired training data."""
    data = load_paired_json(json_path)
    pairs = data.get("pairs", [])

    valid = [p for p in pairs if p.get("pro") is not None]
    print(f"Loaded {len(valid)} valid pairs from {len(pairs)} total")

    from collections import Counter
    dist = Counter(p["shotType"] for p in valid)
    for st in SHOT_TYPES:
        print(f"  {st}: {dist.get(st, 0)} pairs")

    return valid
