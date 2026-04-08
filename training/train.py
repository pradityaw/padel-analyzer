"""Training script with stratified k-fold cross-validation."""

import argparse
import json
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torch.optim.lr_scheduler import CosineAnnealingLR
from sklearn.model_selection import StratifiedKFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
from pathlib import Path
from collections import Counter

from config import (
    SHOT_TYPES,
    NUM_CLASSES,
    MAX_FRAMES,
    FEATURES_PER_FRAME,
    LEARNING_RATE,
    BATCH_SIZE,
    MAX_EPOCHS,
    PATIENCE,
    NUM_FOLDS,
    MODEL_DIR,
)
from dataset import load_dataset, PadelShotDataset, preprocess_sample
from model import ShotClassifier, count_parameters


def compute_class_weights(labels: list[int]) -> torch.Tensor:
    """Inverse frequency class weights."""
    counts = Counter(labels)
    total = len(labels)
    weights = torch.zeros(NUM_CLASSES)
    for cls, count in counts.items():
        weights[cls] = total / (NUM_CLASSES * count)
    return weights


def train_one_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0
    correct = 0
    total = 0

    for features, mask, labels in loader:
        features, mask, labels = (
            features.to(device),
            mask.to(device),
            labels.to(device),
        )

        optimizer.zero_grad()
        logits = model(features, mask)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * labels.size(0)
        preds = logits.argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)

    return total_loss / total, correct / total


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss = 0
    all_preds = []
    all_labels = []

    for features, mask, labels in loader:
        features, mask, labels = (
            features.to(device),
            mask.to(device),
            labels.to(device),
        )

        logits = model(features, mask)
        loss = criterion(logits, labels)

        total_loss += loss.item() * labels.size(0)
        all_preds.extend(logits.argmax(dim=1).cpu().tolist())
        all_labels.extend(labels.cpu().tolist())

    total = len(all_labels)
    acc = sum(p == l for p, l in zip(all_preds, all_labels)) / total
    return total_loss / total, acc, all_preds, all_labels


def train_fold(
    fold: int,
    train_samples: list,
    val_samples: list,
    device: torch.device,
) -> tuple[float, list, list]:
    """Train a single fold and return (best_val_acc, val_preds, val_labels)."""
    print(f"\n--- Fold {fold + 1}/{NUM_FOLDS} ---")
    print(f"  Train: {len(train_samples)}, Val: {len(val_samples)}")

    train_ds = PadelShotDataset(train_samples, augment=True)
    val_ds = PadelShotDataset(val_samples, augment=False)

    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False)

    model = ShotClassifier().to(device)

    train_labels = [SHOT_TYPES.index(s["shotType"]) for s in train_samples]
    class_weights = compute_class_weights(train_labels).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)

    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    scheduler = CosineAnnealingLR(optimizer, T_max=MAX_EPOCHS)

    best_val_loss = float("inf")
    best_val_acc = 0
    best_preds = []
    best_labels = []
    patience_counter = 0

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint_path = MODEL_DIR / f"fold_{fold}.pt"

    for epoch in range(MAX_EPOCHS):
        train_loss, train_acc = train_one_epoch(
            model, train_loader, criterion, optimizer, device
        )
        val_loss, val_acc, val_preds, val_labels = evaluate(
            model, val_loader, criterion, device
        )
        scheduler.step()

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_val_acc = val_acc
            best_preds = val_preds
            best_labels = val_labels
            patience_counter = 0
            torch.save(model.state_dict(), checkpoint_path)
        else:
            patience_counter += 1

        if (epoch + 1) % 10 == 0 or patience_counter == 0:
            print(
                f"  Epoch {epoch + 1:3d}: "
                f"train_loss={train_loss:.4f} train_acc={train_acc:.3f} "
                f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}"
                f"{'  *' if patience_counter == 0 else ''}"
            )

        if patience_counter >= PATIENCE:
            print(f"  Early stopping at epoch {epoch + 1}")
            break

    print(f"  Best val accuracy: {best_val_acc:.3f}")
    return best_val_acc, best_preds, best_labels


