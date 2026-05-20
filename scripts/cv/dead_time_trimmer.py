"""
Dead-Time Trimming Engine for Padel Video Analyzer.

Detects rally segments in padel match videos using frame-level motion
scoring and ball velocity tracking, then exports condensed video clips.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, Optional

import cv2
import numpy as np
from scipy.signal import medfilt


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class TrimmerConfig:
    """All tuneable parameters for the dead-time trimmer.

    Defaults are calibrated for 720p / 30 fps padel footage.
    """

    # MotionDetector
    motion_threshold: float = 0.05
    """Normalised motion score threshold above which a frame is 'active'."""

    blur_kernel: int = 21
    """Gaussian blur kernel size (odd number) applied before differencing."""

    # BallVelocityTracker
    min_ball_area: int = 10
    """Minimum contour area (px²) to be considered a ball candidate."""

    max_ball_area: int = 2000
    """Maximum contour area (px²) to be considered a ball candidate."""

    min_circularity: float = 0.4
    """Minimum circularity ratio (4π·area / perimeter²) for ball filtering."""

    max_aspect_ratio: float = 2.5
    """Maximum bounding-box aspect ratio for ball filtering."""

    mog2_history: int = 100
    """History length for MOG2 background subtractor."""

    mog2_var_threshold: float = 16.0
    """Variance threshold for MOG2 background subtractor."""

    # Activity signal fusion
    motion_weight: float = 0.7
    """Weight for motion score in the combined activity signal."""

    velocity_weight: float = 0.3
    """Weight for normalised ball velocity in the combined activity signal."""

    velocity_norm_factor: float = 50.0
    """Factor to normalise raw ball velocity (px/frame) into 0–1 range."""

    median_filter_window: int = 15
    """Window size (frames) for median filter smoothing of activity signal."""

    # State machine
    active_threshold: float = 0.15
    """Activity signal level that triggers ACTIVE state."""

    dead_threshold: float = 0.08
    """Activity signal level that drops back to DEAD state."""

    min_active_frames: int = 10
    """Consecutive frames above active_threshold required to enter ACTIVE."""

    min_dead_frames: int = 20
    """Consecutive frames below dead_threshold required to exit ACTIVE."""

    # Export
    padding_sec: float = 1.0
    """Seconds of padding added before/after each rally in exported video."""


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class Rally:
    """A detected rally segment within a video."""

    rally_id: int
    start_sec: float
    end_sec: float
    duration_sec: float
    avg_motion: float
    avg_ball_velocity: float  # px/frame; 0.0 when ball was never detected


# ---------------------------------------------------------------------------
# MotionDetector
# ---------------------------------------------------------------------------


class MotionDetector:
    """Computes a normalised motion score between consecutive frames.

    Uses Gaussian blur + absolute frame differencing + Otsu thresholding.
    """

    def __init__(self, config: TrimmerConfig) -> None:
        self._config = config
        self._prev_gray: Optional[np.ndarray] = None

    def reset(self) -> None:
        """Clear stored previous frame (call when opening a new video)."""
        self._prev_gray = None

    def compute_motion_score(self, frame: np.ndarray) -> float:
        """Return a motion score in [0, 1] for *frame* vs the previous frame.

        Args:
            frame: BGR uint8 frame of shape (H, W, 3).

        Returns:
            Float in [0.0, 1.0]; 0.0 on the very first frame.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(
            gray,
            (self._config.blur_kernel, self._config.blur_kernel),
            0,
        )

        if self._prev_gray is None:
            self._prev_gray = blurred
            return 0.0

        diff = cv2.absdiff(blurred, self._prev_gray)
        self._prev_gray = blurred

        _, thresh = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        active_pixels = int(np.count_nonzero(thresh))
        total_pixels = thresh.size
        score = active_pixels / total_pixels if total_pixels > 0 else 0.0
        return float(min(score, 1.0))


# ---------------------------------------------------------------------------
# BallVelocityTracker
# ---------------------------------------------------------------------------


