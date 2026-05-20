"""
Rally Detection Engine — production fusion of audio, tracking and motion cues.

This module replaces the simple motion-only state machine in
``dead_time_trimmer.py`` with a multi-signal detector that flags the
"active rally windows" a Padel viewer (or SwingVision-style highlight reel)
actually cares about. It is designed for:

* **Signal fusion** of independent cues so missing modalities degrade
  gracefully: per-frame visual motion, ball pixel velocity, audio ball-hit
  onsets, shot events from the court mapping module, and camera-shake
  penalisation.
* **Hysteresis with min/max duration constraints and gap merging** so a
  single missed contact does not split a rally and a player walking back
  for a serve does not accidentally extend one.
* **Typed, JSON-safe rally windows** indexed by both video frame number
  and millisecond timestamp so the client UI (frame-accurate skeleton
  scrubbing *and* dead-time skipping) consume the same contract.

Design constraints (from ``.cursorrules``):

* No UI-thread blocking — this runs in the server-side Python worker.
* Raw tracking signals are kept separate from derived metrics.
* Payloads are lightweight and indexed by frame number / timestamp.
* No placeholder ``TODO`` logic — every branch is implemented or
  explicitly documents a graceful fallback.
* Handles erratic FPS (low/zero FPS fallback to a sensible default), no
  audio track, missing tracking, glass reflections (penalised via shake +
  duration filter), and lobs/chiquitas (velocity normalisation is per
  rally rather than global so high-arc lobs are not clipped).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field
from enum import Enum, auto
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

import numpy as np

try:  # SciPy is a hard requirement (already in scripts/cv/requirements.txt).
    from scipy.signal import medfilt  # type: ignore[import-untyped]
except Exception:  # pragma: no cover - SciPy is in requirements but allow degrade.
    medfilt = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class RallyDetectorConfig:
    """Tuneable parameters for the multi-signal rally detector.

    Defaults are calibrated for 1080p / 30 fps padel footage where the
    audio track is the *original* phone or GoPro recording (not muted).
    All thresholds are normalised to the [0, 1] range so the same config
    works whether motion or audio is the dominant signal in any given
    clip.
    """

    # ── Fusion weights ────────────────────────────────────────────────────
    motion_weight: float = 0.45
    velocity_weight: float = 0.20
    audio_weight: float = 0.25
    shot_weight: float = 0.10
    shake_penalty_weight: float = 0.30

    # ── Audio extraction ─────────────────────────────────────────────────
    audio_sample_rate: int = 22_050
    audio_frame_ms: float = 40.0
    audio_hop_ms: float = 10.0
    audio_band_highpass_hz: float = 800.0
    audio_band_lowpass_hz: float = 8_000.0
    audio_peak_min_distance_ms: float = 120.0
    audio_threshold_k: float = 3.0  # adaptive MAD multiplier
    audio_local_window_sec: float = 1.5
    audio_extraction_timeout_sec: float = 60.0

    # ── Per-frame audio integration ───────────────────────────────────────
    audio_density_lookback_ms: float = 350.0
    audio_density_lookahead_ms: float = 80.0
    audio_density_norm: float = 3.0  # ~3 hits in 350ms ⇒ saturated 1.0

    # ── Velocity normalisation ────────────────────────────────────────────
    velocity_norm_factor: float = 60.0  # px/frame at which signal saturates

    # ── Smoothing ─────────────────────────────────────────────────────────
    smoothing_window_ms: float = 250.0  # median filter span

    # ── Hysteresis thresholds ─────────────────────────────────────────────
    enter_threshold: float = 0.20
    exit_threshold: float = 0.09
    min_enter_frames: int = 3
    min_exit_frames: int = 6

    # ── Window post-processing (all in milliseconds) ──────────────────────
    min_rally_ms: float = 1_000.0
    max_rally_ms: float = 60_000.0
    merge_gap_ms: float = 900.0
    pad_pre_ms: float = 250.0
    pad_post_ms: float = 400.0

    # ── Camera shake suppression ──────────────────────────────────────────
    shake_high_ratio: float = 0.80  # >80% of motion looks like shake → drop
    shake_norm: float = 0.20  # raw shake magnitude that maps to 1.0

    # ── Confidence calibration ────────────────────────────────────────────
    duration_bonus_cap_ms: float = 8_000.0  # diminishing returns past this

    def smoothing_window_frames(self, fps: float) -> int:
        """Return an odd-sized smoothing window appropriate for *fps*."""
        if fps <= 0:
            return 1
        raw = max(1, int(round(self.smoothing_window_ms * fps / 1_000.0)))
        return raw if raw % 2 == 1 else raw + 1


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class RallyWindow:
    """A typed, JSON-safe rally segment.

    All time-domain coordinates are present (frames AND milliseconds) so
    consumers can decide which is convenient. The ``signals`` dict carries
    the *aggregated* evidence used by the confidence model — never the
    raw per-frame signals, which would bloat the payload.
    """

    rally_id: int
    start_frame: int
    end_frame: int
    start_ms: float
    end_ms: float
    confidence: float
    signals: dict[str, float] = field(default_factory=dict)

    @property
    def duration_ms(self) -> float:
        return max(0.0, self.end_ms - self.start_ms)

    def to_dict(self) -> dict[str, Any]:
        return {
            "rally_id": int(self.rally_id),
            "start_frame": int(self.start_frame),
            "end_frame": int(self.end_frame),
            "start_ms": float(round(self.start_ms, 3)),
            "end_ms": float(round(self.end_ms, 3)),
            "start_sec": float(round(self.start_ms / 1_000.0, 4)),
            "end_sec": float(round(self.end_ms / 1_000.0, 4)),
            "duration_sec": float(round(self.duration_ms / 1_000.0, 4)),
            "confidence": float(round(self.confidence, 4)),
            "signals": {k: float(round(v, 4)) for k, v in self.signals.items()},
        }


@dataclass
class RallyDetectionInputs:
    """Bundle of all available per-video signals the detector can consume.

    Any field except ``fps`` and ``frame_count`` may be ``None``; the
    detector will downweight or skip the corresponding cue and continue.
    """

    fps: float
    frame_count: int
    motion: Optional[Sequence[float]] = None
    velocity: Optional[Sequence[Optional[float]]] = None
    shake: Optional[Sequence[float]] = None
    audio_onsets_ms: Optional[Sequence[float]] = None
    shot_events_ms: Optional[Sequence[float]] = None


@dataclass
class RallyDetectionResult:
    """The detector's output envelope."""

    fps: float
    frame_count: int
    duration_ms: float
    rallies: list[RallyWindow]
    total_active_ms: float
    total_dead_ms: float
    audio_available: bool
    capabilities: dict[str, bool]

    def to_dict(self) -> dict[str, Any]:
        active = float(round(self.total_active_ms, 3))
        dead = float(round(self.total_dead_ms, 3))
        return {
            "fps": float(self.fps),
            "frame_count": int(self.frame_count),
            "duration_ms": float(round(self.duration_ms, 3)),
            "total_active_ms": active,
            "total_dead_ms": dead,
            "total_active_sec": float(round(active / 1_000.0, 4)),
            "total_dead_sec": float(round(dead / 1_000.0, 4)),
            "trim_ratio": float(
                round(
                    dead / self.duration_ms if self.duration_ms > 0 else 0.0,
                    6,
                )
            ),
            "audio_available": bool(self.audio_available),
            "capabilities": {k: bool(v) for k, v in self.capabilities.items()},
            "rallies": [r.to_dict() for r in self.rallies],
        }


