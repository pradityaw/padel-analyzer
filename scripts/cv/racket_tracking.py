"""Racket-head tracking for padel match videos.

This module supersedes the wrist-as-racket-head proxy that downstream
clients used to compute "racket speed". Without a trained paddle
detector we cannot reliably localise the racket head from pixels
alone, so we use a hybrid strategy:

1. **Anatomical extrapolation** — given the dominant player's elbow
   and wrist landmarks, project the racket head along the forearm
   axis::

       racket_head = wrist + k * (wrist - elbow)

   ``k`` is a tuned scalar. The anatomical default ``RACKET_EXTRAPOLATION_K
   = 1.2`` corresponds to ~1 racket-length past the wrist for a
   typical padel forearm/racket ratio (forearm ≈ 26 cm, racket ≈ 45 cm
   ⇒ racket head sits ~1.2 forearm lengths past the wrist).

2. **Motion-based refinement (optional)** — when a decoded video frame
   is available we centre a small ROI on the extrapolated position
   and use a grayscale frame difference to localise the brightest
   moving pixel (the racket head usually has the highest angular
   velocity in a swing). The refinement is *only* accepted when the
   motion score crosses a threshold; otherwise the sample is kept as
   "interpolated".

Each emitted :class:`RacketSample` carries a confidence in ``[0, 1]``
and an explicit ``interpolated`` flag. We also collapse those signals
into a *confidence band* so the wire format can be a plain tuple
``(frame_idx, player_id, x, y, confidence)`` where::

    confidence < 0.5  ⇒  interpolated / low-trust (elbow-wrist projection)
    confidence ≥ 0.5  ⇒  motion-refined / high-trust

The module is intentionally dependency-light: it only uses OpenCV and
NumPy (already pinned in ``scripts/cv/requirements.txt``) so it can run
in batch jobs without extra packaging.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Mapping, Optional, Sequence

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Constants & configuration
# ---------------------------------------------------------------------------


#: Anatomical multiplier applied to the elbow→wrist vector to estimate
#: the racket-head position. The default places the racket head roughly
#: one padel-racket length past the wrist (≈ 1.2 forearm lengths).
RACKET_EXTRAPOLATION_K: float = 1.2

#: Lowest confidence we will report for interpolated samples that come
#: from extrapolation alone (no visible motion signal).
INTERPOLATED_CONFIDENCE: float = 0.4

#: Floor confidence reported for samples where the underlying wrist /
#: elbow landmarks were not visible enough to safely extrapolate.
LOW_VISIBILITY_CONFIDENCE: float = 0.2


@dataclass(slots=True)
class RacketTrackingConfig:
    """Tuneable parameters for racket-head extrapolation and refinement."""

    extrapolation_k: float = RACKET_EXTRAPOLATION_K
    """Scalar applied to the (wrist - elbow) vector for projection."""

    min_landmark_visibility: float = 0.3
    """Below this visibility we still emit a (clamped) interpolated sample
    but we lower its confidence to ``LOW_VISIBILITY_CONFIDENCE``."""

    search_radius_ratio: float = 0.5
    """Search-window radius expressed as a fraction of the forearm length.
    Larger values cover smashes with a long backswing; smaller values are
    less likely to lock onto a non-racket moving object."""

    min_search_radius_px: int = 12
    """Hard floor for the search-window radius so very small image-space
    forearms (zoomed-out match footage) still get a usable ROI."""

    max_search_radius_px: int = 96
    """Hard cap so the window cannot spill across half the frame on
    extreme close-ups or when the elbow/wrist briefly collapse."""

    motion_threshold: int = 18
    """Grayscale absolute-difference threshold for motion detection.
    Below this, pixels are treated as static background."""

    min_motion_pixels: int = 20
    """At least this many moving pixels must lie inside the ROI before
    we accept the motion centroid as a refined racket-head estimate."""

    refined_confidence_floor: float = 0.55
    """Lower bound on confidence reported once motion refinement
    succeeds (so refined samples always sit above the interpolated
    band)."""

    refined_confidence_ceiling: float = 0.95
    """Upper bound on confidence reported for refined samples."""


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class LandmarkPoint:
    """A single 2-D pose landmark in image pixels with a visibility score."""

    x: float
    y: float
    visibility: float = 1.0

    def is_visible(self, threshold: float) -> bool:
        return float(self.visibility) >= float(threshold) and math.isfinite(self.x) and math.isfinite(self.y)


@dataclass(slots=True)
class RacketAnchor:
    """The wrist/elbow pair (per player, per frame) feeding the tracker."""

    frame_idx: int
    player_id: int
    timestamp_sec: float
    wrist: LandmarkPoint
    elbow: LandmarkPoint


@dataclass(slots=True)
class RacketSample:
    """A single racket-head observation aligned to a frame and player."""

    frame_idx: int
    player_id: int
    timestamp_sec: float
    x: float
    y: float
    confidence: float
    interpolated: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_idx": int(self.frame_idx),
            "player_id": int(self.player_id),
            "timestamp_sec": float(self.timestamp_sec),
            "x": float(self.x),
            "y": float(self.y),
            "confidence": float(self.confidence),
            "interpolated": bool(self.interpolated),
        }

    def to_tuple(self) -> tuple[int, int, float, float, float]:
        """Wire-format tuple: ``(frame_idx, player_id, x, y, confidence)``.

        Downstream consumers can recover the ``interpolated`` flag by
        checking ``confidence < 0.5`` (the explicit band documented at
        module level).
        """

        return (
            int(self.frame_idx),
            int(self.player_id),
            float(self.x),
            float(self.y),
            float(self.confidence),
        )


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def _clamp_to_bounds(
    x: float, y: float, width: int, height: int
) -> tuple[float, float]:
    """Clamp ``(x, y)`` to the image rectangle ``[0, w-1] × [0, h-1]``.

    Padel smash backswings routinely throw the racket head behind the
    player's head and off-screen; clamping (instead of dropping the
    sample) keeps the per-frame Float32Array dense without lying about
    confidence — those frames still report the lower interpolated
    confidence band.
    """

    if width <= 0 or height <= 0:
        return float(x), float(y)
    cx = max(0.0, min(float(width - 1), float(x)))
    cy = max(0.0, min(float(height - 1), float(y)))
    return cx, cy


def extrapolate_racket_head(
    wrist: LandmarkPoint,
    elbow: LandmarkPoint,
    *,
    k: float = RACKET_EXTRAPOLATION_K,
) -> tuple[float, float]:
    """Project the racket head along the forearm axis.

    Returns the raw (un-clamped) racket-head position. Callers are
    responsible for clamping to frame bounds when they want to keep the
    sample dense.
    """

    dx = float(wrist.x) - float(elbow.x)
    dy = float(wrist.y) - float(elbow.y)
    return float(wrist.x) + float(k) * dx, float(wrist.y) + float(k) * dy


def _forearm_length_px(
    wrist: LandmarkPoint, elbow: LandmarkPoint
) -> float:
    return math.hypot(
        float(wrist.x) - float(elbow.x),
        float(wrist.y) - float(elbow.y),
    )


def _search_radius_px(
    forearm_px: float, config: RacketTrackingConfig
) -> int:
    radius = int(round(forearm_px * float(config.search_radius_ratio)))
    radius = max(int(config.min_search_radius_px), radius)
    radius = min(int(config.max_search_radius_px), radius)
    return max(1, radius)


def _refine_with_motion(
    candidate: tuple[float, float],
    radius: int,
    motion_mask: np.ndarray,
    config: RacketTrackingConfig,
) -> tuple[Optional[tuple[float, float]], int]:
    """Return the centroid of motion pixels inside a square ROI.

    ``motion_mask`` must already be a uint8 image where each non-zero
    pixel is a moving pixel (e.g. produced by ``cv2.absdiff`` followed
    by ``cv2.threshold``). The function clamps the ROI to the mask
    bounds, computes the centroid, and returns it together with the
    moving-pixel count so the caller can decide on a confidence boost.
    """

    if motion_mask.size == 0:
        return None, 0
    height, width = motion_mask.shape[:2]
    cx, cy = candidate
    x0 = max(0, int(math.floor(cx - radius)))
    y0 = max(0, int(math.floor(cy - radius)))
    x1 = min(width, int(math.ceil(cx + radius + 1)))
    y1 = min(height, int(math.ceil(cy + radius + 1)))
    if x1 <= x0 or y1 <= y0:
        return None, 0

    roi = motion_mask[y0:y1, x0:x1]
    count = int(np.count_nonzero(roi))
    if count < int(config.min_motion_pixels):
        return None, count

    moments = cv2.moments(roi, binaryImage=True)
    if moments["m00"] <= 0:
        return None, count
    rx = float(moments["m10"]) / float(moments["m00"]) + float(x0)
    ry = float(moments["m01"]) / float(moments["m00"]) + float(y0)
    return (rx, ry), count


def _confidence_from_motion(
    motion_pixels: int,
    roi_pixels: int,
    config: RacketTrackingConfig,
) -> float:
    if roi_pixels <= 0:
        return float(config.refined_confidence_floor)
    density = float(motion_pixels) / float(roi_pixels)
    # Motion density is bounded above by 1.0; for a fast-moving racket
    # we typically see 5–30% of ROI pixels light up. We map that range
    # into ``[floor, ceiling]`` so the LiveSpeedDash gets a meaningful
    # signal without ever pretending we have full confidence.
    normalised = min(1.0, max(0.0, density / 0.3))
    spread = float(config.refined_confidence_ceiling) - float(
        config.refined_confidence_floor
    )
    return float(config.refined_confidence_floor + normalised * spread)


# ---------------------------------------------------------------------------
# Single-frame tracker
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _FrameContext:
    """Bundle the per-frame inputs the single-frame API needs."""

    width: int
    height: int
    motion_mask: Optional[np.ndarray] = None


class RacketHeadTracker:
    """Frame-by-frame racket-head estimator.

    The tracker is stateless across players — every call processes one
    anchor (wrist + elbow) and produces one :class:`RacketSample`. The
    caller is responsible for maintaining its own previous-frame cache
    if motion-based refinement is desired.
    """

    def __init__(self, config: Optional[RacketTrackingConfig] = None) -> None:
        self._config = config or RacketTrackingConfig()

    @property
    def config(self) -> RacketTrackingConfig:
        return self._config

    def track(
        self,
        anchor: RacketAnchor,
        context: _FrameContext,
    ) -> RacketSample:
        cfg = self._config

        wrist = anchor.wrist
        elbow = anchor.elbow
        visibility_ok = wrist.is_visible(cfg.min_landmark_visibility) and elbow.is_visible(
            cfg.min_landmark_visibility
        )

        raw_x, raw_y = extrapolate_racket_head(
            wrist, elbow, k=cfg.extrapolation_k
        )
        clamped_x, clamped_y = _clamp_to_bounds(
            raw_x, raw_y, context.width, context.height
        )

        if not visibility_ok:
            return RacketSample(
                frame_idx=anchor.frame_idx,
                player_id=anchor.player_id,
                timestamp_sec=anchor.timestamp_sec,
                x=clamped_x,
                y=clamped_y,
                confidence=LOW_VISIBILITY_CONFIDENCE,
                interpolated=True,
            )

        forearm_px = _forearm_length_px(wrist, elbow)
        if forearm_px <= 1.0 or context.motion_mask is None:
            # Forearm collapsed to a point (occlusion) or no motion data
            # available — fall back to the extrapolation.
            return RacketSample(
                frame_idx=anchor.frame_idx,
                player_id=anchor.player_id,
                timestamp_sec=anchor.timestamp_sec,
                x=clamped_x,
                y=clamped_y,
                confidence=INTERPOLATED_CONFIDENCE,
                interpolated=True,
            )

        radius = _search_radius_px(forearm_px, cfg)
        refined, count = _refine_with_motion(
            (clamped_x, clamped_y), radius, context.motion_mask, cfg
        )
        if refined is None:
            return RacketSample(
                frame_idx=anchor.frame_idx,
                player_id=anchor.player_id,
                timestamp_sec=anchor.timestamp_sec,
                x=clamped_x,
                y=clamped_y,
                confidence=INTERPOLATED_CONFIDENCE,
                interpolated=True,
            )

        refined_x, refined_y = _clamp_to_bounds(
            refined[0], refined[1], context.width, context.height
        )
        roi_side = (2 * radius + 1)
        confidence = _confidence_from_motion(count, roi_side * roi_side, cfg)
        return RacketSample(
            frame_idx=anchor.frame_idx,
            player_id=anchor.player_id,
            timestamp_sec=anchor.timestamp_sec,
            x=refined_x,
            y=refined_y,
            confidence=confidence,
            interpolated=False,
        )


# ---------------------------------------------------------------------------
# Video-stream orchestration
# ---------------------------------------------------------------------------


def _build_motion_mask(
    prev_gray: np.ndarray, curr_gray: np.ndarray, threshold: int
) -> np.ndarray:
    diff = cv2.absdiff(curr_gray, prev_gray)
    _, mask = cv2.threshold(diff, int(threshold), 255, cv2.THRESH_BINARY)
    return mask


def _anchors_by_frame(
    anchors: Iterable[RacketAnchor],
) -> dict[int, list[RacketAnchor]]:
    by_frame: dict[int, list[RacketAnchor]] = {}
    for anchor in anchors:
        by_frame.setdefault(int(anchor.frame_idx), []).append(anchor)
    return by_frame


def track_racket_heads_in_video(
    video_path: str,
    anchors: Sequence[RacketAnchor],
    *,
    config: Optional[RacketTrackingConfig] = None,
    capture_factory: Any = cv2.VideoCapture,
) -> list[RacketSample]:
    """Stream a video and refine racket-head positions with motion cues.

    Frames that have no anchor (no detected player) are skipped without
    decoding pose data. The motion mask uses a simple frame-difference
    so the implementation is deterministic and dependency-light.

    The function never throws on a missing video file — if the capture
    cannot be opened we silently fall back to extrapolation-only
    samples so the caller still gets dense output. This matches the
    "no crash on occlusion / glass reflections" rule in
    ``.cursorrules``.
    """

    cfg = config or RacketTrackingConfig()
    tracker = RacketHeadTracker(cfg)
    if not anchors:
        return []

    by_frame = _anchors_by_frame(anchors)
    if not by_frame:
        return []
    max_frame = max(by_frame)

    samples: list[RacketSample] = []

    cap = capture_factory(video_path)
    try:
        opened = bool(getattr(cap, "isOpened", lambda: True)())
    except Exception:
        opened = False

    if not opened:
        # Pure extrapolation path: emit one sample per anchor without
        # the motion refinement. We still clamp to a defensive frame
        # size (0×0) which keeps clamping a no-op.
        for frame_anchors in by_frame.values():
            for anchor in frame_anchors:
                context = _FrameContext(width=0, height=0, motion_mask=None)
                samples.append(tracker.track(anchor, context))
        samples.sort(key=lambda s: (s.frame_idx, s.player_id))
        return samples

    try:
        prev_gray: Optional[np.ndarray] = None
        frame_idx = 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if frame_idx > max_frame:
                break

            height, width = frame.shape[:2]
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            motion_mask: Optional[np.ndarray] = None
            if prev_gray is not None and prev_gray.shape == gray.shape:
                motion_mask = _build_motion_mask(
                    prev_gray, gray, cfg.motion_threshold
                )

            context = _FrameContext(
                width=int(width), height=int(height), motion_mask=motion_mask
            )

            for anchor in by_frame.get(frame_idx, ()):  # type: ignore[arg-type]
                samples.append(tracker.track(anchor, context))

            prev_gray = gray
            frame_idx += 1
    finally:
        try:
            cap.release()
        except Exception:
            pass

    # Anchors past the last decoded frame still get an extrapolation
    # sample so downstream consumers don't see a sudden truncation.
    if frame_idx <= max_frame:
        context = _FrameContext(width=0, height=0, motion_mask=None)
        for missing_frame in range(frame_idx, max_frame + 1):
            for anchor in by_frame.get(missing_frame, ()):  # type: ignore[arg-type]
                samples.append(tracker.track(anchor, context))

    samples.sort(key=lambda s: (s.frame_idx, s.player_id))
    return samples


# ---------------------------------------------------------------------------
# Adapter: MediaPipe-style landmarks → RacketAnchor sequence
# ---------------------------------------------------------------------------


#: MediaPipe Pose landmark indices we rely on. Mirrored here so this
#: module stays self-contained (does not import the JS-side ``LM``
#: constant) but matches ``shared/config.ts``.
_LEFT_ELBOW_IDX = 13
_RIGHT_ELBOW_IDX = 14
_LEFT_WRIST_IDX = 15
_RIGHT_WRIST_IDX = 16


def _landmark_to_pixel(
    landmark: Mapping[str, Any], width: int, height: int
) -> LandmarkPoint:
    raw_x = float(landmark.get("x", float("nan")))
    raw_y = float(landmark.get("y", float("nan")))
    visibility = float(landmark.get("visibility", 1.0))
    if not math.isfinite(raw_x) or not math.isfinite(raw_y):
        return LandmarkPoint(x=float("nan"), y=float("nan"), visibility=0.0)
    # MediaPipe normalises landmark coordinates to ``[0, 1]`` of the
    # input frame. The CV stages we plug into use pixel coordinates,
    # so we project here once (the original landmarks are still passed
    # through untouched on the wire).
    if 0.0 <= raw_x <= 1.0 and 0.0 <= raw_y <= 1.0 and width > 0 and height > 0:
        return LandmarkPoint(
            x=raw_x * float(width),
            y=raw_y * float(height),
            visibility=visibility,
        )
    return LandmarkPoint(x=raw_x, y=raw_y, visibility=visibility)


def build_anchors_from_frame_landmarks(
    frame_landmarks: Sequence[Mapping[str, Any]],
    *,
    dominant_side: str,
    player_id: int = 1,
    video_width: int = 0,
    video_height: int = 0,
    timestamp_unit: str = "ms",
) -> list[RacketAnchor]:
    """Build :class:`RacketAnchor` instances from a MediaPipe payload.

    The mobile/web pipelines emit ``FrameLandmarks`` records of the
    form ``{frameIndex, timestamp, landmarks: [...]}`` where the
    individual ``landmarks`` items are MediaPipe Pose nodes with
    ``x``, ``y``, ``z``, and ``visibility`` fields normalised to
    ``[0, 1]``. We materialise one anchor per frame using the dominant
    arm so downstream tracking always points at the active racket
    hand.
    """

    elbow_idx = _RIGHT_ELBOW_IDX if dominant_side == "right" else _LEFT_ELBOW_IDX
    wrist_idx = _RIGHT_WRIST_IDX if dominant_side == "right" else _LEFT_WRIST_IDX
    anchors: list[RacketAnchor] = []
    for frame in frame_landmarks:
        landmarks = frame.get("landmarks") if isinstance(frame, Mapping) else None
        if not isinstance(landmarks, Sequence) or len(landmarks) <= max(elbow_idx, wrist_idx):
            continue
        elbow_raw = landmarks[elbow_idx]
        wrist_raw = landmarks[wrist_idx]
        if not isinstance(elbow_raw, Mapping) or not isinstance(wrist_raw, Mapping):
            continue
        elbow = _landmark_to_pixel(elbow_raw, video_width, video_height)
        wrist = _landmark_to_pixel(wrist_raw, video_width, video_height)

        raw_timestamp = frame.get("timestamp", 0.0)
        try:
            timestamp = float(raw_timestamp)
        except (TypeError, ValueError):
            timestamp = 0.0
        if timestamp_unit == "ms":
            timestamp_sec = timestamp / 1000.0
        else:
            timestamp_sec = timestamp

        try:
            frame_idx = int(frame.get("frameIndex", 0))
        except (TypeError, ValueError):
            frame_idx = 0

        anchors.append(
            RacketAnchor(
                frame_idx=frame_idx,
                player_id=int(player_id),
                timestamp_sec=timestamp_sec,
                wrist=wrist,
                elbow=elbow,
            )
        )
    return anchors


# ---------------------------------------------------------------------------
# Top-level convenience: video + frame_landmarks → JSON payload
# ---------------------------------------------------------------------------


def _probe_video_dimensions(
    video_path: str,
    capture_factory: Any = cv2.VideoCapture,
) -> tuple[int, int]:
    """Best-effort read of the video dimensions without decoding frames."""

    cap = capture_factory(video_path)
    try:
        opened = bool(getattr(cap, "isOpened", lambda: True)())
    except Exception:
        opened = False
    if not opened:
        try:
            cap.release()
        except Exception:
            pass
        return 0, 0
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        return width, height
    finally:
        try:
            cap.release()
        except Exception:
            pass


def track_racket_heads_from_landmarks(
    video_path: str,
    frame_landmarks: Sequence[Mapping[str, Any]],
    *,
    dominant_side: str = "right",
    player_id: int = 1,
    config: Optional[RacketTrackingConfig] = None,
    capture_factory: Any = cv2.VideoCapture,
) -> dict[str, Any]:
    """Run the racket-head tracker for a single player and return JSON.

    The returned payload has the shape::

        {
          "players": [
            {
              "player_id": int,
              "dominant_side": "left" | "right",
              "samples": [
                {frame_idx, player_id, timestamp_sec, x, y, confidence, interpolated},
                ...
              ]
            }
          ],
          "summary": {
            "sample_count": int,
            "refined_count": int,
            "interpolated_count": int,
            "video_width": int,
            "video_height": int,
            "extrapolation_k": float
          }
        }

    The schema is JSON-serialisable and intentionally mirrors the
    ``ball_track`` payload so the Node bridge in
    ``server/lib/racketTracking.ts`` can normalise both with the same
    pattern.
    """

    cfg = config or RacketTrackingConfig()
    width, height = _probe_video_dimensions(video_path, capture_factory)
    anchors = build_anchors_from_frame_landmarks(
        frame_landmarks,
        dominant_side=dominant_side,
        player_id=player_id,
        video_width=width,
        video_height=height,
    )
    samples = track_racket_heads_in_video(
        video_path, anchors, config=cfg, capture_factory=capture_factory
    )

    refined = sum(1 for s in samples if not s.interpolated)
    interpolated = len(samples) - refined
    return {
        "players": [
            {
                "player_id": int(player_id),
                "dominant_side": str(dominant_side),
                "samples": [s.to_dict() for s in samples],
            }
        ],
        "summary": {
            "sample_count": int(len(samples)),
            "refined_count": int(refined),
            "interpolated_count": int(interpolated),
            "video_width": int(width),
            "video_height": int(height),
            "extrapolation_k": float(cfg.extrapolation_k),
        },
    }


# ---------------------------------------------------------------------------
# Per-frame multi-player streaming API (used by run_pipeline.py)
# ---------------------------------------------------------------------------


def iter_racket_samples(
    video_path: str,
    anchors: Sequence[RacketAnchor],
    *,
    config: Optional[RacketTrackingConfig] = None,
    capture_factory: Any = cv2.VideoCapture,
) -> Iterator[RacketSample]:
    """Streaming variant — yields samples one at a time."""

    for sample in track_racket_heads_in_video(
        video_path, anchors, config=config, capture_factory=capture_factory
    ):
        yield sample


__all__ = [
    "INTERPOLATED_CONFIDENCE",
    "LOW_VISIBILITY_CONFIDENCE",
    "LandmarkPoint",
    "RACKET_EXTRAPOLATION_K",
    "RacketAnchor",
    "RacketHeadTracker",
    "RacketSample",
    "RacketTrackingConfig",
    "build_anchors_from_frame_landmarks",
    "extrapolate_racket_head",
    "iter_racket_samples",
    "track_racket_heads_from_landmarks",
    "track_racket_heads_in_video",
]
