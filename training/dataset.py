"""Dataset loader and preprocessing for padel shot classification.

Loads exported JSON from the app, preprocesses landmark sequences into
normalized tensors suitable for the TCN classifier.
"""

import json
import numpy as np
import torch
from torch.utils.data import Dataset
from pathlib import Path
from config import (
    SHOT_TYPES,
    NUM_LANDMARKS,
    LANDMARK_DIMS,
    FEATURES_PER_FRAME,
    TOTAL_FEATURES,
    MAX_FRAMES,
    NOISE_STD,
    JITTER_FRAMES,
    FRAME_DROPOUT_RATE,
)


def load_json(path: str | Path) -> dict:
    """Load exported training data JSON."""
    with open(path) as f:
        return json.load(f)


def landmarks_to_array(frames: list[dict]) -> np.ndarray:
    """Convert FrameLandmarks[] JSON to numpy array (num_frames, 33, 4)."""
    result = []
    for frame in frames:
        lms = frame["landmarks"]
        row = [[lm["x"], lm["y"], lm["z"], lm["visibility"]] for lm in lms]
        result.append(row)
    return np.array(result, dtype=np.float32)


def normalize_landmarks(arr: np.ndarray) -> np.ndarray:
    """Center on hip midpoint and scale by torso length per frame.

    Args:
        arr: (num_frames, 33, 4) landmark array

    Returns:
        Normalized array of same shape
    """
    out = arr.copy()
    for i in range(len(out)):
        # Hip midpoint (landmarks 23, 24)
        hip_mid = (out[i, 23, :3] + out[i, 24, :3]) / 2.0
        # Translate: subtract hip midpoint from x, y, z (not visibility)
        out[i, :, :3] -= hip_mid

        # Torso length: distance from shoulder midpoint to hip midpoint
        shoulder_mid = (out[i, 11, :3] + out[i, 12, :3]) / 2.0
        torso_len = np.linalg.norm(shoulder_mid)  # hip_mid is now origin
        if torso_len > 1e-6:
            out[i, :, :3] /= torso_len

    return out


def mirror_if_left(arr: np.ndarray, dominant_side: str) -> np.ndarray:
    """Mirror left-dominant players by negating x coordinates."""
    if dominant_side == "left":
        arr = arr.copy()
        arr[:, :, 0] *= -1
    return arr


def compute_velocities(arr: np.ndarray) -> np.ndarray:
    """Compute frame-to-frame velocity features.

    Args:
        arr: (num_frames, 33, 4) normalized landmarks

    Returns:
        (num_frames, 264) array: [positions_flat | velocities_flat]
    """
    num_frames = arr.shape[0]
    flat = arr.reshape(num_frames, -1)  # (num_frames, 132)

    velocities = np.zeros_like(flat)
    velocities[1:] = flat[1:] - flat[:-1]

    return np.concatenate([flat, velocities], axis=1)  # (num_frames, 264)


def find_contact_frame(frames: list[dict], landmarks_arr: np.ndarray) -> int:
    """Find peak wrist velocity frame (contact point)."""
    if len(frames) < 3:
        return len(frames) // 2

    # Use right wrist (index 16) velocity as proxy
    wrist_positions = landmarks_arr[:, 16, :2]  # x, y only
    velocities = np.zeros(len(wrist_positions))
    for i in range(1, len(wrist_positions)):
        velocities[i] = np.linalg.norm(wrist_positions[i] - wrist_positions[i - 1])

    return int(np.argmax(velocities))


def pad_or_truncate(
    features: np.ndarray, contact_frame: int, max_frames: int = MAX_FRAMES
) -> tuple[np.ndarray, np.ndarray]:
    """Pad or truncate to fixed length, centered on contact frame.

    Returns:
        (padded_features, mask) where mask is 1 for real frames, 0 for padding
    """
    num_frames, feat_dim = features.shape
    result = np.zeros((max_frames, feat_dim), dtype=np.float32)
    mask = np.zeros(max_frames, dtype=np.float32)

    if num_frames <= max_frames:
        # Pad: center the sequence
        offset = (max_frames - num_frames) // 2
        result[offset : offset + num_frames] = features
        mask[offset : offset + num_frames] = 1.0
    else:
        # Truncate: center on contact frame
        half = max_frames // 2
        start = max(0, contact_frame - half)
        start = min(start, num_frames - max_frames)
        result[:] = features[start : start + max_frames]
        mask[:] = 1.0

    return result, mask


def preprocess_sample(
    sample: dict, augment: bool = False, jitter: int = 0
) -> tuple[np.ndarray, np.ndarray]:
    """Full preprocessing pipeline for a single sample.

    Returns:
        (features, mask) where features is (MAX_FRAMES, TOTAL_FEATURES)
    """
    landmarks = landmarks_to_array(sample["landmarks"])
    landmarks = normalize_landmarks(landmarks)
    landmarks = mirror_if_left(landmarks, sample["dominantSide"])

    contact = find_contact_frame(sample["landmarks"], landmarks)

    if augment and jitter != 0:
        contact = max(0, min(len(landmarks) - 1, contact + jitter))

    features = compute_velocities(landmarks)

    padded, mask = pad_or_truncate(features, contact)

    if augment:
        # Gaussian noise on position features (first 132 dims)
        noise = np.random.normal(0, NOISE_STD, (MAX_FRAMES, FEATURES_PER_FRAME))
        padded[:, :FEATURES_PER_FRAME] += noise.astype(np.float32)
        padded[:, :FEATURES_PER_FRAME] *= mask[:, None]  # zero out padding

        # Random frame dropout
        drop_mask = np.random.random(MAX_FRAMES) > FRAME_DROPOUT_RATE
        drop_mask = drop_mask | (mask == 0)  # don't drop already-padded frames
        padded *= drop_mask[:, None].astype(np.float32)

    return padded, mask


class PadelShotDataset(Dataset):
    """PyTorch Dataset for padel shot classification."""

    def __init__(self, samples: list[dict], augment: bool = False):
        self.samples = samples
        self.augment = augment
        self.label_map = {name: i for i, name in enumerate(SHOT_TYPES)}

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        sample = self.samples[idx]
        jitter = (
            np.random.randint(-JITTER_FRAMES, JITTER_FRAMES + 1)
            if self.augment
            else 0
        )

        features, mask = preprocess_sample(sample, augment=self.augment, jitter=jitter)
        label = self.label_map[sample["shotType"]]

        return (
            torch.from_numpy(features),
            torch.from_numpy(mask),
            torch.tensor(label, dtype=torch.long),
        )


def load_dataset(json_path: str | Path) -> list[dict]:
    """Load and validate training data from exported JSON."""
    data = load_json(json_path)
    samples = data["samples"]

    valid = []
    for s in samples:
        if s["shotType"] not in SHOT_TYPES:
            print(f"Warning: skipping unknown shot type '{s['shotType']}' (id={s['id']})")
            continue
        if len(s["landmarks"]) < 10:
            print(f"Warning: skipping sample with only {len(s['landmarks'])} frames (id={s['id']})")
            continue
        valid.append(s)

    print(f"Loaded {len(valid)} valid samples from {len(samples)} total")

    # Print class distribution
    from collections import Counter
    dist = Counter(s["shotType"] for s in valid)
    for shot_type in SHOT_TYPES:
        count = dist.get(shot_type, 0)
        pro = sum(1 for s in valid if s["shotType"] == shot_type and s.get("isProReference"))
        print(f"  {shot_type}: {count} ({pro} pro)")

    return valid