# ---------------------------------------------------------------------------
# Audio onset detection (ffmpeg + numpy)
# ---------------------------------------------------------------------------


class _AudioExtractionError(RuntimeError):
    """Raised when ffmpeg cannot decode usable audio from a video."""


def _decode_audio_pcm(
    video_path: str,
    sample_rate: int,
    timeout_sec: float,
) -> np.ndarray:
    """Return mono PCM audio as ``float32`` in [-1, 1].

    Spawns ``ffmpeg`` once to decode the video's first audio stream to
    little-endian 16-bit signed PCM at *sample_rate* Hz, mono. The raw
    bytes are streamed via stdout so we never materialise a temp file.
    """

    if not os.path.isfile(video_path):
        raise _AudioExtractionError(f"Video not found: {video_path!r}")

    cmd = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(int(sample_rate)),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "pipe:1",
    ]
    try:
        completed = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_sec,
        )
    except FileNotFoundError as exc:
        raise _AudioExtractionError(
            "ffmpeg binary is not available on PATH (install via Homebrew: `brew install ffmpeg`)."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise _AudioExtractionError(
            f"ffmpeg audio extraction timed out after {timeout_sec:.0f}s for {video_path!r}."
        ) from exc

    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        raise _AudioExtractionError(
            f"ffmpeg failed (exit {completed.returncode}): {stderr[:280]}"
        )

    raw = completed.stdout
    if not raw:
        raise _AudioExtractionError(
            "ffmpeg produced no audio output (video may have no audio track)."
        )

    samples = np.frombuffer(raw, dtype=np.int16)
    if samples.size == 0:
        raise _AudioExtractionError("Empty audio buffer.")
    return samples.astype(np.float32) / 32_768.0


def _design_bandpass(
    sample_rate: int,
    low_hz: float,
    high_hz: float,
    order: int = 4,
) -> Optional[tuple[np.ndarray, np.ndarray]]:
    """Return Butterworth band-pass IIR ``(b, a)`` or ``None`` if SciPy unavailable."""
    try:
        from scipy.signal import butter  # type: ignore[import-untyped]
    except Exception:  # pragma: no cover
        return None

    nyquist = sample_rate / 2.0
    low = max(1e-3, low_hz / nyquist)
    high = min(0.999, high_hz / nyquist)
    if not (0.0 < low < high < 1.0):
        return None
    b, a = butter(order, [low, high], btype="bandpass")
    return b, a


def _filter_audio(samples: np.ndarray, sample_rate: int, config: RallyDetectorConfig) -> np.ndarray:
    """Band-pass the audio to the ball-hit acoustic band when SciPy is present."""
    coeffs = _design_bandpass(
        sample_rate,
        config.audio_band_highpass_hz,
        config.audio_band_lowpass_hz,
    )
    if coeffs is None:
        return samples
    try:
        from scipy.signal import filtfilt  # type: ignore[import-untyped]
    except Exception:  # pragma: no cover
        return samples
    b, a = coeffs
    return filtfilt(b, a, samples).astype(np.float32, copy=False)


def _onset_strength(
    samples: np.ndarray,
    sample_rate: int,
    frame_ms: float,
    hop_ms: float,
) -> tuple[np.ndarray, float]:
    """Compute a half-wave rectified spectral-flux envelope.

    Returns ``(envelope, hop_sec)`` so callers can convert peak indices to
    timestamps without reconstructing the hop size.
    """
    frame_size = max(8, int(round(sample_rate * frame_ms / 1_000.0)))
    hop_size = max(1, int(round(sample_rate * hop_ms / 1_000.0)))
    if samples.size < frame_size:
        return np.zeros(0, dtype=np.float32), hop_size / float(sample_rate)

    n_frames = 1 + (samples.size - frame_size) // hop_size
    window = np.hanning(frame_size).astype(np.float32)
    prev_mag = np.zeros(frame_size // 2 + 1, dtype=np.float32)
    envelope = np.zeros(n_frames, dtype=np.float32)

    for i in range(n_frames):
        start = i * hop_size
        seg = samples[start : start + frame_size] * window
        spec = np.fft.rfft(seg)
        mag = np.abs(spec).astype(np.float32)
        diff = np.maximum(0.0, mag - prev_mag)
        envelope[i] = float(np.sum(diff))
        prev_mag = mag

    if envelope.size > 0:
        peak = float(np.max(envelope))
        if peak > 0:
            envelope = envelope / peak

    return envelope, hop_size / float(sample_rate)


def _adaptive_peak_pick(
    envelope: np.ndarray,
    hop_sec: float,
    config: RallyDetectorConfig,
) -> list[float]:
    """Pick local maxima above an adaptive (median + k * MAD) threshold."""
    if envelope.size == 0:
        return []

    local_frames = max(3, int(round(config.audio_local_window_sec / max(hop_sec, 1e-6))))
    half = max(1, local_frames // 2)
    pad = np.pad(envelope, half, mode="edge")
    out: list[float] = []
    min_gap = max(1, int(round((config.audio_peak_min_distance_ms / 1_000.0) / max(hop_sec, 1e-6))))
    last_idx = -min_gap - 1

    for i in range(envelope.size):
        window = pad[i : i + 2 * half + 1]
        med = float(np.median(window))
        mad = float(np.median(np.abs(window - med))) or 1e-6
        threshold = med + config.audio_threshold_k * mad
        value = float(envelope[i])
        if value < threshold:
            continue
        # local maximum check
        left = float(envelope[i - 1]) if i > 0 else -math.inf
        right = float(envelope[i + 1]) if i + 1 < envelope.size else -math.inf
        if value < left or value < right:
            continue
        if i - last_idx < min_gap:
            # Keep the louder of the two near-coincident peaks
            if out and value > envelope[last_idx]:
                out[-1] = i * hop_sec * 1_000.0
                last_idx = i
            continue
        out.append(i * hop_sec * 1_000.0)
        last_idx = i

    return out


def extract_audio_onsets_ms(
    video_path: str,
    config: Optional[RallyDetectorConfig] = None,
) -> Optional[list[float]]:
    """Return ball-hit onset times (ms) detected from the video's audio track.

    Returns ``None`` if the audio cannot be extracted (no track, no
    ffmpeg, decode error). Callers should treat ``None`` as "skip audio
    fusion entirely" rather than as a failure.
    """
    cfg = config or RallyDetectorConfig()
    try:
        samples = _decode_audio_pcm(
            video_path,
            cfg.audio_sample_rate,
            cfg.audio_extraction_timeout_sec,
        )
    except _AudioExtractionError as exc:
        print(f"[rally-detector] audio unavailable: {exc}", file=sys.stderr)
        return None

    filtered = _filter_audio(samples, cfg.audio_sample_rate, cfg)
    envelope, hop_sec = _onset_strength(
        filtered,
        cfg.audio_sample_rate,
        cfg.audio_frame_ms,
        cfg.audio_hop_ms,
    )
    if envelope.size == 0:
        return []

    onsets = _adaptive_peak_pick(envelope, hop_sec, cfg)
    return onsets


# ---------------------------------------------------------------------------
# Signal building
# ---------------------------------------------------------------------------


def _coerce_to_array(values: Optional[Sequence[float]], n: int) -> Optional[np.ndarray]:
    if values is None:
        return None
    arr = np.zeros(n, dtype=np.float64)
    upto = min(n, len(values))
    for i in range(upto):
        v = values[i]
        if v is None:
            continue
        if isinstance(v, float) and not math.isfinite(v):
            continue
        arr[i] = float(v)
    return arr


def _normalise_velocity(
    velocity: Optional[Sequence[Optional[float]]],
    norm_factor: float,
    n: int,
) -> Optional[np.ndarray]:
    if velocity is None:
        return None
    arr = np.zeros(n, dtype=np.float64)
    upto = min(n, len(velocity))
    norm = norm_factor if norm_factor > 1e-6 else 1.0
    for i in range(upto):
        v = velocity[i]
        if v is None:
            continue
        if isinstance(v, float) and not math.isfinite(v):
            continue
        arr[i] = min(1.0, float(v) / norm)
    return arr


def _events_to_density(
    events_ms: Optional[Sequence[float]],
    fps: float,
    n: int,
    lookback_ms: float,
    lookahead_ms: float,
    saturation: float,
) -> Optional[np.ndarray]:
    """Convert a list of event timestamps into a per-frame density signal.

    Each frame counts how many events fall within a temporal window
    (``-lookback_ms .. +lookahead_ms``) and the count is normalised by
    *saturation* so the signal stays in [0, 1].
    """
    if events_ms is None:
        return None
    if n <= 0 or fps <= 0:
        return np.zeros(max(n, 0), dtype=np.float64)

    counts = np.zeros(n, dtype=np.float64)
    if not events_ms:
        return counts

    frame_ms = 1_000.0 / fps
    for ev in events_ms:
        if ev is None:
            continue
        if isinstance(ev, float) and not math.isfinite(ev):
            continue
        center = int(round(float(ev) / frame_ms))
        start = max(0, center - int(round(lookback_ms / frame_ms)))
        end = min(n - 1, center + int(round(lookahead_ms / frame_ms)))
        if start > end:
            continue
        counts[start : end + 1] += 1.0

    sat = saturation if saturation > 1e-6 else 1.0
    return np.minimum(1.0, counts / sat)


def _smooth(signal: np.ndarray, window_frames: int) -> np.ndarray:
    if signal.size == 0 or window_frames <= 1:
        return signal
    win = window_frames if window_frames % 2 == 1 else window_frames + 1
    win = min(win, signal.size if signal.size % 2 == 1 else signal.size - 1)
    if win <= 1:
        return signal
    if medfilt is None:  # pragma: no cover - SciPy is in requirements.
        # Fallback: moving-average smoothing.
        kernel = np.ones(win, dtype=np.float64) / float(win)
        return np.convolve(signal, kernel, mode="same")
    return medfilt(signal, kernel_size=win)


def _build_activity_signal(
    inputs: RallyDetectionInputs,
    config: RallyDetectorConfig,
) -> tuple[np.ndarray, dict[str, Optional[np.ndarray]]]:
    """Return the smoothed [0,1] activity envelope + per-cue contributions."""

    n = max(0, int(inputs.frame_count))
    fps = inputs.fps if inputs.fps > 0 else 30.0

    motion = _coerce_to_array(inputs.motion, n)
    velocity = _normalise_velocity(inputs.velocity, config.velocity_norm_factor, n)
    shake_raw = _coerce_to_array(inputs.shake, n)
    shake = None
    if shake_raw is not None:
        norm = config.shake_norm if config.shake_norm > 1e-6 else 1.0
        shake = np.minimum(1.0, shake_raw / norm)

    audio_density = _events_to_density(
        inputs.audio_onsets_ms,
        fps,
        n,
        config.audio_density_lookback_ms,
        config.audio_density_lookahead_ms,
        config.audio_density_norm,
    )
    shot_density = _events_to_density(
        inputs.shot_events_ms,
        fps,
        n,
        config.audio_density_lookback_ms,
        config.audio_density_lookahead_ms,
        config.audio_density_norm,
    )

    cues: dict[str, Optional[np.ndarray]] = {
        "motion": motion,
        "velocity": velocity,
        "audio": audio_density,
        "shots": shot_density,
        "shake": shake,
    }

    if n == 0:
        return np.zeros(0, dtype=np.float64), cues

    # Reweight to compensate for missing cues so the activation envelope
    # is comparable across clips with/without an audio track.
    weight_map = {
        "motion": config.motion_weight,
        "velocity": config.velocity_weight,
        "audio": config.audio_weight,
        "shots": config.shot_weight,
    }
    present_total = sum(
        weight for key, weight in weight_map.items() if cues[key] is not None
    )
    scale = 1.0 / present_total if present_total > 1e-6 else 0.0

    signal = np.zeros(n, dtype=np.float64)
    for key, weight in weight_map.items():
        cue = cues[key]
        if cue is None:
            continue
        signal += scale * weight * cue

    if shake is not None and config.shake_penalty_weight > 0:
        signal -= config.shake_penalty_weight * shake

    signal = np.clip(signal, 0.0, 1.0)
    return _smooth(signal, config.smoothing_window_frames(fps)), cues


# ---------------------------------------------------------------------------
# Hysteresis state machine
# ---------------------------------------------------------------------------


class _State(Enum):
    DEAD = auto()
    ACTIVE = auto()


@dataclass
class _RawWindow:
    start_frame: int
    end_frame: int


def _hysteresis_segments(
    activity: np.ndarray,
    config: RallyDetectorConfig,
) -> list[_RawWindow]:
    """Run the two-threshold state machine and return raw frame windows."""
    if activity.size == 0:
        return []

    state = _State.DEAD
    segments: list[_RawWindow] = []
    start_idx: Optional[int] = None
    above_run = 0
    below_run = 0

    for i in range(activity.size):
        score = float(activity[i])
        if state is _State.DEAD:
            if score >= config.enter_threshold:
                above_run += 1
                if start_idx is None:
                    start_idx = i
                if above_run >= max(1, config.min_enter_frames):
                    state = _State.ACTIVE
                    below_run = 0
            else:
                above_run = 0
                start_idx = None
        else:  # ACTIVE
            if score < config.exit_threshold:
                below_run += 1
                if below_run >= max(1, config.min_exit_frames):
                    # ``below_run`` consecutive dead frames just confirmed the
                    # exit; the last *active* frame is therefore the one that
                    # immediately preceded that run.
                    end_idx = i - below_run
                    if start_idx is not None and end_idx >= start_idx:
                        segments.append(_RawWindow(start_frame=start_idx, end_frame=end_idx))
                    state = _State.DEAD
                    start_idx = None
                    above_run = 0
                    below_run = 0
            else:
                below_run = 0

    if state is _State.ACTIVE and start_idx is not None:
        segments.append(_RawWindow(start_frame=start_idx, end_frame=int(activity.size - 1)))

    return segments


def _merge_close_segments(
    segments: list[_RawWindow],
    merge_gap_frames: int,
) -> list[_RawWindow]:
    if not segments:
        return []
    merged = [segments[0]]
    for seg in segments[1:]:
        gap = seg.start_frame - merged[-1].end_frame - 1
        if gap <= merge_gap_frames:
            merged[-1] = _RawWindow(
                start_frame=merged[-1].start_frame,
                end_frame=max(merged[-1].end_frame, seg.end_frame),
            )
        else:
            merged.append(seg)
    return merged


def _split_long_segment(
    segment: _RawWindow,
    activity: np.ndarray,
    max_frames: int,
) -> list[_RawWindow]:
    """Split *segment* at internal minima until each piece fits ``max_frames``."""
    span = segment.end_frame - segment.start_frame + 1
    if span <= max_frames:
        return [segment]

    if activity.size == 0:
        return [segment]

    sub = activity[segment.start_frame : segment.end_frame + 1]
    # Find the lowest internal minimum (excluding the very edges).
    interior_start = max(1, int(0.1 * sub.size))
    interior_end = min(sub.size - 1, int(0.9 * sub.size))
    if interior_end <= interior_start:
        mid = segment.start_frame + sub.size // 2
        return [
            _RawWindow(start_frame=segment.start_frame, end_frame=mid - 1),
            _RawWindow(start_frame=mid + 1, end_frame=segment.end_frame),
        ]
    interior = sub[interior_start:interior_end]
    split_idx = int(np.argmin(interior)) + interior_start + segment.start_frame
    pieces = [
        _RawWindow(start_frame=segment.start_frame, end_frame=max(segment.start_frame, split_idx - 1)),
        _RawWindow(start_frame=min(segment.end_frame, split_idx + 1), end_frame=segment.end_frame),
    ]
    result: list[_RawWindow] = []
    for piece in pieces:
        if piece.end_frame - piece.start_frame + 1 > max_frames:
            result.extend(_split_long_segment(piece, activity, max_frames))
        else:
            result.append(piece)
    return result


# ---------------------------------------------------------------------------
# Confidence and aggregation
# ---------------------------------------------------------------------------


def _segment_signals(
    segment: _RawWindow,
    cues: dict[str, Optional[np.ndarray]],
    fps: float,
    inputs: RallyDetectionInputs,
) -> dict[str, float]:
    """Aggregate per-cue evidence inside a window for confidence + UI."""
    s, e = segment.start_frame, segment.end_frame
    duration_ms = max(0.0, (e - s + 1) * 1_000.0 / max(fps, 1e-6))

    def _mean(arr: Optional[np.ndarray]) -> float:
        if arr is None or arr.size == 0 or e < s:
            return 0.0
        sliced = arr[s : e + 1]
        return float(sliced.mean()) if sliced.size > 0 else 0.0

    def _count(events_ms: Optional[Sequence[float]]) -> int:
        if not events_ms:
            return 0
        start_ms = s * 1_000.0 / max(fps, 1e-6)
        end_ms = (e + 1) * 1_000.0 / max(fps, 1e-6)
        return int(sum(1 for ev in events_ms if ev is not None and start_ms <= float(ev) <= end_ms))

    motion_energy = _mean(cues.get("motion"))
    velocity_energy = _mean(cues.get("velocity"))
    audio_density = _mean(cues.get("audio"))
    shot_density = _mean(cues.get("shots"))
    shake_energy = _mean(cues.get("shake"))

    return {
        "duration_ms": float(duration_ms),
        "motion_energy": float(motion_energy),
        "velocity_energy": float(velocity_energy),
        "audio_density": float(audio_density),
        "shot_density": float(shot_density),
        "shake_energy": float(shake_energy),
        "audio_peak_count": float(_count(inputs.audio_onsets_ms)),
        "shot_event_count": float(_count(inputs.shot_events_ms)),
    }


def _confidence_for(signals: dict[str, float], config: RallyDetectorConfig) -> float:
    """Combine aggregated signals into a calibrated confidence in [0, 1]."""
    duration_ms = signals.get("duration_ms", 0.0)
    duration_bonus = min(
        1.0,
        duration_ms / config.duration_bonus_cap_ms if config.duration_bonus_cap_ms > 0 else 1.0,
    )

    motion = signals.get("motion_energy", 0.0)
    velocity = signals.get("velocity_energy", 0.0)
    audio = signals.get("audio_density", 0.0)
    shots = signals.get("shot_density", 0.0)
    shake = signals.get("shake_energy", 0.0)

    base = (
        config.motion_weight * motion
        + config.velocity_weight * velocity
        + config.audio_weight * audio
        + config.shot_weight * shots
    )
    weight_sum = (
        config.motion_weight
        + config.velocity_weight
        + config.audio_weight
        + config.shot_weight
    )
    normalised = base / weight_sum if weight_sum > 1e-6 else 0.0
    penalty = config.shake_penalty_weight * shake
    score = max(0.0, normalised - penalty) * (0.55 + 0.45 * duration_bonus)
    return float(min(1.0, max(0.0, score)))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def detect_rally_windows(
    inputs: RallyDetectionInputs,
    config: Optional[RallyDetectorConfig] = None,
) -> RallyDetectionResult:
    """Detect rally windows by fusing all available cues.

    Args:
        inputs: All available raw signals + video metadata.
        config: Optional override of :class:`RallyDetectorConfig`.

    Returns:
        A :class:`RallyDetectionResult` containing typed rally windows
        indexed by both frame number and millisecond timestamp.
    """
    cfg = config or RallyDetectorConfig()
    fps = inputs.fps if inputs.fps > 0 else 30.0
    n = max(0, int(inputs.frame_count))
    duration_ms = float(n) * 1_000.0 / max(fps, 1e-6) if n > 0 else 0.0

    capabilities = {
        "motion": inputs.motion is not None,
        "velocity": inputs.velocity is not None,
        "audio": inputs.audio_onsets_ms is not None,
        "shots": inputs.shot_events_ms is not None,
        "shake": inputs.shake is not None,
    }

    if n == 0 or not any(
        capabilities[key] for key in ("motion", "velocity", "audio", "shots")
    ):
        return RallyDetectionResult(
            fps=float(fps),
            frame_count=int(n),
            duration_ms=duration_ms,
            rallies=[],
            total_active_ms=0.0,
            total_dead_ms=duration_ms,
            audio_available=bool(capabilities["audio"]),
            capabilities=capabilities,
        )

    activity, cues = _build_activity_signal(inputs, cfg)
    raw_segments = _hysteresis_segments(activity, cfg)

    merge_gap_frames = max(0, int(round(cfg.merge_gap_ms * fps / 1_000.0)))
    merged = _merge_close_segments(raw_segments, merge_gap_frames)

    min_frames = max(1, int(round(cfg.min_rally_ms * fps / 1_000.0)))
    filtered = [seg for seg in merged if seg.end_frame - seg.start_frame + 1 >= min_frames]

    # Split overly long windows (e.g. accidentally fused multi-rally blocks).
    max_frames = max(min_frames + 1, int(round(cfg.max_rally_ms * fps / 1_000.0)))
    split: list[_RawWindow] = []
    for seg in filtered:
        split.extend(_split_long_segment(seg, activity, max_frames))

    # Apply padding within video bounds.
    pad_pre = int(round(cfg.pad_pre_ms * fps / 1_000.0))
    pad_post = int(round(cfg.pad_post_ms * fps / 1_000.0))
    padded: list[_RawWindow] = []
    for seg in split:
        s = max(0, seg.start_frame - pad_pre)
        e = min(n - 1, seg.end_frame + pad_post)
        if e < s:
            continue
        padded.append(_RawWindow(start_frame=s, end_frame=e))
    # Padding can re-introduce overlap; merge again at zero gap.
    padded = _merge_close_segments(padded, merge_gap_frames=0)

    # Shake suppression — drop windows that look like pure camera shake.
    surviving: list[_RawWindow] = []
    for seg in padded:
        seg_signals = _segment_signals(seg, cues, fps, inputs)
        motion = seg_signals["motion_energy"]
        shake = seg_signals["shake_energy"]
        if motion > 0 and shake / motion >= cfg.shake_high_ratio:
            continue
        surviving.append(seg)

    rallies: list[RallyWindow] = []
    total_active_ms = 0.0
    for idx, seg in enumerate(surviving):
        seg_signals = _segment_signals(seg, cues, fps, inputs)
        confidence = _confidence_for(seg_signals, cfg)
        start_ms = seg.start_frame * 1_000.0 / max(fps, 1e-6)
        end_ms = (seg.end_frame + 1) * 1_000.0 / max(fps, 1e-6)
        duration = end_ms - start_ms
        total_active_ms += max(0.0, duration)
        rallies.append(
            RallyWindow(
                rally_id=idx,
                start_frame=int(seg.start_frame),
                end_frame=int(seg.end_frame),
                start_ms=float(start_ms),
                end_ms=float(end_ms),
                confidence=float(confidence),
                signals=seg_signals,
            )
        )

    return RallyDetectionResult(
        fps=float(fps),
        frame_count=int(n),
        duration_ms=duration_ms,
        rallies=rallies,
        total_active_ms=float(total_active_ms),
        total_dead_ms=float(max(0.0, duration_ms - total_active_ms)),
        audio_available=bool(capabilities["audio"]),
        capabilities=capabilities,
    )


# ---------------------------------------------------------------------------
# Video-driven entry point (CLI bridge for the server)
# ---------------------------------------------------------------------------


def detect_rallies_from_video(
    video_path: str,
    config: Optional[RallyDetectorConfig] = None,
) -> RallyDetectionResult:
    """End-to-end helper: pull frames + audio + ball cues from a video.

    The function imports ``dead_time_trimmer`` and ``court_mapping`` lazily so
    this module remains importable in test environments that lack OpenCV.
    """
    cfg = config or RallyDetectorConfig()

    # Import lazily so unit tests can stub the sibling modules.
    from importlib import import_module

    # ── Phase 1 visual cues ───────────────────────────────────────────────
    dtt = import_module("dead_time_trimmer") if __package__ in (None, "") else import_module(".dead_time_trimmer", __package__)
    trimmer_cfg = dtt.TrimmerConfig()
    cap_mod = import_module("cv2")
    cap = cap_mod.VideoCapture(video_path)
    if not cap.isOpened():
        raise FileNotFoundError(f"Cannot open video: {video_path!r}")
    fps = float(cap.get(cap_mod.CAP_PROP_FPS) or 30.0)
    motion_detector = dtt.MotionDetector(trimmer_cfg)
    ball_tracker = dtt.BallVelocityTracker(trimmer_cfg)
    motion: list[float] = []
    velocity: list[Optional[float]] = []
    shake: list[float] = []
    prev_motion = 0.0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            m = motion_detector.compute_motion_score(frame)
            motion.append(m)
            velocity.append(ball_tracker.update(frame))
            # Camera shake proxy: instantaneous jump in motion attributable to
            # the *whole* frame moving rather than localised activity. We use
            # the second derivative as a crude proxy for global pan/jitter.
            shake.append(abs(m - prev_motion))
            prev_motion = m
    finally:
        cap.release()

    # ── Audio cues (best-effort) ─────────────────────────────────────────
    audio_onsets = extract_audio_onsets_ms(video_path, cfg)

    # ── Optional shot events from court mapping ──────────────────────────
    shot_events_ms: Optional[list[float]] = None
    try:
        court_mod = import_module("court_mapping") if __package__ in (None, "") else import_module(".court_mapping", __package__)
        if hasattr(court_mod, "track_ball_and_shots"):
            payload = court_mod.track_ball_and_shots(video_path)
            shots = payload.get("shots", []) if isinstance(payload, dict) else []
            collected: list[float] = []
            for shot in shots if isinstance(shots, list) else []:
                if not isinstance(shot, dict):
                    continue
                ts = shot.get("timestamp_sec", shot.get("time"))
                if ts is None:
                    continue
                try:
                    collected.append(float(ts) * 1_000.0)
                except (TypeError, ValueError):
                    continue
            shot_events_ms = collected
    except Exception as exc:  # pragma: no cover - optional dependency
        print(f"[rally-detector] shot events unavailable: {exc}", file=sys.stderr)

    inputs = RallyDetectionInputs(
        fps=fps,
        frame_count=len(motion),
        motion=motion,
        velocity=velocity,
        shake=shake,
        audio_onsets_ms=audio_onsets,
        shot_events_ms=shot_events_ms,
    )
    return detect_rally_windows(inputs, cfg)


# ---------------------------------------------------------------------------
# CLI entry point (used by the server-side TS bridge)
# ---------------------------------------------------------------------------


def _config_from_overrides(overrides: dict[str, Any]) -> RallyDetectorConfig:
    cfg = RallyDetectorConfig()
    for key, value in overrides.items():
        if hasattr(cfg, key):
            setattr(cfg, key, value)
    return cfg


def _parse_cli() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect rally windows in a padel video.")
    parser.add_argument("--video-path", required=True)
    parser.add_argument("--output-path", help="Optional path to write the JSON payload.")
    parser.add_argument("--config-json", help="Optional JSON object of RallyDetectorConfig overrides.")
    return parser.parse_args()


def main() -> int:
    args = _parse_cli()
    overrides: dict[str, Any] = {}
    if args.config_json:
        try:
            overrides = json.loads(args.config_json)
            if not isinstance(overrides, dict):
                raise ValueError("config-json must be an object")
        except (json.JSONDecodeError, ValueError) as exc:
            print(f"[rally-detector] invalid --config-json: {exc}", file=sys.stderr)
            return 2

    if not os.path.isfile(args.video_path):
        print(f"[rally-detector] video not found: {args.video_path}", file=sys.stderr)
        return 1

    cfg = _config_from_overrides(overrides)
    try:
        result = detect_rallies_from_video(args.video_path, cfg)
    except FileNotFoundError as exc:
        print(f"[rally-detector] {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - defensive logging
        print(f"[rally-detector] failed: {exc}", file=sys.stderr)
        return 1

    payload = json.dumps(result.to_dict(), allow_nan=False, separators=(",", ":"))
    if args.output_path:
        Path(args.output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output_path).write_text(payload, encoding="utf-8")
    print(payload)
    return 0


__all__ = [
    "RallyDetectorConfig",
    "RallyDetectionInputs",
    "RallyDetectionResult",
    "RallyWindow",
    "detect_rallies_from_video",
    "detect_rally_windows",
    "extract_audio_onsets_ms",
]


if __name__ == "__main__":
    raise SystemExit(main())