class BallVelocityTracker:
    """Estimates ball velocity (px/frame) using background subtraction + contour filtering."""

    def __init__(self, config: TrimmerConfig) -> None:
        self._config = config
        self._subtractor = cv2.createBackgroundSubtractorMOG2(
            history=config.mog2_history,
            varThreshold=config.mog2_var_threshold,
            detectShadows=False,
        )
        self._prev_center: Optional[tuple[float, float]] = None

    def reset(self) -> None:
        """Reinitialise background subtractor and previous detection."""
        self._subtractor = cv2.createBackgroundSubtractorMOG2(
            history=self._config.mog2_history,
            varThreshold=self._config.mog2_var_threshold,
            detectShadows=False,
        )
        self._prev_center = None

    def _is_ball_candidate(self, contour: np.ndarray) -> bool:
        """Return True if *contour* passes ball shape/size heuristics."""
        area = cv2.contourArea(contour)
        if area < self._config.min_ball_area or area > self._config.max_ball_area:
            return False

        perimeter = cv2.arcLength(contour, closed=True)
        if perimeter < 1e-6:
            return False

        circularity = (4.0 * math.pi * area) / (perimeter ** 2)
        if circularity < self._config.min_circularity:
            return False

        x, y, w, h = cv2.boundingRect(contour)
        if h < 1:
            return False
        aspect = w / h
        if aspect > self._config.max_aspect_ratio or aspect < (1.0 / self._config.max_aspect_ratio):
            return False

        return True

    def update(self, frame: np.ndarray) -> Optional[float]:
        """Process *frame* and return ball velocity (px/frame) or None.

        Args:
            frame: BGR uint8 frame.

        Returns:
            Ball velocity in px/frame, or None if no ball was detected this frame.
        """
        fg_mask = self._subtractor.apply(frame)

        # Remove noise with morphological opening
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best_center: Optional[tuple[float, float]] = None
        best_area = 0.0

        for cnt in contours:
            if not self._is_ball_candidate(cnt):
                continue
            area = cv2.contourArea(cnt)
            if area > best_area:
                M = cv2.moments(cnt)
                if M["m00"] > 0:
                    cx = M["m10"] / M["m00"]
                    cy = M["m01"] / M["m00"]
                    best_center = (cx, cy)
                    best_area = area

        velocity: Optional[float] = None
        if best_center is not None and self._prev_center is not None:
            dx = best_center[0] - self._prev_center[0]
            dy = best_center[1] - self._prev_center[1]
            velocity = float(math.hypot(dx, dy))

        self._prev_center = best_center
        return velocity


# ---------------------------------------------------------------------------
# State machine helpers
# ---------------------------------------------------------------------------


class _State(Enum):
    DEAD = auto()
    ACTIVE = auto()


# ---------------------------------------------------------------------------
# DeadTimeTrimmer
# ---------------------------------------------------------------------------


