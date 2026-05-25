"""TrackNetV2 ONNX ball heatmap inference.

The detector is intentionally self-contained so court_mapping can pass a
sliding window of three BGR OpenCV frames and receive the current-frame ball
position without importing ONNX Runtime until inference is actually used.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import os
from pathlib import Path
from typing import Any, Sequence

import cv2
import numpy as np


DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "models" / "tracknet-v2.onnx"
DEFAULT_INPUT_SIZE = (512, 288)
TRACKNET_FRAME_COUNT = 3


@dataclass(frozen=True, slots=True)
class TrackNetConfig:
    """Configuration for TrackNetV2 ONNX inference."""

    model_path: Path | str = DEFAULT_MODEL_PATH
    input_size: tuple[int, int] = DEFAULT_INPUT_SIZE
    min_confidence: float = 0.25
    peak_normalizer: float = 1.0
    execution_providers: Sequence[str] | None = None

    def __post_init__(self) -> None:
        width, height = self.input_size
        if width <= 0 or height <= 0:
            raise ValueError("TrackNet input_size must contain positive width and height.")
        if self.peak_normalizer <= 0:
            raise ValueError("TrackNet peak_normalizer must be greater than zero.")
        if not math.isfinite(self.min_confidence):
            raise ValueError("TrackNet min_confidence must be finite.")


@dataclass(frozen=True, slots=True)
class TrackNetDetection:
    """A single current-frame ball detection in source-frame coordinates."""

    x: float
    y: float
    confidence: float
    heatmap_x: int
    heatmap_y: int
    heatmap_width: int
    heatmap_height: int
    source_width: int
    source_height: int

    def to_dict(self) -> dict[str, float | int]:
        return {
            "x": float(self.x),
            "y": float(self.y),
            "confidence": float(self.confidence),
            "heatmap_x": int(self.heatmap_x),
            "heatmap_y": int(self.heatmap_y),
            "heatmap_width": int(self.heatmap_width),
            "heatmap_height": int(self.heatmap_height),
            "source_width": int(self.source_width),
            "source_height": int(self.source_height),
        }


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a finite number") from exc
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def tracknet_config_from_env() -> TrackNetConfig:
    """Build TrackNet configuration from environment variables.

    The defaults match the checked-in server path. Production deployments can
    point TRACKNET_MODEL_PATH at a mounted model without changing code.
    """

    model_path = Path(os.environ.get("TRACKNET_MODEL_PATH", "").strip() or DEFAULT_MODEL_PATH)
    width = _env_int("TRACKNET_INPUT_WIDTH", DEFAULT_INPUT_SIZE[0])
    height = _env_int("TRACKNET_INPUT_HEIGHT", DEFAULT_INPUT_SIZE[1])
    providers_raw = os.environ.get("TRACKNET_EXECUTION_PROVIDERS", "").strip()
    providers = (
        [provider.strip() for provider in providers_raw.split(",") if provider.strip()]
        if providers_raw
        else None
    )
    return TrackNetConfig(
        model_path=model_path,
        input_size=(width, height),
        min_confidence=_env_float("TRACKNET_MIN_CONFIDENCE", 0.25),
        peak_normalizer=_env_float("TRACKNET_PEAK_NORMALIZER", 1.0),
        execution_providers=providers,
    )


def _load_onnxruntime() -> Any:
    try:
        import onnxruntime as ort  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "onnxruntime is required for TrackNet ball detection. "
            "Install it with `pip install onnxruntime` or `pip install onnxruntime-gpu`."
        ) from exc
    return ort


def _select_execution_providers(
    ort: Any, requested: Sequence[str] | None
) -> list[str]:
    available = set(ort.get_available_providers())
    if requested is not None:
        providers = [provider for provider in requested if provider in available]
        if not providers:
            raise RuntimeError(
                "None of the requested ONNX execution providers are available: "
                f"{', '.join(requested)}."
            )
        return providers

    providers: list[str] = []
    if "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    if "CPUExecutionProvider" in available:
        providers.append("CPUExecutionProvider")
    if not providers:
        raise RuntimeError("No supported ONNX execution provider is available.")
    return providers


@dataclass(slots=True)
class TrackNetBallDetector:
    """Reusable TrackNetV2 detector for three-frame BGR sliding windows."""

    config: TrackNetConfig = field(default_factory=TrackNetConfig)
    _session: Any | None = field(default=None, init=False, repr=False)
    _input_name: str | None = field(default=None, init=False, repr=False)

    def detect(self, frames: Sequence[np.ndarray]) -> TrackNetDetection | None:
        """Return the current-frame ball detection for a three-frame BGR window."""

        if len(frames) != TRACKNET_FRAME_COUNT:
            raise ValueError(
                f"TrackNet expects exactly {TRACKNET_FRAME_COUNT} BGR frames, got {len(frames)}."
            )

        source_height, source_width = self._current_frame_size(frames[-1])
        tensor = self._preprocess(frames)
        session = self._get_session()
        output = session.run(None, {self._input_name: tensor})[0]
        heatmap = self._extract_current_heatmap(np.asarray(output))
        return self._detection_from_heatmap(heatmap, source_width, source_height)

    def _get_session(self) -> Any:
        if self._session is not None:
            return self._session

        model_path = Path(self.config.model_path)
        if not model_path.exists():
            raise FileNotFoundError(f"TrackNet ONNX model does not exist: {model_path}")

        ort = _load_onnxruntime()
        providers = _select_execution_providers(ort, self.config.execution_providers)
        self._session = ort.InferenceSession(str(model_path), providers=providers)
        inputs = self._session.get_inputs()
        if not inputs:
            raise RuntimeError("TrackNet ONNX model has no inputs.")
        self._input_name = inputs[0].name
        return self._session

    def _preprocess(self, frames: Sequence[np.ndarray]) -> np.ndarray:
        width, height = self.config.input_size
        channels: list[np.ndarray] = []

        for frame in frames:
            self._current_frame_size(frame)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            resized = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_LINEAR)
            normalized = resized.astype(np.float32) / 255.0
            channels.append(np.transpose(normalized, (2, 0, 1)))

        return np.concatenate(channels, axis=0)[np.newaxis, ...].astype(np.float32)

    def _extract_current_heatmap(self, output: np.ndarray) -> np.ndarray:
        if output.ndim == 4:
            if output.shape[0] != 1:
                raise RuntimeError(f"Unsupported TrackNet batch output shape: {output.shape}")
            if output.shape[1] == 1:
                heatmap = output[0, 0]
            elif output.shape[1] == TRACKNET_FRAME_COUNT:
                heatmap = output[0, -1]
            else:
                raise RuntimeError(f"Unsupported TrackNet channel output shape: {output.shape}")
        elif output.ndim == 3:
            if output.shape[0] != 1:
                raise RuntimeError(f"Unsupported TrackNet output shape: {output.shape}")
            heatmap = output[0]
        elif output.ndim == 2:
            heatmap = output
        else:
            raise RuntimeError(f"Unsupported TrackNet output shape: {output.shape}")

        if heatmap.size == 0:
            raise RuntimeError("TrackNet output heatmap is empty.")
        return np.asarray(heatmap, dtype=np.float32)

    def _detection_from_heatmap(
        self, heatmap: np.ndarray, source_width: int, source_height: int
    ) -> TrackNetDetection | None:
        peak = float(np.nanmax(heatmap))
        if not math.isfinite(peak):
            return None

        confidence = max(0.0, min(1.0, peak / float(self.config.peak_normalizer)))
        if confidence < self.config.min_confidence:
            return None

        heatmap_height, heatmap_width = heatmap.shape
        flat_index = int(np.nanargmax(heatmap))
        heatmap_y, heatmap_x = divmod(flat_index, heatmap_width)
        x = ((float(heatmap_x) + 0.5) / float(heatmap_width)) * float(source_width)
        y = ((float(heatmap_y) + 0.5) / float(heatmap_height)) * float(source_height)

        return TrackNetDetection(
            x=x,
            y=y,
            confidence=confidence,
            heatmap_x=heatmap_x,
            heatmap_y=heatmap_y,
            heatmap_width=heatmap_width,
            heatmap_height=heatmap_height,
            source_width=source_width,
            source_height=source_height,
        )

    @staticmethod
    def _current_frame_size(frame: np.ndarray) -> tuple[int, int]:
        if not isinstance(frame, np.ndarray):
            raise TypeError("TrackNet frames must be numpy arrays.")
        if frame.ndim != 3 or frame.shape[2] != 3:
            raise ValueError("TrackNet frames must be BGR images with shape [H,W,3].")
        height, width = frame.shape[:2]
        if height <= 0 or width <= 0:
            raise ValueError("TrackNet frames must have positive width and height.")
        return int(height), int(width)
