"""Export trained PyTorch model to ONNX format for client-side inference."""

import argparse
import torch
import numpy as np
from pathlib import Path

from config import TOTAL_FEATURES, MAX_FRAMES, MODEL_DIR, EXPORT_DIR
from model import ShotClassifier


def export(checkpoint_path: str | None = None):
    # Load model
    model = ShotClassifier()
    ckpt = Path(checkpoint_path) if checkpoint_path else MODEL_DIR / "final_model.pt"
    if not ckpt.exists():
        print(f"Error: checkpoint not found at {ckpt}")
        return

    model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True))
    model.eval()

    # Dummy inputs
    dummy_features = torch.randn(1, MAX_FRAMES, TOTAL_FEATURES)
    dummy_mask = torch.ones(1, MAX_FRAMES)

    # Export
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = EXPORT_DIR / "shot_classifier.onnx"

    torch.onnx.export(
        model,
        (dummy_features, dummy_mask),
        str(output_path),
        opset_version=17,
        input_names=["features", "mask"],
        output_names=["logits"],
        dynamic_axes={
            "features": {0: "batch", 1: "seq_len"},
            "mask": {0: "batch", 1: "seq_len"},
            "logits": {0: "batch"},
        },
    )
    print(f"ONNX model exported to {output_path}")
    print(f"File size: {output_path.stat().st_size / 1024:.1f} KB")

    # Verify with onnxruntime
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(str(output_path))
        ort_inputs = {
            "features": dummy_features.numpy(),
            "mask": dummy_mask.numpy(),
        }
        ort_output = session.run(None, ort_inputs)[0]

        with torch.no_grad():
            pt_output = model(dummy_features, dummy_mask).numpy()

        diff = np.abs(ort_output - pt_output).max()
        print(f"PyTorch vs ONNX max diff: {diff:.6f}")
        if diff < 1e-4:
            print("Verification PASSED")
        else:
            print("WARNING: outputs differ more than expected")
    except ImportError:
        print("onnxruntime not installed, skipping verification")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=str, default=None)
    args = parser.parse_args()
    export(args.checkpoint)
