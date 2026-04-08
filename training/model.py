"""Shot classification model: 1D Temporal CNN with self-attention."""

import torch
import torch.nn as nn
from config import (
    TOTAL_FEATURES,
    MAX_FRAMES,
    NUM_CLASSES,
    CONV_CHANNELS,
    ATTENTION_HEADS,
    HIDDEN_DIM,
    DROPOUT,
    CLASSIFIER_DROPOUT,
)


class TemporalBlock(nn.Module):
    """Conv1D + BatchNorm + ReLU + Dropout."""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int):
        super().__init__()
        self.conv = nn.Conv1d(
            in_channels, out_channels, kernel_size, padding=kernel_size // 2
        )
        self.bn = nn.BatchNorm1d(out_channels)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(DROPOUT)

    def forward(self, x):
        return self.dropout(self.relu(self.bn(self.conv(x))))


class ShotClassifier(nn.Module):
    """1D TCN + multi-head self-attention for shot type classification.

    Input: (batch, seq_len, features) where features=264, seq_len=64
    Output: (batch, num_classes) logits
    """

    def __init__(self):
        super().__init__()

        # Temporal convolution blocks
        # Input is transposed to (batch, features, seq_len) for Conv1d
        channels = [TOTAL_FEATURES] + CONV_CHANNELS
        self.conv_blocks = nn.ModuleList(
            [
                TemporalBlock(channels[i], channels[i + 1], kernel_size=5 if i < 2 else 3)
                for i in range(len(CONV_CHANNELS))
            ]
        )

        # Self-attention over temporal dimension
        attn_dim = CONV_CHANNELS[-1]
        self.attention = nn.MultiheadAttention(
            embed_dim=attn_dim,
            num_heads=ATTENTION_HEADS,
            dropout=DROPOUT,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(attn_dim)

        # Classifier head
        self.classifier = nn.Sequential(
            nn.Linear(attn_dim, HIDDEN_DIM),
            nn.ReLU(),
            nn.Dropout(CLASSIFIER_DROPOUT),
            nn.Linear(HIDDEN_DIM, NUM_CLASSES),
        )

    def forward(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        """
        Args:
            x: (batch, seq_len, features) - landmark features
            mask: (batch, seq_len) - 1 for real frames, 0 for padding

        Returns:
            (batch, num_classes) logits
        """
        # Conv1d expects (batch, channels, seq_len)
        h = x.transpose(1, 2)

        for block in self.conv_blocks:
            h = block(h)

        # Back to (batch, seq_len, channels) for attention
        h = h.transpose(1, 2)

        # Self-attention with padding mask
        key_padding_mask = None
        if mask is not None:
            key_padding_mask = mask == 0  # True = ignore

        attn_out, _ = self.attention(h, h, h, key_padding_mask=key_padding_mask)
        h = self.attn_norm(h + attn_out)

        # Global average pooling (respecting mask)
        if mask is not None:
            mask_expanded = mask.unsqueeze(-1)  # (batch, seq_len, 1)
            h = (h * mask_expanded).sum(dim=1) / mask_expanded.sum(dim=1).clamp(min=1)
        else:
            h = h.mean(dim=1)

        return self.classifier(h)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    model = ShotClassifier()
    print(f"Model parameters: {count_parameters(model):,}")

    # Test forward pass
    batch = torch.randn(4, MAX_FRAMES, TOTAL_FEATURES)
    mask = torch.ones(4, MAX_FRAMES)
    out = model(batch, mask)
    print(f"Input shape:  {batch.shape}")
    print(f"Output shape: {out.shape}")
    print(f"Output: {out}")
