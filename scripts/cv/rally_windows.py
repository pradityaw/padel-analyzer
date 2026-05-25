"""Load rally time windows produced by the Node analysis job."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class RallyWindowsConfig:
    fps: float
    padding_sec: float
    sample_fps: int
    windows: list[tuple[float, float]]

    def timestamp_in_active_rally(self, timestamp_sec: float) -> bool:
        if not self.windows:
            return True
        for start_sec, end_sec in self.windows:
            if start_sec <= timestamp_sec <= end_sec:
                return True
        return False


def load_rally_windows(path: str | None) -> RallyWindowsConfig | None:
    if not path:
        return None
    payload = json.loads(Path(path).read_text(encoding="utf8"))
    if not isinstance(payload, dict):
        raise ValueError("rally windows file must be a JSON object")

    fps = float(payload.get("fps", 30.0) or 30.0)
    padding_sec = float(payload.get("paddingSec", 1.5) or 1.5)
    sample_fps = int(payload.get("sampleFps", 15) or 15)
    raw_windows = payload.get("windows", [])
    windows: list[tuple[float, float]] = []
    if isinstance(raw_windows, list):
        for item in raw_windows:
            if not isinstance(item, dict):
                continue
            start_sec = float(item.get("startSec", 0.0) or 0.0)
            end_sec = float(item.get("endSec", start_sec) or start_sec)
            windows.append((start_sec, end_sec))
    return RallyWindowsConfig(
        fps=fps,
        padding_sec=padding_sec,
        sample_fps=max(1, sample_fps),
        windows=windows,
    )
