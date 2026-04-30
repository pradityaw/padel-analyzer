"""Train a lightweight skill-band classifier for curated references."""

import argparse
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import classification_report
from sklearn.model_selection import StratifiedShuffleSplit
from torch.utils.data import DataLoader, Subset

from config import BATCH_SIZE, LEARNING_RATE, MAX_EPOCHS, MODEL_DIR, NUM_QUALITY_BANDS, QUALITY_BANDS
from skill_dataset import PadelSkillDataset, load_skill_dataset
from skill_model import SkillClassifier, count_parameters


def compute_class_weights(labels: list[int]) -> torch.Tensor:
    counts = Counter(labels)
    total = len(labels)
    weights = torch.zeros(NUM_QUALITY_BANDS)
    for cls, count in counts.items():
        weights[cls] = total / (NUM_QUALITY_BANDS * count)
    return weights


def compute_normalization(samples: list[dict]) -> tuple[torch.Tensor, torch.Tensor]:
    from skill_dataset import sample_to_feature_vector

    matrix = np.stack([sample_to_feature_vector(sample) for sample in samples])
    mean = torch.from_numpy(matrix.mean(axis=0).astype(np.float32))
    std = torch.from_numpy(matrix.std(axis=0).astype(np.float32))
    return mean, std


def run_epoch(model, loader, criterion, optimizer, device):
    model.train()
    total_loss = 0.0
    preds = []
    labels_all = []

    for features, labels in loader:
        features = features.to(device)
        labels = labels.to(device)
        optimizer.zero_grad()
        logits = model(features)
        loss = criterion(logits, labels)
        loss.backward()
        optimizer.step()

        total_loss += loss.item() * labels.size(0)
        preds.extend(logits.argmax(dim=1).cpu().tolist())
        labels_all.extend(labels.cpu().tolist())

    accuracy = sum(p == y for p, y in zip(preds, labels_all)) / max(len(labels_all), 1)
    return total_loss / max(len(labels_all), 1), accuracy


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()
    total_loss = 0.0
    preds = []
    labels_all = []

    for features, labels in loader:
        features = features.to(device)
        labels = labels.to(device)
        logits = model(features)
        loss = criterion(logits, labels)

        total_loss += loss.item() * labels.size(0)
        preds.extend(logits.argmax(dim=1).cpu().tolist())
        labels_all.extend(labels.cpu().tolist())

    accuracy = sum(p == y for p, y in zip(preds, labels_all)) / max(len(labels_all), 1)
    return total_loss / max(len(labels_all), 1), accuracy, preds, labels_all


def main():
    parser = argparse.ArgumentParser(description="Train curated amateur skill model")
    parser.add_argument("--data", type=str, required=True, help="Path to exported skill data JSON")
    parser.add_argument("--device", type=str, default="auto", help="cpu, cuda, mps, or auto")
    args = parser.parse_args()

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

    samples = load_skill_dataset(args.data)
    if len(samples) < 8:
        raise SystemExit("Need at least 8 curated reference samples to train skill model")

    dataset = PadelSkillDataset(samples)
    labels = [dataset.label_map[sample["qualityBand"]] for sample in samples]
    distinct_labels = sorted(set(labels))
    if len(distinct_labels) < 2:
        raise SystemExit(
            "Need at least 2 quality bands in exportSkillTrainingData to train skill model"
        )

    splitter = StratifiedShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, val_idx = next(splitter.split(np.zeros(len(labels)), labels))
    train_subset = Subset(dataset, train_idx.tolist())
    val_subset = Subset(dataset, val_idx.tolist())

    mean, std = compute_normalization([samples[i] for i in train_idx])

    train_loader = DataLoader(train_subset, batch_size=min(BATCH_SIZE, len(train_subset)), shuffle=True)
    val_loader = DataLoader(val_subset, batch_size=min(BATCH_SIZE, len(val_subset)), shuffle=False)

    model = SkillClassifier().to(device)
    model.set_normalization(mean.to(device), std.to(device))
    class_weights = compute_class_weights([labels[i] for i in train_idx]).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)

    print(f"Skill model params: {count_parameters(model):,}")
    print(f"Train: {len(train_subset)}, Val: {len(val_subset)}")

    best_val_acc = 0.0
    best_state = None
    for epoch in range(MAX_EPOCHS):
        train_loss, train_acc = run_epoch(model, train_loader, criterion, optimizer, device)
        val_loss, val_acc, val_preds, val_labels = evaluate(model, val_loader, criterion, device)

        if val_acc >= best_val_acc:
            best_val_acc = val_acc
            best_state = {key: value.detach().cpu() for key, value in model.state_dict().items()}

        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(
                f"Epoch {epoch + 1:3d}: "
                f"train_loss={train_loss:.4f} train_acc={train_acc:.3f} "
                f"val_loss={val_loss:.4f} val_acc={val_acc:.3f}"
            )

    print(f"Best validation accuracy: {best_val_acc:.3f}")
    print(
        classification_report(
            val_labels,
            val_preds,
            labels=list(range(NUM_QUALITY_BANDS)),
            target_names=QUALITY_BANDS,
            zero_division=0,
        )
    )

    if best_state is not None:
        model.load_state_dict(best_state)

    final_model = SkillClassifier().to(device)
    final_mean, final_std = compute_normalization(samples)
    final_model.set_normalization(final_mean.to(device), final_std.to(device))
    final_loader = DataLoader(dataset, batch_size=min(BATCH_SIZE, len(dataset)), shuffle=True)
    final_weights = compute_class_weights(labels).to(device)
    final_criterion = nn.CrossEntropyLoss(weight=final_weights)
    final_optimizer = torch.optim.Adam(final_model.parameters(), lr=LEARNING_RATE)

    for epoch in range(MAX_EPOCHS // 2):
        loss, acc = run_epoch(final_model, final_loader, final_criterion, final_optimizer, device)
        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(f"Final epoch {epoch + 1:3d}: loss={loss:.4f} acc={acc:.3f}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    output_path = MODEL_DIR / "skill_model.pt"
    torch.save(final_model.state_dict(), output_path)
    print(f"Saved skill model to {output_path}")


if __name__ == "__main__":
    main()
