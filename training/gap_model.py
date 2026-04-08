"""Siamese gap predictor model (future v2).

Uses a shared TCN encoder (from ShotClassifier) to embed both player and pro
sequences, then a comparison head predicts per-metric importance scores.

This model learns WHICH technique differences matter most for improvement,
going beyond the statistical gap analysis.

Requirements: ~50+ paired samples to train meaningfully.
"""

import torch
import torch.nn as nn
from model import ShotClassifier
from config import (
    TOTAL_FEATURES,
    MAX_FRAMES,
    CONV_CHANNELS,
    ATTENTION_HEADS,
    DROPOUT,
)


class SharedEncoder(nn.Module):
    """TCN encoder backbone shared between player and pro branches.

    Reuses the conv_blocks + attention from ShotClassifier, without the
    classifier head. Can be initialized from a pretrained checkpoint.
    """

    def __init__(self):
        super().__init__()
        # Build same architecture as ShotClassifier minus classifier head
        from model import TemporalBlock

        channels = [TOTAL_FEATURES] + CONV_CHANNELS
        self.conv_blocks = nn.ModuleList(
            [
                TemporalBlock(channels[i], channels[i + 1], kernel_size=5 if i < 2 else 3)
                for i in range(len(CONV_CHANNELS))
            ]
        )

        attn_dim = CONV_CHANNELS[-1]
        self.attention = nn.MultiheadAttention(
            embed_dim=attn_dim,
            num_heads=ATTENTION_HEADS,
            dropout=DROPOUT,
            batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(attn_dim)
        self.output_dim = attn_dim

    def forward(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        """Encode sequence to fixed-size embedding.

        Args:
            x: (batch, seq_len, features)
            mask: (batch, seq_len)

        Returns:
            (batch, output_dim) embedding
        """
        h = x.transpose(1, 2)
        for block in self.conv_blocks:
            h = block(h)
        h = h.transpose(1, 2)

        key_padding_mask = (mask == 0) if mask is not None else None
        attn_out, _ = self.attention(h, h, h, key_padding_mask=key_padding_mask)
        h = self.attn_norm(h + attn_out)

        if mask is not None:
            mask_expanded = mask.unsqueeze(-1)
            h = (h * mask_expanded).sum(dim=1) / mask_expanded.sum(dim=1).clamp(min=1)
        else:
            h = h.mean(dim=1)

        return h

    @classmethod
    def from_pretrained(cls, classifier_checkpoint: str) -> "SharedEncoder":
        """Initialize from a pretrained ShotClassifier checkpoint."""
        encoder = cls()
        classifier = ShotClassifier()
        classifier.load_state_dict(
            torch.load(classifier_checkpoint, map_location="cpu", weights_only=True)
        )

        # Copy matching weights
        encoder.conv_blocks.load_state_dict(classifier.conv_blocks.state_dict())
        encoder.attention.load_state_dict(classifier.attention.state_dict())
        encoder.attn_norm.load_state_dict(classifier.attn_norm.state_dict())

        return encoder


class GapPredictor(nn.Module):
    """Siamese model that predicts per-metric gap importance.

    Takes player and pro landmark sequences, encodes both with a shared
    encoder, then predicts which technique differences matter most.

    Output: (batch, 30) importance scores for 5 phases x 6 metrics.
    """

    NUM_OUTPUTS = 30  # 5 phases x 6 metrics

    def __init__(self, pretrained_checkpoint: str | None = None):
        super().__init__()

        if pretrained_checkpoint:
            self.encoder = SharedEncoder.from_pretrained(pretrained_checkpoint)
        else:
            self.encoder = SharedEncoder()

        embed_dim = self.encoder.output_dim

        # Comparison head: concat player + pro embeddings + their difference
        self.comparison_head = nn.Sequential(
            nn.Linear(embed_dim * 3, 128),  # concat + diff
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, self.NUM_OUTPUTS),
            nn.Sigmoid(),  # importance scores in [0, 1]
        )

    def forward(
        self,
        player_x: torch.Tensor,
        player_mask: torch.Tensor,
        pro_x: torch.Tensor,
        pro_mask: torch.Tensor,
    ) -> torch.Tensor:
        """
        Args:
            player_x: (batch, seq_len, features)
            player_mask: (batch, seq_len)
            pro_x: (batch, seq_len, features)
            pro_mask: (batch, seq_len)

        Returns:
            (batch, 30) importance scores
        """
        player_emb = self.encoder(player_x, player_mask)
        pro_emb = self.encoder(pro_x, pro_mask)

        diff = player_emb - pro_emb
        combined = torch.cat([player_emb, pro_emb, diff], dim=-1)

        return self.comparison_head(combined)


if __name__ == "__main__":
    model = GapPredictor()
    params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"GapPredictor parameters: {params:,}")

    # Test forward pass
    batch_size = 4
    player_x = torch.randn(batch_size, MAX_FRAMES, TOTAL_FEATURES)
    player_mask = torch.ones(batch_size, MAX_FRAMES)
    pro_x = torch.randn(batch_size, MAX_FRAMES, TOTAL_FEATURES)
    pro_mask = torch.ones(batch_size, MAX_FRAMES)

    out = model(player_x, player_mask, pro_x, pro_mask)
    print(f"Output shape: {out.shape}")  # (4, 30)
    print(f"Output range: [{out.min():.3f}, {out.max():.3f}]")
