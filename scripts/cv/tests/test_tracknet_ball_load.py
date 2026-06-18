"""Smoke test: the TrackNet ONNX model loads and runs when present.

Unlike ``test_ball_eval.py`` (which is gated on a labeled video fixture), this
test is gated *only* on the model file. It skips cleanly when
``scripts/cv/models/tracknet-v2.onnx`` is absent or a 0-byte placeholder, and
otherwise forces a session load and runs a three-frame detection to confirm the
ONNX contract (input ``frames`` [N,9,288,512] -> heatmap) is honored end-to-end.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import pytest

from scripts.cv.tracknet_ball import (
    DEFAULT_MODEL_PATH,
    TrackNetBallDetector,
    TrackNetConfig,
)


def _model_is_available() -> bool:
    return Path(DEFAULT_MODEL_PATH).exists() and Path(DEFAULT_MODEL_PATH).stat().st_size > 0


_ONNXRUNTIME_AVAILABLE = importlib.util.find_spec("onnxruntime") is not None


@pytest.mark.skipif(
    not (_model_is_available() and _ONNXRUNTIME_AVAILABLE),
    reason=f"tracknet-v2.onnx missing/empty at {DEFAULT_MODEL_PATH} or onnxruntime not installed",
)
def test_tracknet_model_loads_and_detects() -> None:
    detector = TrackNetBallDetector()
    # Force the ONNX session to build so a malformed model fails here, not later.
    detector._get_session()  # noqa: SLF001 (intentional warm-up)

    # A three-frame BGR sliding window of plain noise. TrackNet is trained on real
    # broadcast frames, so this may legitimately detect nothing; the contract we
    # assert is that inference runs without raising and respects the window shape.
    frames = [np.zeros((288, 512, 3), dtype="uint8") for _ in range(3)]
    result = detector.detect(frames)

    # Either no confident peak (None) or a fully-populated detection record.
    if result is not None:
        record = result.to_dict()
        assert record["heatmap_width"] == 512
        assert record["heatmap_height"] == 288
        assert 0.0 <= record["confidence"] <= 1.0


def test_tracknet_model_unavailable_raises_filenotfound(tmp_path) -> None:
    """When the model is missing, _get_session raises FileNotFoundError (the server
    then falls back to the OpenCV tracker). This guards that failure mode."""
    detector = TrackNetBallDetector(
        config=TrackNetConfig(model_path=tmp_path / "does-not-exist.onnx")
    )
    with pytest.raises(FileNotFoundError):
        detector._get_session()  # noqa: SLF001