def train_random_forest_baseline(samples: list):
    """Train a Random Forest baseline on aggregate features for comparison."""
    print("\n=== Random Forest Baseline ===")

    features_list = []
    labels = []

    for sample in samples:
        feats, mask = preprocess_sample(sample, augment=False)
        # Aggregate: mean, std, min, max over time for each feature
        valid = feats[mask.astype(bool)]
        if len(valid) == 0:
            continue

        agg = np.concatenate([
            valid.mean(axis=0),
            valid.std(axis=0),
            valid.min(axis=0),
            valid.max(axis=0),
        ])
        features_list.append(agg)
        labels.append(SHOT_TYPES.index(sample["shotType"]))

    X = np.array(features_list)
    y = np.array(labels)

    skf = StratifiedKFold(n_splits=NUM_FOLDS, shuffle=True, random_state=42)
    all_preds = np.zeros_like(y)

    for fold, (train_idx, val_idx) in enumerate(skf.split(X, y)):
        clf = RandomForestClassifier(
            n_estimators=100, class_weight="balanced", random_state=42
        )
        clf.fit(X[train_idx], y[train_idx])
        all_preds[val_idx] = clf.predict(X[val_idx])

    print(classification_report(y, all_preds, target_names=SHOT_TYPES, zero_division=0))
    return


def main():
    parser = argparse.ArgumentParser(description="Train padel shot classifier")
    parser.add_argument(
        "--data",
        type=str,
        required=True,
        help="Path to exported training data JSON",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        help="Device: cpu, cuda, mps, or auto",
    )
    args = parser.parse_args()

    # Select device
    if args.device == "auto":
        if torch.cuda.is_available():
            device = torch.device("cuda")
        elif torch.backends.mps.is_available():
            device = torch.device("mps")
        else:
            device = torch.device("cpu")
    else:
        device = torch.device(args.device)
    print(f"Using device: {device}")

    # Load data
    samples = load_dataset(args.data)
    if len(samples) < NUM_FOLDS:
        print(f"Error: need at least {NUM_FOLDS} samples for cross-validation")
        return

    labels = [SHOT_TYPES.index(s["shotType"]) for s in samples]

    # Random Forest baseline
    train_random_forest_baseline(samples)

    # TCN cross-validation
    print(f"\n=== TCN Classifier ({count_parameters(ShotClassifier()):,} params) ===")

    skf = StratifiedKFold(n_splits=NUM_FOLDS, shuffle=True, random_state=42)
    all_val_preds = []
    all_val_labels = []
    fold_accs = []

    for fold, (train_idx, val_idx) in enumerate(skf.split(samples, labels)):
        train_samples = [samples[i] for i in train_idx]
        val_samples = [samples[i] for i in val_idx]

        best_acc, preds, fold_labels = train_fold(
            fold, train_samples, val_samples, device
        )
        fold_accs.append(best_acc)
        all_val_preds.extend(preds)
        all_val_labels.extend(fold_labels)

    print(f"\n=== Cross-Validation Results ===")
    print(f"Mean accuracy: {np.mean(fold_accs):.3f} (+/- {np.std(fold_accs):.3f})")
    print(f"\nClassification Report:")
    print(
        classification_report(
            all_val_labels,
            all_val_preds,
            target_names=SHOT_TYPES,
            zero_division=0,
        )
    )
    print(f"Confusion Matrix:")
    print(confusion_matrix(all_val_labels, all_val_preds))

    # Train final model on all data
    print(f"\n=== Training Final Model on All Data ===")
    full_ds = PadelShotDataset(samples, augment=True)
    full_loader = DataLoader(full_ds, batch_size=BATCH_SIZE, shuffle=True)

    model = ShotClassifier().to(device)
    class_weights = compute_class_weights(labels).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    scheduler = CosineAnnealingLR(optimizer, T_max=MAX_EPOCHS)

    for epoch in range(MAX_EPOCHS):
        train_loss, train_acc = train_one_epoch(
            model, full_loader, criterion, optimizer, device
        )
        scheduler.step()
        if (epoch + 1) % 10 == 0:
            print(f"  Epoch {epoch + 1}: loss={train_loss:.4f} acc={train_acc:.3f}")

    final_path = MODEL_DIR / "final_model.pt"
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), final_path)
    print(f"\nFinal model saved to {final_path}")


if __name__ == "__main__":
    main()
