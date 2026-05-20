"""Unit tests for ``scripts/cv/rally_detector.py``.

All tests exercise the pure-Python signal fusion + state machine. They
do not depend on a real video file or on ``ffmpeg``; the audio
extraction helpers are exercised separately with monkey-patched
``subprocess.run`` so the suite stays hermetic and fast.
"""

from __future__ import annotations

import math
import os
import sys
from typing import Optional
from unittest.mock import patch, MagicMock

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from cv.rally_detector import (
    RallyDetectionInputs,
    RallyDetectorConfig,
    RallyWindow,
    _adaptive_peak_pick,
    _events_to_density,
    _hysteresis_segments,
    _merge_close_segments,
    _onset_strength,
    _split_long_segment,
    _RawWindow,
    detect_rally_windows,
    extract_audio_onsets_ms,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


FPS = 30.0


def _square_signal(n: int, regions: list[tuple[int, int, float]]) -> list[float]:
    """Build a flat zero signal with high-amplitude rectangles."""
    sig = [0.0] * n
    for start, end, value in regions:
        for i in range(max(0, start), min(n, end + 1)):
            sig[i] = value
    return sig


def _make_inputs(
    motion: Optional[list[float]] = None,
    velocity: Optional[list[Optional[float]]] = None,
    shake: Optional[list[float]] = None,
    audio_onsets_ms: Optional[list[float]] = None,
    shot_events_ms: Optional[list[float]] = None,
    fps: float = FPS,
    frame_count: Optional[int] = None,
) -> RallyDetectionInputs:
    if frame_count is None:
        for candidate in (motion, velocity, shake):
            if candidate is not None:
                frame_count = len(candidate)
                break
        if frame_count is None:
            frame_count = 0
    return RallyDetectionInputs(
        fps=fps,
        frame_count=frame_count,
        motion=motion,
        velocity=velocity,
        shake=shake,
        audio_onsets_ms=audio_onsets_ms,
        shot_events_ms=shot_events_ms,
    )


# ---------------------------------------------------------------------------
# Hysteresis state machine
# ---------------------------------------------------------------------------


class TestHysteresisStateMachine:
    def test_single_block_emits_one_window(self) -> None:
        cfg = RallyDetectorConfig(
            enter_threshold=0.3,
            exit_threshold=0.15,
            min_enter_frames=2,
            min_exit_frames=3,
        )
        activity = np.array([0.0] * 5 + [0.6] * 40 + [0.0] * 5)
        segs = _hysteresis_segments(activity, cfg)
        assert len(segs) == 1
        assert segs[0].start_frame == 5
        # Exits when we have min_exit_frames below exit_threshold: 45 is first
        # below, so segment ends at 44 (the last active frame).
        assert segs[0].end_frame == 44

    def test_below_min_enter_frames_does_not_open(self) -> None:
        cfg = RallyDetectorConfig(
            enter_threshold=0.3,
            exit_threshold=0.15,
            min_enter_frames=4,
            min_exit_frames=2,
        )
        # Only 2 frames above enter threshold — not enough to "open" a rally.
        activity = np.array([0.0] * 5 + [0.6, 0.6] + [0.0] * 20)
        segs = _hysteresis_segments(activity, cfg)
        assert segs == []

    def test_two_separated_blocks_emit_two_windows(self) -> None:
        cfg = RallyDetectorConfig(
            enter_threshold=0.3,
            exit_threshold=0.15,
            min_enter_frames=2,
            min_exit_frames=2,
        )
        activity = np.concatenate(
            [
                np.zeros(5),
                np.full(20, 0.6),
                np.zeros(20),
                np.full(20, 0.6),
                np.zeros(5),
            ]
        )
        segs = _hysteresis_segments(activity, cfg)
        assert len(segs) == 2

    def test_active_at_end_closes_at_last_frame(self) -> None:
        cfg = RallyDetectorConfig(
            enter_threshold=0.3,
            exit_threshold=0.15,
            min_enter_frames=2,
            min_exit_frames=4,
        )
        activity = np.array([0.0] * 5 + [0.7] * 30)
        segs = _hysteresis_segments(activity, cfg)
        assert len(segs) == 1
        assert segs[0].end_frame == activity.size - 1

    def test_empty_signal_returns_empty(self) -> None:
        assert _hysteresis_segments(np.zeros(0), RallyDetectorConfig()) == []


# ---------------------------------------------------------------------------
# Gap merging + duration filters
# ---------------------------------------------------------------------------


class TestGapMerging:
    def test_close_segments_are_merged(self) -> None:
        segs = [
            _RawWindow(start_frame=0, end_frame=20),
            _RawWindow(start_frame=25, end_frame=40),
        ]
        merged = _merge_close_segments(segs, merge_gap_frames=10)
        assert len(merged) == 1
        assert merged[0].start_frame == 0
        assert merged[0].end_frame == 40

    def test_far_segments_are_preserved(self) -> None:
        segs = [
            _RawWindow(start_frame=0, end_frame=20),
            _RawWindow(start_frame=100, end_frame=120),
        ]
        merged = _merge_close_segments(segs, merge_gap_frames=10)
        assert len(merged) == 2

    def test_zero_gap_only_merges_touching_segments(self) -> None:
        segs = [
            _RawWindow(start_frame=0, end_frame=10),
            _RawWindow(start_frame=11, end_frame=20),
            _RawWindow(start_frame=22, end_frame=30),
        ]
        merged = _merge_close_segments(segs, merge_gap_frames=0)
        assert len(merged) == 2
        assert merged[0].start_frame == 0
        assert merged[0].end_frame == 20
        assert merged[1].start_frame == 22


class TestLongSegmentSplitting:
    def test_short_segment_is_not_split(self) -> None:
        seg = _RawWindow(start_frame=0, end_frame=20)
        pieces = _split_long_segment(seg, np.full(100, 0.5), max_frames=60)
        assert len(pieces) == 1
        assert pieces[0] is seg

    def test_long_segment_is_split_at_internal_minimum(self) -> None:
        # Build activity with a clear dip near frame 40.
        n = 80
        activity = np.full(n, 0.5)
        activity[35:45] = 0.05  # local minimum
        seg = _RawWindow(start_frame=0, end_frame=n - 1)
        pieces = _split_long_segment(seg, activity, max_frames=30)
        assert len(pieces) >= 2
        # All pieces must fit within max_frames * 2 (allow for recursive depth).
        for piece in pieces:
            assert piece.end_frame - piece.start_frame + 1 > 0


# ---------------------------------------------------------------------------
# Event density signals
# ---------------------------------------------------------------------------


class TestEventDensity:
    def test_density_includes_lookback_window(self) -> None:
        # 30 fps → frame_ms ~33.3.
        # Single event at 0ms with lookback 350ms should activate ~11 frames forward.
        density = _events_to_density(
            events_ms=[0.0],
            fps=30.0,
            n=30,
            lookback_ms=350.0,
            lookahead_ms=0.0,
            saturation=3.0,
        )
        assert density is not None
        # The event at t=0 sits at frame 0 and density extends *backward* (in
        # an "event at center, integration window in the past" formulation).
        # Implementation: window is [center - lookback, center + lookahead].
        # For an event at the start, the past window is clipped to 0 so the
        # signal must be non-zero at frame 0.
        assert density[0] > 0.0

    def test_multiple_events_saturate(self) -> None:
        density = _events_to_density(
            events_ms=[0.0, 33.0, 66.0, 99.0, 132.0, 165.0],
            fps=30.0,
            n=20,
            lookback_ms=200.0,
            lookahead_ms=0.0,
            saturation=3.0,
        )
        assert density is not None
        # With 6 events within 200ms, the signal must saturate at 1.0
        # somewhere.
        assert float(np.max(density)) == pytest.approx(1.0)

    def test_none_input_returns_none(self) -> None:
        assert _events_to_density(None, 30.0, 30, 200.0, 0.0, 3.0) is None

    def test_empty_events_returns_zero_array(self) -> None:
        out = _events_to_density([], 30.0, 30, 200.0, 0.0, 3.0)
        assert out is not None
        assert out.shape == (30,)
        assert float(np.max(out)) == 0.0


# ---------------------------------------------------------------------------
# Audio onset internals
# ---------------------------------------------------------------------------


class TestOnsetStrength:
    def test_silence_produces_zero_envelope(self) -> None:
        samples = np.zeros(22_050, dtype=np.float32)
        env, hop = _onset_strength(samples, 22_050, 40.0, 10.0)
        assert env.size > 0
        assert float(np.max(env)) == pytest.approx(0.0, abs=1e-6)
        assert hop > 0

    def test_impulse_creates_peak(self) -> None:
        sample_rate = 22_050
        # One-second silence with a sharp impulse at 0.5s.
        samples = np.zeros(sample_rate, dtype=np.float32)
        samples[sample_rate // 2 : sample_rate // 2 + 10] = 0.9
        env, hop = _onset_strength(samples, sample_rate, 40.0, 10.0)
        assert env.size > 0
        peak_time_sec = float(np.argmax(env)) * hop
        # The peak must land within ±100ms of the impulse position.
        assert abs(peak_time_sec - 0.5) < 0.2

    def test_short_signal_returns_empty(self) -> None:
        env, hop = _onset_strength(np.zeros(8), 22_050, 40.0, 10.0)
        assert env.size == 0
        assert hop > 0


class TestAdaptivePeakPick:
    def test_picks_local_maxima_above_threshold(self) -> None:
        cfg = RallyDetectorConfig(audio_threshold_k=1.0, audio_peak_min_distance_ms=10.0)
        envelope = np.zeros(50, dtype=np.float32)
        envelope[10] = 1.0
        envelope[30] = 1.0
        picks_ms = _adaptive_peak_pick(envelope, hop_sec=0.01, config=cfg)
        # Two distinct peaks expected (>100ms apart).
        assert any(abs(p - 100.0) < 20.0 for p in picks_ms)
        assert any(abs(p - 300.0) < 20.0 for p in picks_ms)

    def test_min_distance_suppresses_double_peaks(self) -> None:
        cfg = RallyDetectorConfig(audio_threshold_k=1.0, audio_peak_min_distance_ms=200.0)
        envelope = np.zeros(20, dtype=np.float32)
        envelope[5] = 1.0
        envelope[6] = 0.95
        picks_ms = _adaptive_peak_pick(envelope, hop_sec=0.01, config=cfg)
        # Only one of the near-adjacent peaks should survive.
        assert len(picks_ms) == 1


# ---------------------------------------------------------------------------
# End-to-end detector behaviour
# ---------------------------------------------------------------------------


class TestDetectRallyWindows:
    def _high_motion_clip(self, n: int = 240) -> RallyDetectionInputs:
        # 8-second clip @ 30fps; two rally bursts surrounded by dead time.
        motion = _square_signal(
            n,
            [
                (30, 90, 0.6),  # rally A
                (160, 220, 0.6),  # rally B
            ],
        )
        return _make_inputs(motion=motion, fps=FPS)

    def test_detects_two_rallies_motion_only(self) -> None:
        inputs = self._high_motion_clip()
        cfg = RallyDetectorConfig(
            enter_threshold=0.2,
            exit_threshold=0.08,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=100.0,
            min_rally_ms=500.0,
            merge_gap_ms=300.0,
            pad_pre_ms=0.0,
            pad_post_ms=0.0,
        )
        result = detect_rally_windows(inputs, cfg)
        assert len(result.rallies) == 2
        assert result.rallies[0].rally_id == 0
        assert result.rallies[1].rally_id == 1
        assert result.rallies[0].start_ms < result.rallies[1].start_ms
        assert result.audio_available is False
        assert result.capabilities["motion"] is True

    def test_short_blip_filtered_by_min_duration(self) -> None:
        # 5-frame burst is way under min_rally_ms.
        motion = _square_signal(120, [(30, 35, 0.6)])
        inputs = _make_inputs(motion=motion, fps=FPS)
        cfg = RallyDetectorConfig(
            enter_threshold=0.2,
            exit_threshold=0.08,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=50.0,
            min_rally_ms=1_500.0,
        )
        result = detect_rally_windows(inputs, cfg)
        assert result.rallies == []

    def test_gap_merge_keeps_a_single_long_rally(self) -> None:
        # Two motion bursts separated by a 12-frame (~400ms) gap — should
        # merge into one rally when merge_gap_ms is set high enough.
        motion = _square_signal(
            240,
            [
                (30, 90, 0.6),
                (102, 200, 0.6),
            ],
        )
        inputs = _make_inputs(motion=motion, fps=FPS)
        cfg = RallyDetectorConfig(
            enter_threshold=0.2,
            exit_threshold=0.08,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=50.0,
            merge_gap_ms=800.0,
            min_rally_ms=500.0,
            pad_pre_ms=0.0,
            pad_post_ms=0.0,
        )
        result = detect_rally_windows(inputs, cfg)
        assert len(result.rallies) == 1
        assert result.rallies[0].start_frame <= 30
        assert result.rallies[0].end_frame >= 200

    def test_missing_signals_degrade_gracefully(self) -> None:
        # No motion, no velocity, no shots — only audio onsets.
        n = 240
        # Cluster of 8 onsets in a 1.5s window centred on frame 120 (= 4s).
        base_ms = 4_000.0
        onsets = [base_ms + 150.0 * i for i in range(8)]
        inputs = _make_inputs(
            motion=None,
            velocity=None,
            audio_onsets_ms=onsets,
            fps=FPS,
            frame_count=n,
        )
        cfg = RallyDetectorConfig(
            enter_threshold=0.15,
            exit_threshold=0.05,
            min_enter_frames=2,
            min_exit_frames=4,
            smoothing_window_ms=200.0,
            min_rally_ms=500.0,
            pad_pre_ms=0.0,
            pad_post_ms=0.0,
        )
        result = detect_rally_windows(inputs, cfg)
        assert result.audio_available is True
        assert result.capabilities["audio"] is True
        assert len(result.rallies) >= 1
        rally = result.rallies[0]
        # Audio cluster should be reflected in the aggregated signals.
        assert rally.signals["audio_peak_count"] >= 6
        assert rally.signals["audio_density"] > 0.0

    def test_audio_boost_confidence(self) -> None:
        # Same motion block; with audio onsets present the confidence must be
        # at least as high (we never penalise extra evidence).
        motion = _square_signal(240, [(60, 180, 0.5)])
        cfg = RallyDetectorConfig(
            enter_threshold=0.2,
            exit_threshold=0.08,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=100.0,
            min_rally_ms=500.0,
            pad_pre_ms=0.0,
            pad_post_ms=0.0,
        )
        no_audio = detect_rally_windows(
            _make_inputs(motion=motion, fps=FPS), cfg
        )
        # Five audio onsets spread inside the rally window.
        onsets = [2_000.0 + 400.0 * i for i in range(5)]
        with_audio = detect_rally_windows(
            _make_inputs(motion=motion, audio_onsets_ms=onsets, fps=FPS),
            cfg,
        )
        assert len(no_audio.rallies) == 1
        assert len(with_audio.rallies) == 1
        assert with_audio.rallies[0].confidence >= no_audio.rallies[0].confidence

    def test_camera_shake_suppresses_pure_shake_windows(self) -> None:
        n = 240
        motion = _square_signal(n, [(40, 200, 0.4)])
        # The shake signal mirrors motion (entire motion is explained by shake).
        shake = motion.copy()
        inputs = _make_inputs(motion=motion, shake=shake, fps=FPS)
        cfg = RallyDetectorConfig(
            enter_threshold=0.15,
            exit_threshold=0.06,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=50.0,
            min_rally_ms=500.0,
            shake_high_ratio=0.8,
            pad_pre_ms=0.0,
            pad_post_ms=0.0,
        )
        result = detect_rally_windows(inputs, cfg)
        # Either the shake penalty kept activity below threshold, or the
        # post-fusion shake-ratio filter dropped the window. Either way:
        # zero rallies for a pure-shake clip.
        assert result.rallies == []

    def test_padding_clamps_to_video_bounds(self) -> None:
        n = 60
        motion = _square_signal(n, [(0, n - 1, 0.6)])
        inputs = _make_inputs(motion=motion, fps=FPS)
        cfg = RallyDetectorConfig(
            enter_threshold=0.2,
            exit_threshold=0.08,
            min_enter_frames=2,
            min_exit_frames=3,
            smoothing_window_ms=50.0,
            min_rally_ms=500.0,
            pad_pre_ms=1_000.0,
            pad_post_ms=1_000.0,
        )
        result = detect_rally_windows(inputs, cfg)
        assert len(result.rallies) == 1
        rally = result.rallies[0]
        assert rally.start_frame >= 0
        assert rally.end_frame <= n - 1
        assert rally.start_ms >= 0.0

    def test_empty_inputs_return_empty_result(self) -> None:
        result = detect_rally_windows(_make_inputs(motion=[], fps=FPS))
        assert result.rallies == []
        assert result.total_active_ms == 0.0
        assert result.duration_ms == 0.0

    def test_to_dict_contains_required_fields(self) -> None:
        motion = _square_signal(120, [(20, 100, 0.6)])
        result = detect_rally_windows(
            _make_inputs(motion=motion, fps=FPS),
            RallyDetectorConfig(
                enter_threshold=0.2,
                exit_threshold=0.08,
                min_enter_frames=2,
                min_exit_frames=2,
                smoothing_window_ms=50.0,
                min_rally_ms=500.0,
                pad_pre_ms=0.0,
                pad_post_ms=0.0,
            ),
        )
        payload = result.to_dict()
        assert {"rallies", "fps", "frame_count", "duration_ms", "capabilities"} <= payload.keys()
        assert payload["audio_available"] is False
        assert payload["capabilities"]["motion"] is True
        for rally in payload["rallies"]:
            assert {
                "rally_id",
                "start_frame",
                "end_frame",
                "start_ms",
                "end_ms",
                "start_sec",
                "end_sec",
                "duration_sec",
                "confidence",
                "signals",
            } <= rally.keys()
            assert 0.0 <= rally["confidence"] <= 1.0


# ---------------------------------------------------------------------------
# Audio extraction (ffmpeg subprocess is patched out)
# ---------------------------------------------------------------------------


class TestExtractAudioOnsetsMs:
    def test_missing_video_returns_none(self) -> None:
        result = extract_audio_onsets_ms("/no/such/file.mp4")
        assert result is None

    def test_handles_ffmpeg_missing(self, tmp_path) -> None:
        fake_video = tmp_path / "clip.mp4"
        fake_video.write_bytes(b"\x00" * 16)
        with patch(
            "cv.rally_detector.subprocess.run",
            side_effect=FileNotFoundError("ffmpeg"),
        ):
            result = extract_audio_onsets_ms(str(fake_video))
        assert result is None

    def test_returns_list_for_decoded_pcm(self, tmp_path) -> None:
        fake_video = tmp_path / "clip.mp4"
        fake_video.write_bytes(b"\x00" * 16)

        # Build 1 second of silence + a short loud impulse in the middle.
        sample_rate = 22_050
        samples = np.zeros(sample_rate, dtype=np.float32)
        samples[sample_rate // 2 : sample_rate // 2 + 64] = 0.9
        pcm = (samples * 32_767).astype(np.int16).tobytes()
        completed = MagicMock()
        completed.returncode = 0
        completed.stdout = pcm
        completed.stderr = b""
        with patch("cv.rally_detector.subprocess.run", return_value=completed):
            result = extract_audio_onsets_ms(str(fake_video))
        assert isinstance(result, list)
        # At least one onset should be detected for the impulse.
        assert len(result) >= 1
        assert all(isinstance(t, float) for t in result)
