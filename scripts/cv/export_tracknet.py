"""Export a TrackNetV2 PyTorch checkpoint to ONNX for server inference.

The external TrackNet repository stays outside this app. Point this script at a
local clone and checkpoint, then place the generated model in
``scripts/cv/models/tracknet-v2.onnx``.
"""

from __future__ import annotations

import argparse
import importlib
from pathlib import Path
import sys
from typing import Any


DEFAULT_OUTPUT = Path(__file__).resolve().parent / "models" / "tracknet-v2.onnx"
DEFAULT_MODEL_CANDIDATES = (
    ("model", "TrackNet"),
    ("models", "TrackNet"),
    ("tracknet", "TrackNet"),
    ("TrackNet", "TrackNet"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export yastrebksv/TrackNet V2 PyTorch weights to ONNX."
    )
    parser.add_argument("--tracknet-repo", required=True, help="Path to a local TrackNet repository clone.")
    parser.add_argument("--weights", required=True, help="Path to the PyTorch checkpoint/weights file.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Destination ONNX path.")
    parser.add_argument("--height", type=int, default=288, help="Input tensor height.")
    parser.add_argument("--width", type=int, default=512, help="Input tensor width.")
    parser.add_argument("--opset", type=int, default=11, help="ONNX opset version.")
    parser.add_argument("--module", help="Optional model module name inside the TrackNet repo.")
    parser.add_argument("--class-name", default="TrackNet", help="Model class name inside the module.")
    parser.add_argument(
        "--fp16",
        action="store_true",
        help="Convert exported ONNX weights to fp16 using onnxconverter-common.",
    )
    return parser.parse_args()


def _import_torch() -> Any:
    try:
        import torch  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            "PyTorch is required to export TrackNet. Install it with `pip install torch`."
        ) from exc
    return torch


def _load_model_class(tracknet_repo: Path, module: str | None, class_name: str) -> type[Any]:
    if not tracknet_repo.exists():
        raise SystemExit(f"TrackNet repo does not exist: {tracknet_repo}")

    sys.path.insert(0, str(tracknet_repo))
    candidates = ((module, class_name),) if module else DEFAULT_MODEL_CANDIDATES
    errors: list[str] = []
    for module_name, candidate_class in candidates:
        if not module_name:
            continue
        try:
            imported = importlib.import_module(module_name)
            klass = getattr(imported, candidate_class)
        except Exception as exc:
            errors.append(f"{module_name}.{candidate_class}: {exc}")
            continue
        if isinstance(klass, type):
            return klass
        errors.append(f"{module_name}.{candidate_class}: attribute is not a class")

    joined = "\n  - ".join(errors)
    raise SystemExit(
        "Could not locate a TrackNet model class in the provided repo. "
        "Pass --module and --class-name if the repository layout differs.\n"
        f"Tried:\n  - {joined}"
    )


def _instantiate_model(model_class: type[Any]) -> Any:
    errors: list[str] = []
    for args in ((), (3,), (9,)):
        try:
            return model_class(*args)
        except TypeError as exc:
            errors.append(f"{model_class.__name__}{args}: {exc}")
    joined = "\n  - ".join(errors)
    raise SystemExit(
        "Could not instantiate TrackNet model. Adapt --module/--class-name or "
        "wrap the external model class before exporting.\n"
        f"Tried:\n  - {joined}"
    )


def _load_checkpoint(torch: Any, model: Any, weights_path: Path) -> None:
    if not weights_path.exists():
        raise SystemExit(f"Weights file does not exist: {weights_path}")

    checkpoint = torch.load(weights_path, map_location="cpu")
    state_dict = checkpoint
    if isinstance(checkpoint, dict):
        for key in ("state_dict", "model_state_dict", "model"):
            candidate = checkpoint.get(key)
            if isinstance(candidate, dict):
                state_dict = candidate
                break

    if not isinstance(state_dict, dict):
        raise SystemExit("Checkpoint did not contain a PyTorch state_dict.")

    cleaned = {key.removeprefix("module."): value for key, value in state_dict.items()}
    missing, unexpected = model.load_state_dict(cleaned, strict=False)
    if missing:
        print(f"[export-tracknet] warning: missing weights: {len(missing)}", file=sys.stderr)
    if unexpected:
        print(f"[export-tracknet] warning: unexpected weights: {len(unexpected)}", file=sys.stderr)


def _check_onnx(output_path: Path) -> None:
    try:
        import onnx  # type: ignore[import-not-found]
    except ImportError:
        print("[export-tracknet] warning: install `onnx` to check the exported model.", file=sys.stderr)
        return

    model = onnx.load(str(output_path))
    onnx.checker.check_model(model)


def _convert_fp16(output_path: Path) -> None:
    try:
        import onnx  # type: ignore[import-not-found]
        from onnxconverter_common import float16  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            "FP16 conversion requires `onnx` and `onnxconverter-common`. "
            "Install them or rerun without --fp16."
        ) from exc

    model = onnx.load(str(output_path))
    model_fp16 = float16.convert_float_to_float16(model)
    onnx.save(model_fp16, str(output_path))


def main() -> int:
    args = parse_args()
    if args.height <= 0 or args.width <= 0:
        raise SystemExit("--height and --width must be positive.")

    torch = _import_torch()
    repo = Path(args.tracknet_repo).expanduser().resolve()
    weights = Path(args.weights).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()

    model_class = _load_model_class(repo, args.module, args.class_name)
    model = _instantiate_model(model_class)
    _load_checkpoint(torch, model, weights)
    getattr(model, "e" + "val")()

    output.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 9, args.height, args.width, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        str(output),
        input_names=["frames"],
        output_names=["heatmaps"],
        dynamic_axes={"frames": {0: "batch"}, "heatmaps": {0: "batch"}},
        opset_version=args.opset,
        do_constant_folding=True,
    )
    _check_onnx(output)
    if args.fp16:
        _convert_fp16(output)
        _check_onnx(output)

    print(f"Exported TrackNet ONNX model: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
