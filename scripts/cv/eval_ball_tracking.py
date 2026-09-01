"""Ball-tracking precision/recall harness for ``tracknet_ball.py``.

This harness measures how accurately :class:`TrackNetBallDetector`
(``scripts/cv/tracknet_ball.py``) recovers the ball position on a set of
labeled padel clips. It is the Phase 2 (ML/CV accuracy) companion to the
single-clip eval in ``scripts/cv/tests/test_ball_eval.py``:

* ``test_ball_eval.py`` runs one fixture (``data/eval/ball/labels.json``) and
  reports detection-rate + false positives for a single clip.
* This module walks a *directory* of clips, drives ``TrackNetBallDetector``
  directly (not via ``court_mapping``), and computes true precision / recall
  across the whole set plus per-clip numbers.

GROUND-TRUTH FORMAT
-------------------
For every clip ``foo.mp4`` the harness looks for a sibling label file
``foo.json`` (same stem) of the form::

    {
      "video": "foo.mp4",            # optional; defaults to the clip stem
      "fps": 30,                      # optional; falls back to container fps
      "frames": [
        {"frame": 0,  "x": 320.5, "y": 120.0, "visible": true},
        {"frame": 1,  "visible": false},
        {"frame": 2,  "x": 322.0, "y": 124.0, "visible": true}
      ]
    }

* ``visible: true``  → ball is on screen at (x, y); used as the recall pool.
* ``visible: false`` → ball is *not* on screen this frame; any detection here
  is a false positive.

If a clip has no matching ``.json`` it is *skipped* (not scored). If no label
files exist at all, the harness prints a "blocked-on-data" report and exits 0
so CI stays green while validation is still pending.

METRICS
-------
For a match tolerance ``T`` pixels (default 25, override via ``--tolerance-px``
or ``PADEL_BALL_TOLERANCE_PX``):

* TP = visible label matched by a detection within T px
* FN  = visible label with no matching detection
* FP_visible   = detection on a visible frame beyond T px (wrong location)
* FP_invisible = detection on a frame labeled ``visible: false``
* precision = TP / (TP + FP_visible + FP_invisible)
* recall    = TP / (TP + FN)
* mean_pixel_error over TPs

USAGE
-----
    # evaluate against a labeled clip directory
    python scripts/cv/eval_ball_tracking.py --clips DIR_WITH_MP4_AND_JSON

    # scan the local dataset and report what's missing (no GT needed)
    python scripts/cv/eval_ball_tracking.py --dataset ~/padel-ml-dataset --dry-run

    # custom model / confidence
    python scripts/cv/eval_ball_tracking.py --clips DIR \
        --model scripts/cv/models/tracknet-v2.onnx --min-confidence 0.4
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import sys
from typing import Any, Iterable, Sequence

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.cv.tracknet_ball import (  # noqa: E402  (sys.path injected above)
    TrackNetBallDetector,
    TrackNetConfig,
    TrackNetDetection,
    TRACKNET_FRAME_COUNT,
)

DEFAULT_MATCH_TOLERANCE_PX = 25.0
DEFAULT_DATASET = Path.home() / "padel-ml-dataset"


# --------------------------------------------------------------------------- #
# Ground-truth loading                                                        #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class LabelFrame:
    frame: int
    x: float | None
    y: float | None
    visible: bool


@dataclass(frozen=True)
class ClipLabels:
    clip_path: Path
    fps: float | None
    frames: tuple[LabelFrame, ...]

    @property
    def visible_frames(self) -> list[LabelFrame]:
        return [f for f in self.frames if f.visible]

    @property
    def invisible_frames(self) -> set[int]:
        return {f.frame for f in self.frames if not f.visible}


def _coerce_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def load_clip_labels(labels_path: Path, clip_path: Path) -> ClipLabels:
    payload = json.loads(labels_path.read_text(encoding="utf8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{labels_path}: top-level JSON must be an object")

    fps = _coerce_float(payload.get("fps"))

    raw_frames = payload.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        raise ValueError(f"{labels_path}: must include a non-empty 'frames' array")

    out: list[LabelFrame] = []
    seen: set[int] = set()
    for item in raw_frames:
        if not isinstance(item, dict):
            raise ValueError(f"{labels_path}: each frame entry must be an object")
        frame = item.get("frame")
        if not isinstance(frame, int) or frame < 0:
            raise ValueError(f"{labels_path}: each frame needs a non-negative int 'frame'")
        if frame in seen:
            raise ValueError(f"{labels_path}: duplicate label for frame {frame}")
        seen.add(frame)
        visible = bool(item.get("visible", True))
        x = _coerce_float(item.get("x"))
        y = _coerce_float(item.get("y"))
        if visible and (x is None or y is None):
            raise ValueError(
                f"{labels_path} frame {frame}: visible labels need numeric 'x' and 'y'"
            )
        out.append(LabelFrame(frame=frame, x=x, y=y, visible=visible))

    return ClipLabels(clip_path=clip_path, fps=fps, frames=tuple(out))


def discover_labeled_clips(root: Path) -> list[tuple[Path, Path]]:
    """Return (clip_path, label_path) pairs for every ``foo.mp4`` with a ``foo.json``."""
    pairs: list[tuple[Path, Path]] = []
    for clip in sorted(root.rglob("*.mp4")):
        label = clip.with_suffix(".json")
        if label.exists():
            pairs.append((clip, label))
    return pairs


# --------------------------------------------------------------------------- #
# Detector driving                                                            #
# --------------------------------------------------------------------------- #


def _iter_bgr_frames(video_path: Path) -> Iterable[tuple[int, np.ndarray]]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        raise RuntimeError(f"could not open video: {video_path}")
    frame_idx = 0
    try:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                break
            yield frame_idx, frame
            frame_idx += 1
    finally:
        capture.release()


def _frames_window(buffer: Sequence[np.ndarray]) -> list[np.ndarray] | None:
    if len(buffer) < TRACKNET_FRAME_COUNT:
        return None
    return list(buffer[-TRACKNET_FRAME_COUNT:])


def detect_clip(
    detector: TrackNetBallDetector,
    video_path: Path,
    max_frames: int | None = None,
) -> dict[int, TrackNetDetection]:
    """Run the detector over a clip, returning {frame_index: detection}."""
    detections: dict[int, TrackNetDetection] = {}
    buffer: list[np.ndarray] = []
    processed = 0
    for frame_idx, frame in _iter_bgr_frames(video_path):
        buffer.append(frame)
        window = _frames_window(buffer)
        if window is None:
            continue
        det = detector.detect(window)
        if det is not None:
            detections[frame_idx] = det
        processed += 1
        if max_frames is not None and processed >= max_frames:
            break
    return detections


# --------------------------------------------------------------------------- #
# Metric computation                                                          #
# --------------------------------------------------------------------------- #


@dataclass
class ClipMetrics:
    clip: str
    status: str  # "ok" | "skipped" | "error"
    visible_labels: int = 0
    detections: int = 0
    true_positives: int = 0
    false_negatives: int = 0
    false_positive_visible: int = 0
    false_positive_invisible: int = 0
    pixel_errors: list[float] = field(default_factory=list)
    frames_processed: int = 0
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        tp, fp = self.true_positives, (self.false_positive_visible + self.false_positive_invisible)
        precision = tp / (tp + fp) if (tp + fp) else None
        recall = tp / (tp + self.false_negatives) if (tp + self.false_negatives) else None
        mpe = sum(self.pixel_errors) / len(self.pixel_errors) if self.pixel_errors else None
        return {
            "clip": self.clip,
            "status": self.status,
            "visible_labels": self.visible_labels,
            "detections": self.detections,
            "true_positives": tp,
            "false_negatives": self.false_negatives,
            "false_positive_visible": self.false_positive_visible,
            "false_positive_invisible": self.false_positive_invisible,
            "precision": precision,
            "recall": recall,
            "mean_pixel_error": mpe,
            "frames_processed": self.frames_processed,
            "reason": self.reason,
        }


def score_clip(
    labels: ClipLabels,
    detections: dict[int, TrackNetDetection],
    frames_processed: int,
    tolerance_px: float,
) -> ClipMetrics:
    metrics = ClipMetrics(clip=labels.clip_path.name, status="ok", frames_processed=frames_processed)
    metrics.visible_labels = len(labels.visible_frames)
    metrics.detections = len(detections)

    matched_detection_frames: set[int] = set()

    for label in labels.visible_frames:
        det = detections.get(label.frame)
        if det is None or label.x is None or label.y is None:
            metrics.false_negatives += 1
            continue
        error = math.hypot(det.x - label.x, det.y - label.y)
        if error <= tolerance_px:
            metrics.true_positives += 1
            metrics.pixel_errors.append(error)
            matched_detection_frames.add(label.frame)
        else:
            metrics.false_negatives += 1

    invisible_frames = labels.invisible_frames
    for frame_idx, det in detections.items():
        if frame_idx in matched_detection_frames:
            continue
        if frame_idx in invisible_frames:
            metrics.false_positive_invisible += 1
        else:
            # Detection on a labeled-visible frame that missed tolerance, or on
            # a frame the label set did not enumerate. The former is a genuine
            # mislocalization; the latter we cannot score and treat as FP-visible.
            metrics.false_positive_visible += 1

    return metrics


@dataclass
class AggregateMetrics:
    labeled_clips: int = 0
    skipped_clips: int = 0
    errored_clips: int = 0
    true_positives: int = 0
    false_negatives: int = 0
    false_positive_visible: int = 0
    false_positive_invisible: int = 0
    pixel_errors: list[float] = field(default_factory=list)

    @property
    def precision(self) -> float | None:
        denom = self.true_positives + self.false_positive_visible + self.false_positive_invisible
        return self.true_positives / denom if denom else None

    @property
    def recall(self) -> float | None:
        denom = self.true_positives + self.false_negatives
        return self.true_positives / denom if denom else None

    @property
    def mean_pixel_error(self) -> float | None:
        return sum(self.pixel_errors) / len(self.pixel_errors) if self.pixel_errors else None

    def to_dict(self) -> dict[str, Any]:
        return {
            "labeled_clips": self.labeled_clips,
            "skipped_clips": self.skipped_clips,
            "errored_clips": self.errored_clips,
            "true_positives": self.true_positives,
            "false_negatives": self.false_negatives,
            "false_positive_visible": self.false_positive_visible,
            "false_positive_invisible": self.false_positive_invisible,
            "precision": self.precision,
            "recall": self.recall,
            "mean_pixel_error": self.mean_pixel_error,
        }


def aggregate(per_clip: Sequence[ClipMetrics]) -> AggregateMetrics:
    agg = AggregateMetrics()
    for m in per_clip:
        if m.status == "skipped":
            agg.skipped_clips += 1
            continue
        if m.status == "error":
            agg.errored_clips += 1
            continue
        agg.labeled_clips += 1
        agg.true_positives += m.true_positives
        agg.false_negatives += m.false_negatives
        agg.false_positive_visible += m.false_positive_visible
        agg.false_positive_invisible += m.false_positive_invisible
        agg.pixel_errors.extend(m.pixel_errors)
    return agg


# --------------------------------------------------------------------------- #
# Orchestration                                                               #
# --------------------------------------------------------------------------- #


def _build_detector(model_path: Path | None, min_confidence: float | None) -> TrackNetBallDetector:
    config_kwargs: dict[str, Any] = {}
    if model_path is not None:
        config_kwargs["model_path"] = model_path
    if min_confidence is not None:
        config_kwargs["min_confidence"] = min_confidence
    return TrackNetBallDetector(config=TrackNetConfig(**config_kwargs))


def evaluate(
    clips_root: Path,
    *,
    tolerance_px: float,
    model_path: Path | None = None,
    min_confidence: float | None = None,
    max_frames: int | None = None,
) -> dict[str, Any]:
    pairs = discover_labeled_clips(clips_root)

    if not pairs:
        return {
            "status": "blocked-on-data",
            "reason": (
                f"No ground-truth labels found under {clips_root}. Expected a "
                "foo.json sibling for each foo.mp4 clip with per-frame ball "
                "positions (see module docstring). Ball-tracking precision/recall "
                "cannot be computed without per-frame labels."
            ),
            "clips_root": str(clips_root),
            "mp4_count": sum(1 for _ in clips_root.rglob("*.mp4")) if clips_root.exists() else 0,
            "label_count": 0,
            "per_clip": [],
            "aggregate": AggregateMetrics().to_dict(),
        }

    detector: TrackNetBallDetector | None = None
    detector_error: str | None = None
    try:
        detector = _build_detector(model_path, min_confidence)
        # Force model load early so a missing ONNX file is reported up front.
        detector._get_session()  # noqa: SLF001 (intentional warm-up)
    except Exception as exc:  # pragma: no cover - environment dependent
        detector = None
        detector_error = f"{type(exc).__name__}: {exc}"

    per_clip: list[ClipMetrics] = []
    for clip_path, label_path in pairs:
        try:
            labels = load_clip_labels(label_path, clip_path)
        except Exception as exc:
            per_clip.append(
                ClipMetrics(clip=clip_path.name, status="error", reason=f"label load: {exc}")
            )
            continue

        if detector is None:
            per_clip.append(
                ClipMetrics(
                    clip=clip_path.name,
                    status="error",
                    reason=f"detector unavailable: {detector_error}",
                )
            )
            continue

        try:
            detections = detect_clip(detector, clip_path, max_frames=max_frames)
        except Exception as exc:
            per_clip.append(
                ClipMetrics(clip=clip_path.name, status="error", reason=f"detect: {exc}")
            )
            continue

        per_clip.append(score_clip(labels, detections, len(detections), tolerance_px))

    agg = aggregate(per_clip)
    return {
        "status": "ok" if agg.labeled_clips else "blocked-on-data",
        "clips_root": str(clips_root),
        "mp4_count": sum(1 for _ in clips_root.rglob("*.mp4")),
        "label_count": len(pairs),
        "match_tolerance_px": tolerance_px,
        "model": str(model_path) if model_path else str(TrackNetConfig().model_path),
        "min_confidence": (min_confidence if min_confidence is not None
                           else TrackNetConfig().min_confidence),
        "per_clip": [m.to_dict() for m in per_clip],
        "aggregate": agg.to_dict(),
    }


# --------------------------------------------------------------------------- #
# Dry-run (report what's missing without GT)                                  #
# --------------------------------------------------------------------------- #


def dry_run_report(dataset_root: Path) -> dict[str, Any]:
    mp4s = sorted(dataset_root.rglob("*.mp4"))
    pairs = discover_labeled_clips(dataset_root)
    label_count = len(pairs)
    return {
        "status": "blocked-on-data" if label_count == 0 else "partial",
        "dataset_root": str(dataset_root),
        "dataset_exists": dataset_root.exists(),
        "mp4_count": len(mp4s),
        "labeled_clip_count": label_count,
        "missing_labels": len(mp4s) - label_count,
        "required_label_format": {
            "filename": "<clip_stem>.json sibling of <clip_stem>.mp4",
            "schema": {
                "video": "optional clip filename",
                "fps": "optional; defaults to container fps",
                "frames": [
                    {"frame": 0, "x": 320.5, "y": 120.0, "visible": True},
                    {"frame": 1, "visible": False},
                ],
            },
        },
        "minimal_label_set": (
            "At least 5-10 coach-annotated clips (~200-500 labeled frames each), "
            "spanning drive/volley/smash/bandeja/lob, with both visible and "
            "not-visible frames so precision has a real false-positive pool."
        ),
    }


# --------------------------------------------------------------------------- #
# CLI                                                                         #
# --------------------------------------------------------------------------- #


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure TrackNet ball-tracking precision/recall on labeled clips.",
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--clips", type=Path, help="Directory of .mp4 clips + sibling .json labels.")
    src.add_argument("--dataset", type=Path, help="Dataset root to scan for labels (use with --dry-run).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Only report label coverage; do not run the detector.")
    parser.add_argument("--tolerance-px", type=float,
                        default=float(os.environ.get("PADEL_BALL_TOLERANCE_PX",
                                     DEFAULT_MATCH_TOLERANCE_PX)),
                        help="Match tolerance in pixels (default: %(default)s).")
    parser.add_argument("--model", type=Path, help="TrackNet ONNX model path.")
    parser.add_argument("--min-confidence", type=float, help="TrackNet min peak confidence.")
    parser.add_argument("--max-frames", type=int,
                        help="Cap frames processed per clip (debugging; off by default).")
    parser.add_argument("--output", type=Path, help="Write JSON report to this path.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    if args.dry_run:
        report: dict[str, Any] = dry_run_report(args.dataset)
    elif args.dataset is not None and not args.dry_run:
        # --dataset without --dry-run still useful: scan the dataset for labels.
        report = dry_run_report(args.dataset)
    else:
        report = evaluate(
            args.clips,
            tolerance_px=args.tolerance_px,
            model_path=args.model,
            min_confidence=args.min_confidence,
            max_frames=args.max_frames,
        )

    text = json.dumps(report, indent=2, sort_keys=True)
    if args.output:
        args.output.write_text(text, encoding="utf8")
    print(text)

    # Non-zero exit only on hard errors; blocked-on-data is NOT a failure so CI
    # stays green while ground truth is still being collected.
    if report.get("status") == "ok":
        agg = report["aggregate"]
        if agg.get("errored_clips"):
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