class DeadTimeTrimmer:
    """Orchestrates motion detection + ball tracking to find rally segments.

    Processes a video file frame-by-frame (streaming, no full-video RAM load).
    """

    def __init__(self, config: Optional[TrimmerConfig] = None) -> None:
        self._config = config or TrimmerConfig()
        self._motion_detector = MotionDetector(self._config)
        self._ball_tracker = BallVelocityTracker(self._config)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def collect_signals(
        self, video_path: str
    ) -> tuple[float, list[float], list[Optional[float]], list[float]]:
        """Stream *video_path* once and return ``(fps, motion, velocity, shake)``.

        The shake signal is a cheap proxy for global camera jitter (the
        magnitude of frame-to-frame change in motion score). It exists so
        downstream fusion detectors can penalise windows that look like
        whole-frame pans rather than localised player/ball motion.
        """

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path!r}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        self._motion_detector.reset()
        self._ball_tracker.reset()

        motion: list[float] = []
        velocity: list[Optional[float]] = []
        shake: list[float] = []
        prev = 0.0

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                m = self._motion_detector.compute_motion_score(frame)
                motion.append(m)
                velocity.append(self._ball_tracker.update(frame))
                shake.append(abs(m - prev))
                prev = m
        finally:
            cap.release()

        return float(fps), motion, velocity, shake

    def process(self, video_path: str) -> list[Rally]:
        """Analyse *video_path* and return a list of detected rallies.

        Args:
            video_path: Path to the input video file.

        Returns:
            List of :class:`Rally` instances in chronological order.
        """
        fps, raw_motion, raw_velocity, _shake = self.collect_signals(video_path)

        if not raw_motion:
            return []

        activity = self._build_activity_signal(raw_motion, raw_velocity)
        return self._run_state_machine(activity, raw_motion, raw_velocity, fps)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_activity_signal(
        self,
        motion: list[float],
        velocity: list[Optional[float]],
    ) -> np.ndarray:
        """Combine motion and ball velocity into a smoothed activity signal."""
        cfg = self._config
        n = len(motion)
        signal = np.zeros(n, dtype=np.float64)

        for i in range(n):
            m = motion[i]
            v = velocity[i]
            norm_v = min((v / cfg.velocity_norm_factor), 1.0) if v is not None else 0.0
            signal[i] = cfg.motion_weight * m + cfg.velocity_weight * norm_v

        # Ensure window is odd and at least 1
        window = cfg.median_filter_window
        if window % 2 == 0:
            window += 1
        window = max(1, min(window, n if n % 2 == 1 else n - 1))
        if window > 1 and n >= window:
            signal = medfilt(signal, kernel_size=window)

        return signal

    def _run_state_machine(
        self,
        activity: np.ndarray,
        raw_motion: list[float],
        raw_velocity: list[Optional[float]],
        fps: float,
    ) -> list[Rally]:
        """Run the DEAD/ACTIVE state machine and collect Rally objects."""
        cfg = self._config
        state = _State.DEAD
        rallies: list[Rally] = []
        rally_id = 0

        # Frame indices for current rally candidate
        candidate_start: Optional[int] = None
        consecutive_active = 0
        consecutive_dead = 0

        # Accumulate stats for active rally
        active_start_frame: Optional[int] = None
        frame_motions: list[float] = []
        frame_velocities: list[float] = []

        n = len(activity)

        for i, score in enumerate(activity):
            if state is _State.DEAD:
                if score >= cfg.active_threshold:
                    consecutive_active += 1
                    if candidate_start is None:
                        candidate_start = i
                else:
                    consecutive_active = 0
                    candidate_start = None

                if consecutive_active >= cfg.min_active_frames:
                    state = _State.ACTIVE
                    active_start_frame = candidate_start  # first frame above threshold
                    consecutive_dead = 0
                    frame_motions = list(raw_motion[active_start_frame : i + 1])
                    vels = raw_velocity[active_start_frame : i + 1]
                    frame_velocities = [v for v in vels if v is not None]

            else:  # ACTIVE
                frame_motions.append(raw_motion[i])
                v = raw_velocity[i]
                if v is not None:
                    frame_velocities.append(v)

                if score < cfg.dead_threshold:
                    consecutive_dead += 1
                else:
                    consecutive_dead = 0

                if consecutive_dead >= cfg.min_dead_frames:
                    # Rally ended cfg.min_dead_frames ago
                    end_frame = i - cfg.min_dead_frames + 1
                    rally = self._make_rally(
                        rally_id=rally_id,
                        start_frame=active_start_frame,  # type: ignore[arg-type]
                        end_frame=end_frame,
                        fps=fps,
                        frame_motions=frame_motions,
                        frame_velocities=frame_velocities,
                    )
                    rallies.append(rally)
                    rally_id += 1
                    state = _State.DEAD
                    consecutive_active = 0
                    consecutive_dead = 0
                    candidate_start = None
                    active_start_frame = None
                    frame_motions = []
                    frame_velocities = []

        # Handle rally still active at end of video
        if state is _State.ACTIVE and active_start_frame is not None:
            rally = self._make_rally(
                rally_id=rally_id,
                start_frame=active_start_frame,
                end_frame=n - 1,
                fps=fps,
                frame_motions=frame_motions,
                frame_velocities=frame_velocities,
            )
            rallies.append(rally)

        return rallies

    @staticmethod
    def _make_rally(
        rally_id: int,
        start_frame: int,
        end_frame: int,
        fps: float,
        frame_motions: list[float],
        frame_velocities: list[float],
    ) -> Rally:
        start_sec = start_frame / fps
        end_sec = end_frame / fps
        duration_sec = max(0.0, end_sec - start_sec)
        avg_motion = float(np.mean(frame_motions)) if frame_motions else 0.0
        avg_ball_velocity = float(np.mean(frame_velocities)) if frame_velocities else 0.0
        return Rally(
            rally_id=rally_id,
            start_sec=round(start_sec, 4),
            end_sec=round(end_sec, 4),
            duration_sec=round(duration_sec, 4),
            avg_motion=round(avg_motion, 6),
            avg_ball_velocity=round(avg_ball_velocity, 4),
        )


