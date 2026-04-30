"""Lightweight MLP for predicting a swing quality band."""

import torch
import torch.nn as nn

from config import NUM_QUALITY_BANDS
from skill_dataset import SKILL_INPUT_DIM


class SkillClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.register_buffer("feature_mean", torch.zeros(SKILL_INPUT_DIM))
        self.register_buffer("feature_std", torch.ones(SKILL_INPUT_DIM))
        self.net = nn.Sequential(
            nn.Linear(SKILL_INPUT_DIM, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(32, NUM_QUALITY_BANDS),
        )

    def set_normalization(self, mean: torch.Tensor, std: torch.Tensor):
        self.feature_mean.copy_(mean)
        self.feature_std.copy_(std.clamp(min=1e-6))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.feature_mean) / self.feature_std
        return self.net(x)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    model = SkillClassifier()
    print(f"SkillClassifier parameters: {count_parameters(model):,}")
    sample = torch.randn(4, SKILL_INPUT_DIM)
    print(model(sample).shape)
