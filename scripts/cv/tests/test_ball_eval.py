"""Focused ball-tracker eval harness for labeled video fixtures.

Expected fixture: ``data/eval/ball/labels.json``

Example labels format:

{
  "video": "relative/or/absolute/path.mp4",
  "frames": [
    {"frame": 123, "x": 100.0, "y": 200.0, "visible": true},
    {"frame": 124, "visible": false}
  ]
}

The ``video`` path is resolved relative to the labels file first, then relative
to the repository root. Actual video fixtures are intentionally not required in
git; this test skips cleanly when the labels file or referenced video is absent.

Run directly:
    python scripts/cv/tests/test_ball_eval.py

Run with pytest:
    pytest scripts/cv/tests/test_ball_eval.py -s

TrackNet is optional. By default the harness uses
``scripts.cv.court_mapping.TrackNetBallTracker`` and skips cleanly if the model
or ONNX Runtime is unavailable. Set ``PADEL_TRACKNET_MODULE`` to override that
module name. A compatible module can expose ``track_ball_and_shots_tracknet``,
``track_ball_and_shots(video_path)``, ``track_ball(video_path)``,
``track_video(video_path)``, or a ``TrackNetBallTracker`` class with
``track_video(video_path)``.
"""

from __future__ import annotations

from dataclasses import dataclass
import importlib
import json
import math
import os
from pathlib import Path
import sys
import time
from typing import Any, Callable

try:
    import pytest
except Exception:  # pragma: no cover - direct execution does not require pytest.
    pytest = None  # type: ignore[assignment]


REPO_ROOT = Path(__file__).resolve().parents[3]
LABELS_PATH = REPO_ROOT / "data" / "eval" / "ball" / "labels.json"
DEFAULT_MATCH_TOLERANCE_PX = 25.0


@dataclass(frozen=True)
class LabelFrame:
    frame: int
    x: float | None
    y: float | None
    visible: bool


@dataclass(frozen=True)
class Detection:
    frame: int
    x: float
    y: float
    confidence: float | None = None


@dataclass(frozen=True)
class BackendResult:
    name: str
    status: str
    metrics: dict[str, float | int | None]
    reason: str | None = None


def _skip_or_return(reason: str) -> None:
    if pytest is not None and "PYTEST_CURRENT_TEST" in os.environ:
        pytest.skip(reason)
    print(json.dumps({"status": "skipped", "reason": reason}, indent=2))
    raise SystemExit(0)


def _load_fixture(labels_path: Path = LABELS_PATH) -> tuple[Path, list[LabelFrame]]:
    if not labels_path.exists():
        _skip_or_return(f"missing labels fixture: {labels_path}")

    payload = json.loads(labels_path.read_text(encoding="utf8"))
    if not isinstance(payload, dict):
        raise ValueError("labels.json must contain a JSON object")

    raw_video = payload.get("video")
    if not isinstance(raw_video, str) or not raw_video:
        raise ValueError('labels.json must include a non-empty "video" string')

    video_path = Path(raw_video).expanduser()
    if not video_path.is_absolute():
        labels_relative = labels_path.parent / video_path
        repo_relative = REPO_ROOT / video_path
        video_path = labels_relative if labels_relative.exists() else repo_relative

    if not video_path.exists():
        _skip_or_return(f"missing referenced video: {video_path}")

    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        raise ValueError('labels.json must include a non-empty "frames" array')

    labels: list[LabelFrame] = []
    for item in raw_frames:
        if not isinstance(item, dict):
            raise ValueError("each frame label must be an object")
        frame = item.get("frame")
        if not isinstance(frame, int):
            raise ValueError('each frame label must include integer "frame"')
        visible = bool(item.get("visible", True))
        x = item.get("x")
        y = item.get("y")
        if visible and (not isinstance(x, (int, float)) or not isinstance(y, (int, float))):
            raise ValueError('visible labels must include numeric "x" and "y"')
        labels.append(
            LabelFrame(
                frame=frame,
                x=float(x) if isinstance(x, (int, float)) else None,
                y=float(y) if isinstance(y, (int, float)) else None,
                visible=visible,
            )
        )

    return video_path, labels


def _normalise_detection(item: Any) -> Detection | None:
    if hasattr(item, "to_dict"):
        item = item.to_dict()
    if not isinstance(item, dict):
        return None

    frame = item.get("frame", item.get("frame_idx", item.get("frameIndex")))
    x = item.get("x", item.get("image_x", item.get("center_x")))
    y = item.get("y", item.get("image_y", item.get("center_y")))
    confidence = item.get("confidence")
    if not isinstance(frame, int) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return Detection(
        frame=frame,
        x=float(x),
        y=float(y),
        confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
    )


def _extract_detections(payload: Any) -> tuple[list[Detection], int | None]:
    frames_processed: int | None = None
    raw_points: Any = payload

    if isinstance(payload, tuple) and payload:
        raw_points = payload[0]
        if len(payload) > 1 and isinstance(payload[1], int):
            frames_processed = payload[1]
    elif isinstance(payload, dict):
        summary = payload.get("summary")
        if isinstance(summary, dict) and isinstance(summary.get("frames_processed"), int):
            frames_processed = summary["frames_processed"]
        raw_points = (
            payload.get("ball_track")
            or payload.get("frames")
            or payload.get("detections")
            or payload.get("points")
            or []
        )

    if not isinstance(raw_points, list):
        return [], frames_processed

    detections = [d for d in (_normalise_detection(item) for item in raw_points) if d is not None]
    return detections, frames_processed


