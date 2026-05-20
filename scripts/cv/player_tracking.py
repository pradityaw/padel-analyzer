"""Player movement tracking, distance computation, and heatmap generation
for padel match videos.

This module implements Phase 3 of the Padel Video Analyzer CV pipeline:

* :class:`PlayerDetector` finds human-sized blobs in a frame using a MOG2
  background subtractor and morphological cleanup (no deep learning).
* :class:`PlayerTracker` associates detections to track identities across
  consecutive frames using centroid distance and IoU heuristics.
* :class:`PlayerMovementAnalyzer` orchestrates everything: it streams a
  video, restricts processing to rally windows produced by Phase 1's
  dead-time trimmer, optionally projects centroids into bird's-eye court
  coordinates via a Phase 2 :class:`CourtMapper`, and reports per-rally
  movement statistics.
* :func:`compute_distance_meters`, :func:`build_heatmap`, and
  :func:`build_overlay_payload` are pure utilities for converting tracks
  into JSON-serializable analytics suitable for a UI overlay.

The module is fully standalone: no client or server imports, no
PyTorch/TensorFlow/Mediapipe. The sibling Phase 1/2 modules are imported
lazily so this file remains testable in isolation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Optional, Protocol, Sequence

import cv2
import numpy as np


# ---------------------------------------------------------------------------
# Optional sibling integrations (Phase 1 + Phase 2)
# ---------------------------------------------------------------------------

# We rely only on duck-typing for ``Rally`` (any object exposing
# ``rally_id``, ``start_sec`` and ``end_sec``) and for ``CourtMapper`` (any
# object exposing ``image_to_court((x, y))``). The lazy imports below exist
# purely for IDE help; failure to import does not break this module.
try:  # pragma: no cover - environmental import
    from .dead_time_trimmer import Rally as _Rally  # noqa: F401
except Exception:  # pragma: no cover
    try:
        from dead_time_trimmer import Rally as _Rally  # type: ignore[no-redef]  # noqa: F401
    except Exception:
        _Rally = None  # type: ignore[assignment]

try:  # pragma: no cover - environmental import
    from .court_mapping import CourtMapper as _CourtMapper  # noqa: F401
except Exception:  # pragma: no cover
    try:
        from court_mapping import CourtMapper as _CourtMapper  # type: ignore[no-redef]  # noqa: F401
    except Exception:
        _CourtMapper = None  # type: ignore[assignment]


class CourtMapperLike(Protocol):
    """Minimal protocol the analyzer expects from a court mapper.

    Anything implementing :meth:`image_to_court` returning ``(x_m, y_m)``
    is acceptable, including :class:`scripts.cv.court_mapping.CourtMapper`.
    """

    def image_to_court(self, point: Sequence[float]) -> tuple[float, float]:
        ...


class _PayloadCourtMapper:
    """Adapter for the JSON court payload emitted by ``court_mapping``.

    The server pipeline passes the serialized Phase 2 court dictionary rather
    than a live ``CourtMapper`` instance. This tiny adapter keeps Phase 3
    useful in that integration path without coupling the modules together.
    """

    def __init__(self, payload: Mapping[str, Any]) -> None:
        court = payload.get("court", payload)
        if not isinstance(court, Mapping):
            raise TypeError("Court payload must be a mapping")
        matrix = court.get("homography")
        if matrix is None:
            raise ValueError("Court payload does not include a homography")
        self._matrix = np.asarray(matrix, dtype=np.float32)
        if self._matrix.shape != (3, 3):
            raise ValueError("Court homography must be a 3x3 matrix")

    def image_to_court(self, point: Sequence[float]) -> tuple[float, float]:
        src = np.asarray([[[float(point[0]), float(point[1])]]], dtype=np.float32)
        mapped = cv2.perspectiveTransform(src, self._matrix)[0, 0]
        return (float(mapped[0]), float(mapped[1]))


def _coerce_court_mapper(
    court_mapper: Optional[CourtMapperLike | Mapping[str, Any]],
) -> Optional[CourtMapperLike]:
    """Return a mapper-like object from a live mapper or serialized payload."""

    if court_mapper is None:
        return None
    if hasattr(court_mapper, "image_to_court"):
        return court_mapper  # type: ignore[return-value]
    if isinstance(court_mapper, Mapping):
        try:
            return _PayloadCourtMapper(court_mapper)
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# Configuration & data models
# ---------------------------------------------------------------------------


@dataclass
class PlayerTrackingConfig:
    """Tuneable parameters for player detection, tracking, and analytics.

    Defaults are calibrated for 720p / 30 fps padel footage and a regulation
    10m x 20m court.
    """

    # ---- Detector (MOG2 + morph + contour) ----
    mog2_history: int = 200
    """History length for the MOG2 background subtractor."""

    mog2_var_threshold: float = 25.0
    """Variance threshold for the MOG2 background subtractor."""

    morph_kernel_size: int = 5
    """Square kernel size for morphological open/close (must be odd)."""

    min_player_area_px: float = 800.0
    """Minimum contour area (px^2) to be considered a player blob."""

    max_player_area_px: float = 80_000.0
    """Maximum contour area (px^2) to be considered a player blob."""

    min_aspect_ratio: float = 1.1
    """Minimum bounding-box height/width ratio (humans are taller than wide)."""

    max_aspect_ratio: float = 5.0
    """Maximum bounding-box height/width ratio."""

    # ---- Tracker ----
    max_players: int = 4
    """Maximum number of simultaneously active tracks (4 for padel doubles)."""

    iou_match_threshold: float = 0.2
    """IoU above which a detection may match an existing track."""

    centroid_match_distance_px: float = 120.0
    """Centroid distance (px) within which a detection may match a track."""

    max_missed_frames: int = 15
    """Frames a track may survive without a detection before being retired."""

    min_track_lifetime_frames: int = 2
    """Minimum number of observations required to keep a retired track."""

    # ---- Distance computation ----
    smoothing_window_frames: int = 3
    """Moving-average window applied to court positions before integration."""

    max_step_m: float = 2.5
    """Maximum plausible single-frame step in meters (teleport rejection)."""

    max_step_px: float = 200.0
    """Maximum plausible single-frame step in pixels when no mapper is set."""

    # ---- Heatmap ----
    heatmap_grid_cols: int = 20
    """Heatmap grid columns spanning the court width."""

    heatmap_grid_rows: int = 40
    """Heatmap grid rows spanning the court length."""

    heatmap_blur_sigma: float = 1.5
    """Gaussian blur sigma applied to the heatmap (0 disables blurring)."""

    # ---- Court dimensions ----
    court_width_m: float = 10.0
    """Court width in meters (x axis)."""

    court_height_m: float = 20.0
    """Court length in meters (y axis)."""


@dataclass
class PlayerObservation:
    """A single per-frame detection associated with a tracked player."""

    frame_idx: int
    timestamp_sec: float
    bbox: list[int]
    centroid_image: list[float]
    centroid_court_m: Optional[list[float]]
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_idx": int(self.frame_idx),
            "timestamp_sec": float(self.timestamp_sec),
            "bbox": [int(v) for v in self.bbox],
            "centroid_image": [float(v) for v in self.centroid_image],
            "centroid_court_m": (
                None
                if self.centroid_court_m is None
                else [float(v) for v in self.centroid_court_m]
            ),
            "confidence": float(self.confidence),
        }


@dataclass
class PlayerTrack:
    """Aggregated movement history for a single tracked player."""

    player_id: int
    observations: list[PlayerObservation] = field(default_factory=list)
    total_distance_m: float = 0.0
    first_seen_sec: float = 0.0
    last_seen_sec: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "player_id": int(self.player_id),
            "observations": [o.to_dict() for o in self.observations],
            "total_distance_m": float(self.total_distance_m),
            "first_seen_sec": float(self.first_seen_sec),
            "last_seen_sec": float(self.last_seen_sec),
        }


@dataclass
class RallyPlayerStats:
    """Per-rally movement summary for every player observed in the rally."""

    rally_id: int
    start_sec: float
    end_sec: float
    per_player: dict[int, dict[str, float]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "rally_id": int(self.rally_id),
            "start_sec": float(self.start_sec),
            "end_sec": float(self.end_sec),
            "per_player": {
                str(pid): {k: float(v) for k, v in stats.items()}
                for pid, stats in self.per_player.items()
            },
        }


@dataclass
class HeatmapData:
    """Normalized 2D occupancy heatmap for a single player."""

    player_id: int
    grid_cols: int
    grid_rows: int
    court_width_m: float
    court_height_m: float
    cells: list[list[float]]
    raw_counts: list[list[int]]
    sample_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "player_id": int(self.player_id),
            "grid_cols": int(self.grid_cols),
            "grid_rows": int(self.grid_rows),
            "court_width_m": float(self.court_width_m),
            "court_height_m": float(self.court_height_m),
            "cells": [[float(v) for v in row] for row in self.cells],
            "raw_counts": [[int(v) for v in row] for row in self.raw_counts],
            "sample_count": int(self.sample_count),
        }


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------


class PlayerDetector:
    """MOG2-based human blob detector with morphological cleanup.

    Frames must be supplied in temporal order (the underlying background
    subtractor is stateful). Call :meth:`reset` between unrelated video
    segments to relearn the background model.
    """

    def __init__(self, config: Optional[PlayerTrackingConfig] = None) -> None:
        self._config = config or PlayerTrackingConfig()
        self._subtractor = self._make_subtractor()

    def _make_subtractor(self) -> "cv2.BackgroundSubtractorMOG2":
        return cv2.createBackgroundSubtractorMOG2(
            history=int(self._config.mog2_history),
            varThreshold=float(self._config.mog2_var_threshold),
            detectShadows=False,
        )

    def reset(self) -> None:
        """Reinitialise the background model (call between rally segments)."""
        self._subtractor = self._make_subtractor()

    def detect(self, frame: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Return candidate player bounding boxes for *frame*.

        Each box is ``(x, y, w, h)`` in image coordinates. The list is
        sorted by area descending and trimmed to ``max_players``.
        """

        if frame is None or frame.size == 0:
            return []

        fg = self._subtractor.apply(frame)
        # Drop shadow / soft values; we configured detectShadows=False so
        # this is a no-op in practice but cheap insurance.
        _, fg = cv2.threshold(fg, 127, 255, cv2.THRESH_BINARY)

        kernel = max(3, int(self._config.morph_kernel_size) | 1)
        struct = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel, kernel))
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, struct)
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, struct)

        contours, _ = cv2.findContours(
            fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        boxes: list[tuple[int, int, int, int, float]] = []
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < self._config.min_player_area_px:
                continue
            if area > self._config.max_player_area_px:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w <= 0 or h <= 0:
                continue
            aspect = float(h) / float(w)
            if aspect < self._config.min_aspect_ratio:
                continue
            if aspect > self._config.max_aspect_ratio:
                continue
            boxes.append((int(x), int(y), int(w), int(h), area))

        boxes.sort(key=lambda b: b[4], reverse=True)
        trimmed = boxes[: int(self._config.max_players)]
        return [(b[0], b[1], b[2], b[3]) for b in trimmed]


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------


@dataclass
class _ActiveTrack:
    """Internal book-keeping for a track that is still receiving updates."""

    player_id: int
    last_bbox: tuple[int, int, int, int]
    last_frame_idx: int
    missed: int = 0
    observations: list[PlayerObservation] = field(default_factory=list)


class PlayerTracker:
    """Greedy multi-object tracker keyed by stable integer player ids.

    Associates incoming detections to existing tracks using a combination
    of centroid distance and IoU. Unmatched detections spawn new tracks
    up to ``config.max_players``. Tracks that miss too many frames are
    moved to ``retired_tracks`` and eventually returned by
    :meth:`finalize`.
    """

    def __init__(
        self,
        config: Optional[PlayerTrackingConfig] = None,
        *,
        starting_id: int = 1,
    ) -> None:
        self._config = config or PlayerTrackingConfig()
        self.active_tracks: dict[int, _ActiveTrack] = {}
        self.retired_tracks: list[_ActiveTrack] = []
        self._next_id = int(starting_id)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def next_id(self) -> int:
        """Next id this tracker would assign (useful when chaining trackers)."""
        return self._next_id

    def update(
        self,
        detections: Sequence[tuple[int, int, int, int]],
        frame_idx: int,
        timestamp_sec: float,
        court_mapper: Optional[CourtMapperLike] = None,
    ) -> dict[int, PlayerObservation]:
        """Ingest a frame of detections and return the new observations.

        Args:
            detections: List of ``(x, y, w, h)`` bounding boxes.
            frame_idx: Zero-based frame index in the source video.
            timestamp_sec: Time of the frame in seconds.
            court_mapper: Optional court mapper for image→court projection.

        Returns:
            Mapping of ``player_id`` to the freshly created observation
            for that player (empty if no detections matched/spawned).
        """

        matches, unmatched_dets, unmatched_tracks = self._match(detections)
        produced: dict[int, PlayerObservation] = {}

        for track_id, det_idx in matches:
            bbox = tuple(int(v) for v in detections[det_idx])  # type: ignore[assignment]
            track = self.active_tracks[track_id]
            obs = self._build_observation(
                bbox=bbox,
                frame_idx=frame_idx,
                timestamp_sec=timestamp_sec,
                court_mapper=court_mapper,
            )
            track.last_bbox = bbox
            track.last_frame_idx = frame_idx
            track.missed = 0
            track.observations.append(obs)
            produced[track_id] = obs

        for det_idx in unmatched_dets:
            if len(self.active_tracks) >= int(self._config.max_players):
                break
            bbox = tuple(int(v) for v in detections[det_idx])  # type: ignore[assignment]
            new_id = self._next_id
            self._next_id += 1
            obs = self._build_observation(
                bbox=bbox,
                frame_idx=frame_idx,
                timestamp_sec=timestamp_sec,
                court_mapper=court_mapper,
            )
            self.active_tracks[new_id] = _ActiveTrack(
                player_id=new_id,
                last_bbox=bbox,
                last_frame_idx=frame_idx,
                missed=0,
                observations=[obs],
            )
            produced[new_id] = obs

        for track_id in unmatched_tracks:
            track = self.active_tracks[track_id]
            track.missed += 1

        self._retire_stale()
        return produced

    def finalize(self, *, drop_short: bool = True) -> list[PlayerTrack]:
        """Move all active tracks into ``retired_tracks`` and return tracks.

        Tracks with fewer than ``config.min_track_lifetime_frames`` are
        dropped when ``drop_short`` is true. The returned list is sorted by
        ``player_id``.
        """

        for track in list(self.active_tracks.values()):
            self.retired_tracks.append(track)
        self.active_tracks.clear()

        out: list[PlayerTrack] = []
        for active in sorted(self.retired_tracks, key=lambda t: t.player_id):
            if drop_short and len(active.observations) < int(
                self._config.min_track_lifetime_frames
            ):
                continue
            out.append(self._to_player_track(active))
        return out

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_observation(
        self,
        bbox: tuple[int, int, int, int],
        frame_idx: int,
        timestamp_sec: float,
        court_mapper: Optional[CourtMapperLike],
    ) -> PlayerObservation:
        x, y, w, h = bbox
        # We use the feet centroid (bottom-center of the bounding box) as
        # the canonical court position: it is the part of the player that
        # touches the playing surface, so it projects most cleanly through
        # the court homography.
        cx = float(x) + float(w) / 2.0
        cy = float(y) + float(h)
        court: Optional[list[float]] = None
        if court_mapper is not None:
            try:
                mapped = court_mapper.image_to_court((cx, cy))
                court = [float(mapped[0]), float(mapped[1])]
            except Exception:
                court = None
        confidence = self._confidence(w, h)
        return PlayerObservation(
            frame_idx=int(frame_idx),
            timestamp_sec=float(timestamp_sec),
            bbox=[int(x), int(y), int(w), int(h)],
            centroid_image=[cx, cy],
            centroid_court_m=court,
            confidence=confidence,
        )

    def _confidence(self, w: int, h: int) -> float:
        cfg = self._config
        area = float(w) * float(h)
        span = max(1.0, cfg.max_player_area_px - cfg.min_player_area_px)
        a_mid = (cfg.min_player_area_px + cfg.max_player_area_px) / 2.0
        area_score = max(0.0, 1.0 - abs(area - a_mid) / span)
        if w <= 0:
            aspect_score = 0.0
        else:
            aspect = float(h) / float(w)
            asp_span = max(1e-6, cfg.max_aspect_ratio - cfg.min_aspect_ratio)
            asp_mid = (cfg.min_aspect_ratio + cfg.max_aspect_ratio) / 2.0
            aspect_score = max(0.0, 1.0 - abs(aspect - asp_mid) / asp_span)
        return float(min(1.0, 0.4 + 0.3 * area_score + 0.3 * aspect_score))

    def _match(
        self,
        detections: Sequence[tuple[int, int, int, int]],
    ) -> tuple[list[tuple[int, int]], list[int], list[int]]:
        cfg = self._config
        pairs: list[tuple[float, float, int, int]] = []
        for track_id, track in self.active_tracks.items():
            tc = self._centroid(track.last_bbox)
            for det_idx, det in enumerate(detections):
                dc = self._centroid(det)
                dist = math.hypot(tc[0] - dc[0], tc[1] - dc[1])
                iou = self._iou(track.last_bbox, det)
                if (
                    dist <= cfg.centroid_match_distance_px
                    or iou >= cfg.iou_match_threshold
                ):
                    pairs.append((dist, iou, track_id, det_idx))

        pairs.sort(key=lambda item: (item[0], -item[1]))

        matched_tracks: set[int] = set()
        matched_dets: set[int] = set()
        matches: list[tuple[int, int]] = []
        for _dist, _iou, track_id, det_idx in pairs:
            if track_id in matched_tracks or det_idx in matched_dets:
                continue
            matches.append((track_id, det_idx))
            matched_tracks.add(track_id)
            matched_dets.add(det_idx)

        unmatched_dets = [
            i for i in range(len(detections)) if i not in matched_dets
        ]
        unmatched_tracks = [
            tid for tid in self.active_tracks if tid not in matched_tracks
        ]
        return matches, unmatched_dets, unmatched_tracks

    def _retire_stale(self) -> None:
        budget = int(self._config.max_missed_frames)
        stale_ids = [
            tid
            for tid, track in self.active_tracks.items()
            if track.missed > budget
        ]
        for tid in stale_ids:
            self.retired_tracks.append(self.active_tracks.pop(tid))

    def _to_player_track(self, active: _ActiveTrack) -> PlayerTrack:
        observations = list(active.observations)
        first = observations[0].timestamp_sec if observations else 0.0
        last = observations[-1].timestamp_sec if observations else 0.0
        track = PlayerTrack(
            player_id=int(active.player_id),
            observations=observations,
            first_seen_sec=float(first),
            last_seen_sec=float(last),
        )
        track.total_distance_m = compute_distance_meters(track, self._config)
        return track

    @staticmethod
    def _centroid(bbox: Sequence[float]) -> tuple[float, float]:
        x, y, w, h = bbox
        return (float(x) + float(w) / 2.0, float(y) + float(h) / 2.0)

    @staticmethod
    def _iou(a: Sequence[float], b: Sequence[float]) -> float:
        ax, ay, aw, ah = a
        bx, by, bw, bh = b
        ax2, ay2 = ax + aw, ay + ah
        bx2, by2 = bx + bw, by + bh
        ix = max(0.0, min(ax2, bx2) - max(ax, bx))
        iy = max(0.0, min(ay2, by2) - max(ay, by))
        inter = float(ix) * float(iy)
        union = float(aw) * float(ah) + float(bw) * float(bh) - inter
        return float(inter / union) if union > 0 else 0.0


# ---------------------------------------------------------------------------
# Distance & heatmap utilities
# ---------------------------------------------------------------------------


def _smooth_points(
    points: Sequence[Sequence[float]],
    window: int,
) -> list[tuple[float, float]]:
    """Return a moving-average smoothed copy of *points* (centered window)."""

    if window <= 1 or len(points) <= 1:
        return [(float(p[0]), float(p[1])) for p in points]
    arr = np.asarray(points, dtype=np.float64)
    n = len(arr)
    half = window // 2
    smoothed = np.zeros_like(arr)
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        smoothed[i] = arr[lo:hi].mean(axis=0)
    return [(float(x), float(y)) for x, y in smoothed]


def compute_distance_meters(
    track: PlayerTrack,
    config: Optional[PlayerTrackingConfig] = None,
) -> float:
    """Return the total distance travelled by *track*.

    The result is in meters when court-mapped centroids are available,
    otherwise it is reported in pixels (the caller is responsible for the
    final unit interpretation; the function name is preserved per the
    public spec).

    Implementation notes:

    * Steps that exceed ``config.max_step_m`` (court mode) or
      ``config.max_step_px`` (image mode) are treated as tracker
      teleports and skipped.
    * A centered moving-average of length
      ``config.smoothing_window_frames`` is applied to attenuate
      detection jitter before integration.
    """

    cfg = config or PlayerTrackingConfig()
    if len(track.observations) < 2:
        return 0.0

    has_court = any(
        obs.centroid_court_m is not None for obs in track.observations
    )

    if has_court:
        raw_points: list[tuple[float, float]] = []
        for obs in track.observations:
            pt = obs.centroid_court_m
            if pt is None:
                continue
            raw_points.append((float(pt[0]), float(pt[1])))
        max_step = float(cfg.max_step_m)
    else:
        raw_points = [
            (float(obs.centroid_image[0]), float(obs.centroid_image[1]))
            for obs in track.observations
        ]
        max_step = float(cfg.max_step_px)

    if len(raw_points) < 2:
        return 0.0

    smoothed = _smooth_points(raw_points, int(cfg.smoothing_window_frames))
    total = 0.0
    for i in range(1, len(smoothed)):
        dx = smoothed[i][0] - smoothed[i - 1][0]
        dy = smoothed[i][1] - smoothed[i - 1][1]
        step = math.hypot(dx, dy)
        if step > max_step:
            continue
        total += step
    return float(total)


def build_heatmap(
    track: PlayerTrack,
    config: PlayerTrackingConfig,
) -> HeatmapData:
    """Bin a track's positions into a 2D heatmap and Gaussian-blur it."""

    cols = max(1, int(config.heatmap_grid_cols))
    rows = max(1, int(config.heatmap_grid_rows))
    raw = np.zeros((rows, cols), dtype=np.int32)

    points: list[tuple[float, float]] = []
    has_court = any(
        obs.centroid_court_m is not None for obs in track.observations
    )
    for obs in track.observations:
        if has_court:
            if obs.centroid_court_m is None:
                continue
            points.append(
                (float(obs.centroid_court_m[0]), float(obs.centroid_court_m[1]))
            )
        else:
            points.append(
                (float(obs.centroid_image[0]), float(obs.centroid_image[1]))
            )

    width_m = float(config.court_width_m)
    height_m = float(config.court_height_m)

    if points and not has_court:
        # Image-space fallback: normalize by the trajectory's own extents
        # so the heatmap fills the configured grid rather than collapsing
        # into a single bin.
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        x_range = max(1e-6, x_max - x_min)
        y_range = max(1e-6, y_max - y_min)
        points = [
            (
                (p[0] - x_min) / x_range * width_m,
                (p[1] - y_min) / y_range * height_m,
            )
            for p in points
        ]

    for x_m, y_m in points:
        col = int(min(cols - 1, max(0, x_m / width_m * cols)))
        row = int(min(rows - 1, max(0, y_m / height_m * rows)))
        raw[row, col] += 1

    blurred = raw.astype(np.float32)
    sigma = float(config.heatmap_blur_sigma)
    if sigma > 0.0 and raw.sum() > 0:
        blurred = cv2.GaussianBlur(blurred, (0, 0), sigmaX=sigma, sigmaY=sigma)

    peak = float(blurred.max()) if blurred.size > 0 else 0.0
    if peak > 0.0:
        normalized = (blurred / peak).astype(np.float32)
    else:
        normalized = blurred

    return HeatmapData(
        player_id=int(track.player_id),
        grid_cols=cols,
        grid_rows=rows,
        court_width_m=width_m,
        court_height_m=height_m,
        cells=[[float(v) for v in row] for row in normalized.tolist()],
        raw_counts=[[int(v) for v in row] for row in raw.tolist()],
        sample_count=int(len(points)),
    )


# ---------------------------------------------------------------------------
# Overlay payload
# ---------------------------------------------------------------------------


_COLOR_PALETTE: tuple[str, ...] = (
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#FFA94D",
    "#9775FA",
    "#51CF66",
)


def _color_for(player_id: int) -> str:
    if not _COLOR_PALETTE:  # pragma: no cover - defensive
        return "#FFFFFF"
    return _COLOR_PALETTE[(int(player_id) - 1) % len(_COLOR_PALETTE)]


def build_overlay_payload(
    tracks: Sequence[PlayerTrack],
    config: PlayerTrackingConfig,
) -> dict[str, Any]:
    """Return a render-ready JSON payload for a heatmap overlay."""

    players: list[dict[str, Any]] = []
    for track in sorted(tracks, key=lambda t: t.player_id):
        if not track.observations:
            continue
        heatmap = build_heatmap(track, config)
        trajectory: list[list[float]] = []
        for obs in track.observations:
            if obs.centroid_court_m is not None:
                trajectory.append(
                    [
                        float(obs.centroid_court_m[0]),
                        float(obs.centroid_court_m[1]),
                        float(obs.timestamp_sec),
                    ]
                )
            else:
                trajectory.append(
                    [
                        float(obs.centroid_image[0]),
                        float(obs.centroid_image[1]),
                        float(obs.timestamp_sec),
                    ]
                )
        players.append(
            {
                "player_id": int(track.player_id),
                "color_hint": _color_for(track.player_id),
                "distance_m": float(track.total_distance_m),
                "heatmap": heatmap.cells,
                "trajectory": trajectory,
            }
        )

    return {
        "court": {
            "width_m": float(config.court_width_m),
            "height_m": float(config.court_height_m),
            "grid_cols": int(config.heatmap_grid_cols),
            "grid_rows": int(config.heatmap_grid_rows),
        },
        "players": players,
    }


# ---------------------------------------------------------------------------
# Rally normalisation
# ---------------------------------------------------------------------------


def _normalize_rally(rally: Any) -> dict[str, float | int]:
    """Coerce a Rally dataclass or plain dict into a uniform mapping."""

    if isinstance(rally, Mapping):
        return {
            "rally_id": int(rally.get("rally_id", 1)),
            "start_sec": float(rally.get("start_sec", rally.get("start", 0.0))),
            "end_sec": float(rally.get("end_sec", rally.get("end", 0.0))),
        }
    if (
        hasattr(rally, "rally_id")
        and hasattr(rally, "start_sec")
        and hasattr(rally, "end_sec")
    ):
        return {
            "rally_id": int(rally.rally_id),
            "start_sec": float(rally.start_sec),
            "end_sec": float(rally.end_sec),
        }
    raise TypeError(f"Unsupported rally type: {type(rally)!r}")


def _normalize_rallies(rallies: Iterable[Any]) -> list[dict[str, float | int]]:
    out = [_normalize_rally(r) for r in rallies]
    out.sort(key=lambda r: float(r["start_sec"]))
    return out


# ---------------------------------------------------------------------------
# PlayerMovementAnalyzer
# ---------------------------------------------------------------------------


class PlayerMovementAnalyzer:
    """Stream a video and compute per-rally player movement statistics."""

    def __init__(
        self,
        video_path: str,
        rallies: Iterable[Any],
        court_mapper: Optional[CourtMapperLike] = None,
        config: Optional[PlayerTrackingConfig] = None,
    ) -> None:
        self.video_path = str(video_path)
        self.config = config or PlayerTrackingConfig()
        self.court_mapper = _coerce_court_mapper(court_mapper)
        self._rallies = _normalize_rallies(rallies)

    def analyze(self) -> dict[str, Any]:
        """Run the full pipeline and return a JSON-serializable payload."""

        cap = cv2.VideoCapture(self.video_path)
        try:
            if hasattr(cap, "isOpened") and not cap.isOpened():
                raise FileNotFoundError(
                    f"Cannot open video: {self.video_path!r}"
                )

            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
            if fps <= 1e-6:
                fps = 30.0

            all_tracks: list[PlayerTrack] = []
            per_rally: list[RallyPlayerStats] = []
            frames_processed = 0
            frames_skipped = 0
            next_id = 1

            rally_idx = 0
            detector: Optional[PlayerDetector] = None
            tracker: Optional[PlayerTracker] = None

            frame_idx = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                timestamp = float(frame_idx) / fps

                while rally_idx < len(self._rallies) and timestamp > float(
                    self._rallies[rally_idx]["end_sec"]
                ):
                    if tracker is not None:
                        finished = tracker.finalize()
                        per_rally.append(
                            self._aggregate_rally(
                                self._rallies[rally_idx], finished
                            )
                        )
                        all_tracks.extend(finished)
                        next_id = tracker.next_id
                    detector = None
                    tracker = None
                    rally_idx += 1

                if rally_idx < len(self._rallies):
                    window = self._rallies[rally_idx]
                    inside = (
                        float(window["start_sec"])
                        <= timestamp
                        <= float(window["end_sec"])
                    )
                else:
                    inside = False

                if inside:
                    if detector is None or tracker is None:
                        detector = PlayerDetector(self.config)
                        tracker = PlayerTracker(self.config, starting_id=next_id)
                    bboxes = detector.detect(frame)
                    tracker.update(
                        bboxes,
                        frame_idx=frame_idx,
                        timestamp_sec=timestamp,
                        court_mapper=self.court_mapper,
                    )
                    frames_processed += 1
                else:
                    frames_skipped += 1

                frame_idx += 1

            if (
                tracker is not None
                and rally_idx < len(self._rallies)
            ):
                finished = tracker.finalize()
                per_rally.append(
                    self._aggregate_rally(self._rallies[rally_idx], finished)
                )
                all_tracks.extend(finished)
        finally:
            cap.release()

        all_tracks.sort(key=lambda t: t.player_id)
        totals: dict[str, dict[str, float]] = {}
        for track in all_tracks:
            active = max(0.0, track.last_seen_sec - track.first_seen_sec)
            pid = str(int(track.player_id))
            entry = totals.setdefault(pid, {"distance_m": 0.0, "active_seconds": 0.0})
            entry["distance_m"] += float(track.total_distance_m)
            entry["active_seconds"] += float(active)

        return {
            "tracks": [t.to_dict() for t in all_tracks],
            "per_rally": [r.to_dict() for r in per_rally],
            "totals": {
                pid: {
                    "distance_m": float(values["distance_m"]),
                    "active_seconds": float(values["active_seconds"]),
                }
                for pid, values in totals.items()
            },
            "summary": {
                "frames_processed": int(frames_processed),
                "frames_skipped": int(frames_skipped),
                "video_fps": float(fps),
            },
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _aggregate_rally(
        self,
        rally: Mapping[str, float | int],
        tracks: Sequence[PlayerTrack],
    ) -> RallyPlayerStats:
        stats = RallyPlayerStats(
            rally_id=int(rally["rally_id"]),
            start_sec=float(rally["start_sec"]),
            end_sec=float(rally["end_sec"]),
            per_player={},
        )
        for track in tracks:
            distance = float(track.total_distance_m)
            duration = max(0.0, track.last_seen_sec - track.first_seen_sec)
            avg_speed = distance / duration if duration > 0 else 0.0
            peak_speed = _peak_step_speed(track, self.config)
            stats.per_player[int(track.player_id)] = {
                "distance_m": float(distance),
                "avg_speed_mps": float(avg_speed),
                "peak_speed_mps": float(peak_speed),
                "observation_count": float(len(track.observations)),
            }
        return stats


def _peak_step_speed(
    track: PlayerTrack,
    config: PlayerTrackingConfig,
) -> float:
    """Return the maximum plausible per-step speed in m/s (or px/s)."""

    obs = track.observations
    if len(obs) < 2:
        return 0.0
    has_court = any(o.centroid_court_m is not None for o in obs)
    max_step = float(config.max_step_m) if has_court else float(config.max_step_px)
    peak = 0.0
    for i in range(1, len(obs)):
        if has_court:
            a = obs[i - 1].centroid_court_m
            b = obs[i].centroid_court_m
            if a is None or b is None:
                continue
        else:
            a = obs[i - 1].centroid_image
            b = obs[i].centroid_image
        dt = obs[i].timestamp_sec - obs[i - 1].timestamp_sec
        if dt <= 0:
            continue
        step = math.hypot(b[0] - a[0], b[1] - a[1])
        if step > max_step:
            continue
        peak = max(peak, step / dt)
    return float(peak)


# ---------------------------------------------------------------------------
# Top-level convenience
# ---------------------------------------------------------------------------


def analyze_player_movement(
    video_path: str,
    rallies: Iterable[Any],
    court_mapper: Optional[CourtMapperLike | Mapping[str, Any]] = None,
    config: Optional[PlayerTrackingConfig] = None,
) -> dict[str, Any]:
    """Run :class:`PlayerMovementAnalyzer` and wrap the overlay payload.

    The returned dict has the shape::

        {
          "movement": { ...PlayerMovementAnalyzer.analyze()... },
          "overlay":  { ...build_overlay_payload()... }
        }

    Both halves are JSON-serializable.
    """

    cfg = config or PlayerTrackingConfig()
    analyzer = PlayerMovementAnalyzer(
        video_path=video_path,
        rallies=rallies,
        court_mapper=court_mapper,
        config=cfg,
    )
    movement = analyzer.analyze()
    tracks = [_track_from_dict(t) for t in movement["tracks"]]
    overlay = build_overlay_payload(tracks, cfg)
    player_heatmaps = overlay["players"]
    rally_payloads: list[dict[str, Any]] = []
    for rally in movement.get("per_rally", []):
        if not isinstance(rally, Mapping):
            continue
        rally_payloads.append(
            {
                "rally_id": int(rally.get("rally_id", 0)),
                "start_sec": float(rally.get("start_sec", 0.0)),
                "end_sec": float(rally.get("end_sec", 0.0)),
                "player_heatmaps": player_heatmaps,
            }
        )
    return {
        "movement": movement,
        "overlay": overlay,
        "player_heatmaps": player_heatmaps,
        "rallies": rally_payloads,
    }


def _track_from_dict(payload: Mapping[str, Any]) -> PlayerTrack:
    """Reconstruct a :class:`PlayerTrack` from its serialized form."""

    observations = [
        PlayerObservation(
            frame_idx=int(o["frame_idx"]),
            timestamp_sec=float(o["timestamp_sec"]),
            bbox=[int(v) for v in o["bbox"]],
            centroid_image=[float(v) for v in o["centroid_image"]],
            centroid_court_m=(
                None
                if o.get("centroid_court_m") is None
                else [float(v) for v in o["centroid_court_m"]]
            ),
            confidence=float(o["confidence"]),
        )
        for o in payload.get("observations", [])
    ]
    return PlayerTrack(
        player_id=int(payload["player_id"]),
        observations=observations,
        total_distance_m=float(payload.get("total_distance_m", 0.0)),
        first_seen_sec=float(payload.get("first_seen_sec", 0.0)),
        last_seen_sec=float(payload.get("last_seen_sec", 0.0)),
    )


__all__ = [
    "CourtMapperLike",
    "HeatmapData",
    "PlayerDetector",
    "PlayerMovementAnalyzer",
    "PlayerObservation",
    "PlayerTrack",
    "PlayerTracker",
    "PlayerTrackingConfig",
    "RallyPlayerStats",
    "analyze_player_movement",
    "build_heatmap",
    "build_overlay_payload",
    "compute_distance_meters",
]