# ---------------------------------------------------------------------------
# Video export helper
# ---------------------------------------------------------------------------


def export_condensed_video(
    video_path: str,
    rallies: list[Rally],
    output_path: str,
    padding_sec: float = 1.0,
) -> None:
    """Export only rally segments (with padding) to a new MP4 file.

    Args:
        video_path: Path to the source video.
        rallies: List of :class:`Rally` objects defining active segments.
        output_path: Destination path for the condensed MP4.
        padding_sec: Seconds of extra footage before/after each rally.
    """
    if not rallies:
        raise ValueError("No rallies provided — nothing to export.")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {video_path!r}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    pad_frames = int(padding_sec * fps)

    try:
        for rally in rallies:
            start_frame = max(0, int(rally.start_sec * fps) - pad_frames)
            end_frame = min(total_frames - 1, int(rally.end_sec * fps) + pad_frames)

            cap.set(cv2.CAP_PROP_POS_FRAMES, float(start_frame))
            for _ in range(end_frame - start_frame + 1):
                ret, frame = cap.read()
                if not ret:
                    break
                writer.write(frame)
    finally:
        cap.release()
        writer.release()


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------


def analyze_video(video_path: str, config: Optional[dict] = None) -> dict:
    """Analyse a padel video and return rally timing metadata.

    Args:
        video_path: Path to the input video file.
        config: Optional dict of :class:`TrimmerConfig` field overrides.

    Returns:
        Dict with keys:
        - ``rallies``: list of rally dicts.
        - ``total_active_sec``: total seconds of detected rally play.
        - ``total_dead_sec``: total dead-time seconds.
        - ``trim_ratio``: fraction of video that is dead time (0–1).
    """
    cfg_obj = TrimmerConfig()
    if config:
        for key, val in config.items():
            if hasattr(cfg_obj, key):
                setattr(cfg_obj, key, val)

    trimmer = DeadTimeTrimmer(cfg_obj)
    rallies = trimmer.process(video_path)

    # Compute total duration from video metadata
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()

    total_duration_sec = float(total_frames / fps) if fps > 0 else 0.0
    total_active_sec = float(sum(r.duration_sec for r in rallies))
    total_dead_sec = float(max(0.0, total_duration_sec - total_active_sec))
    trim_ratio = float(total_dead_sec / total_duration_sec) if total_duration_sec > 0 else 0.0

    return {
        "rallies": [
            {
                "rally_id": int(r.rally_id),
                "start_sec": float(r.start_sec),
                "end_sec": float(r.end_sec),
                "duration_sec": float(r.duration_sec),
                "avg_motion": float(r.avg_motion),
                "avg_ball_velocity": float(r.avg_ball_velocity),
            }
            for r in rallies
        ],
        "total_active_sec": round(total_active_sec, 4),
        "total_dead_sec": round(total_dead_sec, 4),
        "trim_ratio": round(trim_ratio, 6),
    }