def _metric_payload(
    detections: list[Detection],
    frames_processed: int | None,
    labels: list[LabelFrame],
    elapsed_sec: float,
    tolerance_px: float,
) -> dict[str, float | int | None]:
    detections_by_frame: dict[int, Detection] = {}
    for detection in detections:
        detections_by_frame.setdefault(detection.frame, detection)

    visible_labels = [label for label in labels if label.visible]
    invisible_frames = {label.frame for label in labels if not label.visible}
    errors: list[float] = []
    matched = 0

    for label in visible_labels:
        detection = detections_by_frame.get(label.frame)
        if detection is None or label.x is None or label.y is None:
            continue
        error = math.hypot(detection.x - label.x, detection.y - label.y)
        errors.append(error)
        if error <= tolerance_px:
            matched += 1

    false_positives = sum(1 for frame in invisible_frames if frame in detections_by_frame)
    mean_pixel_error = sum(errors) / len(errors) if errors else None
    processed = frames_processed if frames_processed is not None else max((label.frame for label in labels), default=-1) + 1
    runtime_fps = float(processed) / elapsed_sec if elapsed_sec > 0 else None

    return {
        "visible_labels": len(visible_labels),
        "detections": len(detections),
        "matched_visible_labels": matched,
        "detection_rate": matched / len(visible_labels) if visible_labels else None,
        "mean_pixel_error": mean_pixel_error,
        "false_positives": false_positives,
        "frames_processed": processed,
        "runtime_fps": runtime_fps,
    }


def _run_backend(
    name: str,
    runner: Callable[[str], Any],
    video_path: Path,
    labels: list[LabelFrame],
    tolerance_px: float,
) -> BackendResult:
    started = time.perf_counter()
    payload = runner(str(video_path))
    elapsed = time.perf_counter() - started
    detections, frames_processed = _extract_detections(payload)
    return BackendResult(
        name=name,
        status="ok",
        metrics=_metric_payload(detections, frames_processed, labels, elapsed, tolerance_px),
    )


def _run_opencv(video_path: str) -> Any:
    from scripts.cv.court_mapping import BallTracker, CourtMappingConfig

    return BallTracker(homography=None, config=CourtMappingConfig()).track_video(video_path)


def _tracknet_runner_from_module(module: Any) -> Callable[[str], Any] | None:
    for function_name in (
        "track_ball_and_shots_tracknet",
        "track_ball_and_shots",
        "track_ball",
        "track_video",
    ):
        candidate = getattr(module, function_name, None)
        if callable(candidate):
            return candidate

    for class_name in ("TrackNetBallTracker", "TrackNetTracker", "BallTracker"):
        klass = getattr(module, class_name, None)
        if klass is None:
            continue
        try:
            instance = klass()
        except TypeError:
            continue
        track_video = getattr(instance, "track_video", None)
        if callable(track_video):
            return track_video

    return None


def _load_tracknet_runner() -> tuple[Callable[[str], Any] | None, str | None]:
    module_names = []
    env_module = os.environ.get("PADEL_TRACKNET_MODULE")
    if env_module:
        module_names.append(env_module)
    module_names.extend(
        [
            "scripts.cv.court_mapping",
            "court_mapping",
            "scripts.cv.tracknet_tracker",
            "scripts.cv.tracknet",
            "tracknet_tracker",
            "tracknet",
        ]
    )

    import_errors: list[str] = []
    for module_name in dict.fromkeys(module_names):
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            import_errors.append(f"{module_name}: {exc}")
            continue
        runner = _tracknet_runner_from_module(module)
        if runner is not None:
            return runner, None
        import_errors.append(f"{module_name}: no compatible runner")

    return None, "; ".join(import_errors)


def evaluate_fixture(
    labels_path: Path = LABELS_PATH,
    tolerance_px: float = DEFAULT_MATCH_TOLERANCE_PX,
) -> dict[str, Any]:
    video_path, labels = _load_fixture(labels_path)
    results: list[BackendResult] = [
        _run_backend("opencv", _run_opencv, video_path, labels, tolerance_px)
    ]

    tracknet_runner, tracknet_reason = _load_tracknet_runner()
    if tracknet_runner is None:
        results.append(
            BackendResult(
                name="tracknet",
                status="skipped",
                metrics={},
                reason=tracknet_reason or "TrackNet backend is not available",
            )
        )
    else:
        try:
            results.append(
                _run_backend("tracknet", tracknet_runner, video_path, labels, tolerance_px)
            )
        except Exception as exc:
            results.append(
                BackendResult(
                    name="tracknet",
                    status="skipped",
                    metrics={},
                    reason=f"TrackNet backend could not run: {exc}",
                )
            )

    return {
        "labels": str(labels_path),
        "video": str(video_path),
        "match_tolerance_px": tolerance_px,
        "backends": [
            {
                "name": result.name,
                "status": result.status,
                "metrics": result.metrics,
                "reason": result.reason,
            }
            for result in results
        ],
    }


def test_ball_backend_eval_fixture() -> None:
    """Run the fixture eval under pytest when local labels/video are present."""

    report = evaluate_fixture()
    assert any(backend["name"] == "opencv" and backend["status"] == "ok" for backend in report["backends"])


def main() -> int:
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    report = evaluate_fixture()
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
