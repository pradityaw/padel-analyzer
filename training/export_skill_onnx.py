"""Export the skill-band classifier to ONNX for browser inference."""

import argparse
from pathlib import Path

import numpy as np
import torch

from config import EXPORT_DIR
from skill_dataset import SKILL_INPUT_DIM
from skill_model import SkillClassifier


def export(checkpoint_path: str | None = None):
    model = SkillClassifier()
    ckpt = Path(checkpoint_path) if checkpoint_path else Path(__file__).parent / "checkpoints" / "skill_model.pt"
    if not ckpt.exists():
        print(f"Error: checkpoint not found at {ckpt}")
        return

    model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True))
    model.eval()

    dummy_features = torch.randn(1, SKILL_INPUT_DIM)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = EXPORT_DIR / "skill_classifier.onnx"

    torch.onnx.export(
        model,
        dummy_features,
        str(output_path),
        opset_version=18,
        input_names=["features"],
        output_names=["logits"],
        external_data=False,
        dynamic_axes={
            "features": {0: "batch"},
            "logits": {0: "batch"},
        },
    )
    print(f"Skill ONNX model exported to {output_path}")
    print(f"File size: {output_path.stat().st_size / 1024:.1f} KB")

    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(output_path))
        ort_output = session.run(None, {"features": dummy_features.numpy()})[0]

        with torch.no_grad():
            pt_output = model(dummy_features).numpy()

        diff = np.abs(ort_output - pt_output).max()
        print(f"PyTorch vs ONNX max diff: {diff:.6f}")
        print("Verification PASSED" if diff < 1e-4 else "WARNING: outputs differ")
    except ImportError:
        print("onnxruntime not installed, skipping verification")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, default=None)
    args = parser.parse_args()
    export(args.checkpoint)
