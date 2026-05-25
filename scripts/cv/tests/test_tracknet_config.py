from pathlib import Path

import pytest

from scripts.cv.tracknet_ball import DEFAULT_INPUT_SIZE, tracknet_config_from_env


def test_tracknet_config_from_env_defaults(monkeypatch):
    for key in (
        "TRACKNET_MODEL_PATH",
        "TRACKNET_INPUT_WIDTH",
        "TRACKNET_INPUT_HEIGHT",
        "TRACKNET_MIN_CONFIDENCE",
        "TRACKNET_PEAK_NORMALIZER",
        "TRACKNET_EXECUTION_PROVIDERS",
    ):
        monkeypatch.delenv(key, raising=False)

    config = tracknet_config_from_env()

    assert config.input_size == DEFAULT_INPUT_SIZE
    assert config.min_confidence == 0.25
    assert config.execution_providers is None


def test_tracknet_config_from_env_overrides(monkeypatch, tmp_path):
    model_path = tmp_path / "tracknet.onnx"
    monkeypatch.setenv("TRACKNET_MODEL_PATH", str(model_path))
    monkeypatch.setenv("TRACKNET_INPUT_WIDTH", "320")
    monkeypatch.setenv("TRACKNET_INPUT_HEIGHT", "180")
    monkeypatch.setenv("TRACKNET_MIN_CONFIDENCE", "0.4")
    monkeypatch.setenv("TRACKNET_PEAK_NORMALIZER", "2.0")
    monkeypatch.setenv("TRACKNET_EXECUTION_PROVIDERS", "CPUExecutionProvider,CoreMLExecutionProvider")

    config = tracknet_config_from_env()

    assert Path(config.model_path) == model_path
    assert config.input_size == (320, 180)
    assert config.min_confidence == 0.4
    assert config.peak_normalizer == 2.0
    assert config.execution_providers == [
        "CPUExecutionProvider",
        "CoreMLExecutionProvider",
    ]


def test_tracknet_config_rejects_bad_numbers(monkeypatch):
    monkeypatch.setenv("TRACKNET_INPUT_WIDTH", "0")

    with pytest.raises(ValueError):
        tracknet_config_from_env()
