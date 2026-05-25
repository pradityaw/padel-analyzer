"""
Unit tests for scripts/cv/dead_time_trimmer.py.

All tests use mocked cv2.VideoCapture so no real video file is required.
"""

from __future__ import annotations

import math
from typing import Optional
from unittest.mock import MagicMock, patch, PropertyMock

import cv2
import numpy as np
import pytest

# ── make the package importable when running from repo root ────────────────
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from cv.dead_time_trimmer import (
    BallVelocityTracker,
    DeadTimeTrimmer,
    MotionDetector,
    Rally,
    TrimmerConfig,
    analyze_video,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

H, W = 720, 1280


def _black_frame() -> np.ndarray:
    return np.zeros((H, W, 3), dtype=np.uint8)


def _white_frame() -> np.ndarray:
    return np.full((H, W, 3), 255, dtype=np.uint8)


def _noise_frame(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, (H, W, 3), dtype=np.uint8)


def _make_cap_mock(frames: list[np.ndarray], fps: float = 30.0) -> MagicMock:
    """Build a MagicMock that behaves like a cv2.VideoCapture for *frames*."""
    cap = MagicMock()
    cap.isOpened.return_value = True
    cap.get.side_effect = lambda prop: {
        cv2.CAP_PROP_FPS: fps,
        cv2.CAP_PROP_FRAME_WIDTH: float(W),
        cv2.CAP_PROP_FRAME_HEIGHT: float(H),
        cv2.CAP_PROP_FRAME_COUNT: float(len(frames)),
        cv2.CAP_PROP_POS_FRAMES: 0.0,
    }.get(prop, 0.0)

    read_returns = [(True, f) for f in frames] + [(False, None)]
    cap.read.side_effect = read_returns
    return cap


# ---------------------------------------------------------------------------
# MotionDetector tests
# ---------------------------------------------------------------------------


class TestMotionDetector:
    def _make(self) -> MotionDetector:
        return MotionDetector(TrimmerConfig())

    def test_first_frame_returns_zero(self) -> None:
        det = self._make()
        score = det.compute_motion_score(_black_frame())
        assert score == pytest.approx(0.0)

    def test_identical_frames_return_zero(self) -> None:
        det = self._make()
        frame = _black_frame()
        det.compute_motion_score(frame)  # seed previous
        score = det.compute_motion_score(frame)
        assert score == pytest.approx(0.0, abs=1e-6)

    def test_high_diff_frames_return_high_score(self) -> None:
        det = self._make()
        det.compute_motion_score(_black_frame())
        score = det.compute_motion_score(_white_frame())
        # All pixels changed — score should be very high
        assert score > 0.8

    def test_score_bounded_to_one(self) -> None:
        det = self._make()
        for _ in range(5):
            score = det.compute_motion_score(_noise_frame())
            assert 0.0 <= score <= 1.0

    def test_reset_clears_previous_frame(self) -> None:
        det = self._make()
        det.compute_motion_score(_white_frame())
        det.reset()
        # After reset next call acts like first frame
        score = det.compute_motion_score(_black_frame())
        assert score == pytest.approx(0.0)

    def test_partial_change_between_zero_and_one(self) -> None:
        det = self._make()
        frame_a = _black_frame()
        frame_b = _black_frame()
        frame_b[:, : W // 2, :] = 255  # half the frame changed
        det.compute_motion_score(frame_a)
        score = det.compute_motion_score(frame_b)
        assert 0.01 < score < 0.99


# ---------------------------------------------------------------------------
# BallVelocityTracker tests
# ---------------------------------------------------------------------------


class TestBallVelocityTracker:
    def _make(self) -> BallVelocityTracker:
        return BallVelocityTracker(TrimmerConfig())

    def test_first_frame_returns_none(self) -> None:
        tracker = self._make()
        result = tracker.update(_black_frame())
        # No previous detection → None
        assert result is None

    def test_no_ball_returns_none(self) -> None:
        """Completely black frames → no foreground → no ball detected."""
        tracker = self._make()
        for _ in range(5):
            result = tracker.update(_black_frame())
        assert result is None

    def test_reset_clears_state(self) -> None:
        tracker = self._make()
        tracker.update(_noise_frame(0))
        tracker.reset()
        # After reset, first frame should give no velocity
        result = tracker.update(_noise_frame(1))
        assert result is None

    def test_velocity_with_mocked_contours(self) -> None:
        """Mock findContours to inject two detections and verify velocity."""
        tracker = self._make()
        cfg = tracker._config

        # Inject first detection at (100, 200)
        fake_cnt = np.array([[[90, 195]], [[110, 195]], [[110, 205]], [[90, 205]]], dtype=np.int32)
        area = 200.0  # within [min_ball_area, max_ball_area]
        moments_first = {"m00": area, "m10": 100 * area, "m01": 200 * area}

        # Inject second detection at (130, 240)  → velocity = hypot(30, 40) = 50
        moments_second = {"m00": area, "m10": 130 * area, "m01": 240 * area}

        with patch.object(cv2, "findContours", return_value=([fake_cnt], None)), \
             patch.object(cv2, "contourArea", return_value=area), \
             patch.object(cv2, "arcLength", return_value=2 * math.pi * math.sqrt(area / math.pi)), \
             patch.object(cv2, "moments", side_effect=[moments_first, moments_second]), \
             patch.object(cv2, "boundingRect", return_value=(90, 195, 20, 10)):
            # Frame 1 — seed previous center
            tracker.update(_noise_frame(0))
            # Frame 2 — compute velocity
            vel = tracker.update(_noise_frame(1))

        expected = math.hypot(30.0, 40.0)
        assert vel == pytest.approx(expected, rel=1e-3)

    def test_circularity_filter_rejects_line_contour(self) -> None:
        """A thin rectangle should be rejected by circularity check."""
        tracker = self._make()
        # Very elongated: 200 x 5 pixels → low circularity
        line_cnt = np.array(
            [[[0, 0]], [[200, 0]], [[200, 5]], [[0, 5]]], dtype=np.int32
        )
        assert not tracker._is_ball_candidate(line_cnt)

    def test_area_filter_rejects_tiny_contour(self) -> None:
        tracker = self._make()
        tiny = np.array([[[0, 0]], [[1, 0]], [[1, 1]], [[0, 1]]], dtype=np.int32)
        assert not tracker._is_ball_candidate(tiny)

    def test_area_filter_rejects_huge_contour(self) -> None:
        tracker = self._make()
        # Large filled rectangle
        big = np.array(
            [[[0, 0]], [[500, 0]], [[500, 500]], [[0, 500]]], dtype=np.int32
        )
        assert not tracker._is_ball_candidate(big)


# ---------------------------------------------------------------------------
# DeadTimeTrimmer state machine tests
# ---------------------------------------------------------------------------


class TestDeadTimeTrimmerStateMachine:
    FPS = 30.0

    def _build_frames(self, motion_levels: list[str]) -> list[np.ndarray]:
        """Return frames where 'H' = high motion, 'L' = low motion."""
        frames: list[np.ndarray] = []
        for lvl in motion_levels:
            if lvl == "H":
                frames.append(_noise_frame(len(frames)))
            else:
                frames.append(_black_frame())
        return frames

    def _run(
        self,
        motion_signal: list[float],
        velocity_signal: list[Optional[float]],
        config: Optional[TrimmerConfig] = None,
    ) -> list[Rally]:
        """Directly inject activity signals into the state machine."""
        cfg = config or TrimmerConfig()
        trimmer = DeadTimeTrimmer(cfg)
        activity = trimmer._build_activity_signal(motion_signal, velocity_signal)
        return trimmer._run_state_machine(
            activity, motion_signal, velocity_signal, self.FPS
        )

    def test_all_low_activity_no_rallies(self) -> None:
        n = 100
        motion = [0.01] * n
        velocity: list[Optional[float]] = [None] * n
        rallies = self._run(motion, velocity)
        assert rallies == []

    def test_sustained_high_activity_one_rally(self) -> None:
        cfg = TrimmerConfig(
            min_active_frames=5,
            min_dead_frames=5,
            active_threshold=0.15,
            dead_threshold=0.08,
            motion_weight=1.0,
            velocity_weight=0.0,
            median_filter_window=1,
        )
        n = 60
        motion = [0.5] * n  # well above threshold throughout
        velocity: list[Optional[float]] = [None] * n
        rallies = self._run(motion, velocity, cfg)
        assert len(rallies) == 1
        assert rallies[0].rally_id == 0
        assert rallies[0].start_sec >= 0.0
        assert rallies[0].duration_sec > 0.0

    def test_two_active_blocks_two_rallies(self) -> None:
        cfg = TrimmerConfig(
            min_active_frames=5,
            min_dead_frames=5,
            active_threshold=0.15,
            dead_threshold=0.08,
            motion_weight=1.0,
            velocity_weight=0.0,
            median_filter_window=1,
        )
        # Block 1: frames 0-29 active, Block 2: frames 60-89 active
        n = 120
        motion = [0.0] * n
        for i in range(0, 30):
            motion[i] = 0.5
        for i in range(60, 90):
            motion[i] = 0.5

        velocity: list[Optional[float]] = [None] * n
        rallies = self._run(motion, velocity, cfg)
        assert len(rallies) == 2
        assert rallies[0].rally_id == 0
        assert rallies[1].rally_id == 1

    def test_rally_starts_at_frame_zero(self) -> None:
        cfg = TrimmerConfig(
            min_active_frames=3,
            min_dead_frames=3,
            active_threshold=0.15,
            dead_threshold=0.08,
            motion_weight=1.0,
            velocity_weight=0.0,
            median_filter_window=1,
        )
        n = 30
        motion = [0.5] * n
        velocity: list[Optional[float]] = [None] * n
        rallies = self._run(motion, velocity, cfg)
        assert len(rallies) >= 1
        assert rallies[0].start_sec == pytest.approx(0.0, abs=0.2)

    def test_empty_video_no_rallies(self) -> None:
        trimmer = DeadTimeTrimmer()
        with patch("cv2.VideoCapture") as mock_cap_cls:
            cap = MagicMock()
            cap.isOpened.return_value = True
            cap.get.side_effect = lambda p: {
                cv2.CAP_PROP_FPS: 30.0,
                cv2.CAP_PROP_FRAME_COUNT: 0.0,
            }.get(p, 0.0)
            cap.read.return_value = (False, None)
            mock_cap_cls.return_value = cap
            rallies = trimmer.process("fake.mp4")
        assert rallies == []

    def test_single_frame_no_rallies(self) -> None:
        cfg = TrimmerConfig(min_active_frames=5)
        trimmer = DeadTimeTrimmer(cfg)
        with patch("cv2.VideoCapture") as mock_cap_cls:
            cap = _make_cap_mock([_noise_frame()], fps=30.0)
            mock_cap_cls.return_value = cap
            rallies = trimmer.process("fake.mp4")
        # One frame cannot meet min_active_frames=5
        assert rallies == []

    def test_rally_avg_motion_is_positive(self) -> None:
        cfg = TrimmerConfig(
            min_active_frames=5,
            min_dead_frames=5,
            active_threshold=0.1,
            dead_threshold=0.05,
            motion_weight=1.0,
            velocity_weight=0.0,
            median_filter_window=1,
        )
        motion = [0.4] * 40
        velocity: list[Optional[float]] = [None] * 40
        rallies = self._run(motion, velocity, cfg)
        assert len(rallies) >= 1
        assert rallies[0].avg_motion > 0.0


# ---------------------------------------------------------------------------
# analyze_video integration tests
# ---------------------------------------------------------------------------


class TestAnalyzeVideo:
    def _patch_video(self, frames: list[np.ndarray], fps: float = 30.0):
        """Context manager that patches cv2.VideoCapture globally."""
        cap = _make_cap_mock(frames, fps)
        return patch("cv2.VideoCapture", return_value=cap)

    def test_returns_expected_schema(self) -> None:
        frames = [_noise_frame(i) for i in range(10)]
        with self._patch_video(frames):
            result = analyze_video("fake.mp4")

        assert isinstance(result, dict)
        assert "rallies" in result
        assert "total_active_sec" in result
        assert "total_dead_sec" in result
        assert "trim_ratio" in result

    def test_all_values_are_native_python_types(self) -> None:
        """Ensure no numpy scalars leak into the output dict."""
        frames = [_noise_frame(i) for i in range(10)]
        with self._patch_video(frames):
            result = analyze_video("fake.mp4")

        assert isinstance(result["total_active_sec"], float)
        assert isinstance(result["total_dead_sec"], float)
        assert isinstance(result["trim_ratio"], float)
        assert isinstance(result["rallies"], list)

    def test_trim_ratio_in_zero_one(self) -> None:
        frames = [_noise_frame(i) for i in range(10)]
        with self._patch_video(frames):
            result = analyze_video("fake.mp4")
        assert 0.0 <= result["trim_ratio"] <= 1.0

    def test_empty_video_returns_zero_totals(self) -> None:
        with self._patch_video([]):
            result = analyze_video("fake.mp4")
        assert result["rallies"] == []
        assert result["total_active_sec"] == pytest.approx(0.0)

    def test_rally_dict_schema(self) -> None:
        """If any rallies exist, each must have the required keys and types."""
        # Provide enough frames with alternating motion to potentially get rallies
        frames = [_noise_frame(i) if i % 3 != 0 else _black_frame() for i in range(200)]
        cfg = {
            "min_active_frames": 5,
            "min_dead_frames": 5,
            "active_threshold": 0.05,
            "dead_threshold": 0.02,
            "motion_weight": 1.0,
            "velocity_weight": 0.0,
            "median_filter_window": 3,
        }
        with self._patch_video(frames):
            result = analyze_video("fake.mp4", config=cfg)

        for r in result["rallies"]:
            assert isinstance(r["rally_id"], int)
            assert isinstance(r["start_sec"], float)
            assert isinstance(r["end_sec"], float)
            assert isinstance(r["duration_sec"], float)
            assert isinstance(r["avg_motion"], float)
            assert isinstance(r["avg_ball_velocity"], float)
            assert r["duration_sec"] >= 0.0

    def test_config_override_is_respected(self) -> None:
        """Passing a high active_threshold should suppress short low-motion rallies."""
        frames = [_noise_frame(i) for i in range(60)]
        cfg_strict = {"active_threshold": 0.99, "min_active_frames": 50}
        cfg_relaxed = {"active_threshold": 0.01, "min_active_frames": 3, "dead_threshold": 0.005}
        with self._patch_video(frames):
            result_strict = analyze_video("fake.mp4", config=cfg_strict)
        with self._patch_video(frames):
            result_relaxed = analyze_video("fake.mp4", config=cfg_relaxed)

        # Stricter config should detect fewer or equal rallies
        assert len(result_strict["rallies"]) <= len(result_relaxed["rallies"])


# ---------------------------------------------------------------------------
# TrimmerConfig defaults sanity check
# ---------------------------------------------------------------------------


class TestTrimmerConfig:
    def test_default_weights_sum_to_one(self) -> None:
        cfg = TrimmerConfig()
        assert cfg.motion_weight + cfg.velocity_weight == pytest.approx(1.0)

    def test_thresholds_ordered(self) -> None:
        cfg = TrimmerConfig()
        assert cfg.active_threshold > cfg.dead_threshold

    def test_custom_override(self) -> None:
        cfg = TrimmerConfig(motion_threshold=0.1, min_active_frames=20)
        assert cfg.motion_threshold == pytest.approx(0.1)
        assert cfg.min_active_frames == 20


# ---------------------------------------------------------------------------
# collect_signals — used by the multi-signal rally detector
# ---------------------------------------------------------------------------


class TestCollectSignals:
    """The new helper returns raw streams without running the state machine.

    It must keep the original frame ordering, expose a shake proxy, and
    raise the canonical FileNotFoundError on bad paths.
    """

    def test_returns_signals_for_each_frame(self) -> None:
        frames = [_noise_frame(i) for i in range(8)]
        with patch("cv2.VideoCapture") as mock_cap_cls:
            mock_cap_cls.return_value = _make_cap_mock(frames, fps=30.0)
            trimmer = DeadTimeTrimmer()
            fps, motion, velocity, shake = trimmer.collect_signals("fake.mp4")
        assert fps == pytest.approx(30.0)
        assert len(motion) == len(frames)
        assert len(velocity) == len(frames)
        assert len(shake) == len(frames)
        # The shake proxy must be non-negative (it's an absolute delta).
        assert all(s >= 0.0 for s in shake)

    def test_raises_when_video_cannot_be_opened(self) -> None:
        with patch("cv2.VideoCapture") as mock_cap_cls:
            cap = MagicMock()
            cap.isOpened.return_value = False
            mock_cap_cls.return_value = cap
            trimmer = DeadTimeTrimmer()
            with pytest.raises(FileNotFoundError):
                trimmer.collect_signals("missing.mp4")

    def test_empty_video_returns_empty_lists(self) -> None:
        with patch("cv2.VideoCapture") as mock_cap_cls:
            mock_cap_cls.return_value = _make_cap_mock([], fps=30.0)
            trimmer = DeadTimeTrimmer()
            fps, motion, velocity, shake = trimmer.collect_signals("empty.mp4")
        assert fps == pytest.approx(30.0)
        assert motion == []
        assert velocity == []
        assert shake == []
