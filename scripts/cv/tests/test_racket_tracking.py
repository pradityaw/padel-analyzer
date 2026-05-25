from __future__ import annotations

import json

import numpy as np
import pytest

from scripts.cv.racket_tracking import (
    INTERPOLATED_CONFIDENCE,
    LOW_VISIBILITY_CONFIDENCE,
    LandmarkPoint,
    RacketAnchor,
    RacketHeadTracker,
    RacketSample,
    RacketTrackingConfig,
    build_anchors_from_frame_landmarks,
    extrapolate_racket_head,
    track_racket_heads_from_landmarks,
    track_racket_heads_in_video,
)


# ---------------------------------------------------------------------------
# Fakes (no opencv VideoCapture required)
# ---------------------------------------------------------------------------


class FakeVideoCapture:
    """Mimic the parts of ``cv2.VideoCapture`` the tracker actually uses."""

    def __init__(
        self,
        frames: list[np.ndarray] | None = None,
        *,
        opened: bool = True,
        width: int | None = None,
        height: int | None = None,
    ) -> None:
        self.frames = frames or []
        self._opened = opened
        self._index = 0
        if frames:
            inferred_h, inferred_w = frames[0].shape[:2]
        else:
            inferred_h, inferred_w = 0, 0
        self._width = inferred_w if width is None else int(width)
        self._height = inferred_h if height is None else int(height)

    def isOpened(self) -> bool:
        return self._opened

    def get(self, prop_id: int) -> float:
        import cv2

        if prop_id == cv2.CAP_PROP_FRAME_WIDTH:
            return float(self._width)
        if prop_id == cv2.CAP_PROP_FRAME_HEIGHT:
            return float(self._height)
        return 0.0

    def read(self):
        if self._index >= len(self.frames):
            return False, None
        frame = self.frames[self._index]
        self._index += 1
        return True, frame.copy()

    def release(self) -> None:
        self._opened = False


def _capture_factory(captures: list[FakeVideoCapture]):
    iterator = iter(captures)

    def factory(_path):
        try:
            return next(iterator)
        except StopIteration:
            return FakeVideoCapture(opened=False)

    return factory


def _static_frame(width: int = 200, height: int = 120) -> np.ndarray:
    return np.zeros((height, width, 3), dtype=np.uint8)


def _frame_with_moving_blob(
    width: int,
    height: int,
    centre: tuple[int, int],
    *,
    radius: int = 8,
    brightness: int = 255,
) -> np.ndarray:
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    cx, cy = centre
    x0 = max(0, cx - radius)
    x1 = min(width, cx + radius + 1)
    y0 = max(0, cy - radius)
    y1 = min(height, cy + radius + 1)
    frame[y0:y1, x0:x1] = brightness
    return frame


# ---------------------------------------------------------------------------
# Pure math
# ---------------------------------------------------------------------------


def test_extrapolation_projects_along_forearm_axis():
    wrist = LandmarkPoint(x=100.0, y=100.0, visibility=0.9)
    elbow = LandmarkPoint(x=80.0, y=100.0, visibility=0.9)

    rx, ry = extrapolate_racket_head(wrist, elbow, k=1.2)

    # racket head = wrist + 1.2 * (wrist - elbow) = (100, 100) + (24, 0)
    assert rx == pytest.approx(124.0)
    assert ry == pytest.approx(100.0)


def test_extrapolation_handles_zero_forearm_without_dividing():
    wrist = LandmarkPoint(x=50.0, y=50.0, visibility=0.9)
    elbow = LandmarkPoint(x=50.0, y=50.0, visibility=0.9)

    rx, ry = extrapolate_racket_head(wrist, elbow, k=1.5)

    assert rx == pytest.approx(50.0)
    assert ry == pytest.approx(50.0)


# ---------------------------------------------------------------------------
# Single-frame tracker
# ---------------------------------------------------------------------------


def _anchor(frame_idx: int = 0, *, wrist_x: float, wrist_y: float, elbow_x: float, elbow_y: float, vis: float = 0.9) -> RacketAnchor:
    return RacketAnchor(
        frame_idx=frame_idx,
        player_id=1,
        timestamp_sec=float(frame_idx) / 30.0,
        wrist=LandmarkPoint(x=wrist_x, y=wrist_y, visibility=vis),
        elbow=LandmarkPoint(x=elbow_x, y=elbow_y, visibility=vis),
    )


def test_track_falls_back_to_extrapolation_without_motion_mask():
    config = RacketTrackingConfig(extrapolation_k=1.2)
    tracker = RacketHeadTracker(config)
    anchor = _anchor(wrist_x=120, wrist_y=80, elbow_x=100, elbow_y=80)

    from scripts.cv.racket_tracking import _FrameContext  # type: ignore[attr-defined]

    sample = tracker.track(
        anchor, _FrameContext(width=200, height=120, motion_mask=None)
    )

    assert sample.interpolated is True
    assert sample.confidence == pytest.approx(INTERPOLATED_CONFIDENCE)
    assert sample.x == pytest.approx(120 + 1.2 * 20)
    assert sample.y == pytest.approx(80.0)


def test_track_low_visibility_returns_low_confidence_clamped_sample():
    config = RacketTrackingConfig(extrapolation_k=1.5, min_landmark_visibility=0.6)
    tracker = RacketHeadTracker(config)
    anchor = _anchor(
        wrist_x=20, wrist_y=10, elbow_x=0, elbow_y=10, vis=0.2
    )

    from scripts.cv.racket_tracking import _FrameContext  # type: ignore[attr-defined]

    sample = tracker.track(
        anchor, _FrameContext(width=40, height=30, motion_mask=None)
    )

    assert sample.interpolated is True
    assert sample.confidence == pytest.approx(LOW_VISIBILITY_CONFIDENCE)
    # racket head would be (50, 10) — clamped to (width-1=39, 10)
    assert sample.x == pytest.approx(39.0)
    assert sample.y == pytest.approx(10.0)


def test_track_refines_position_when_motion_mask_overlaps_search_window():
    config = RacketTrackingConfig(
        extrapolation_k=1.0,
        min_motion_pixels=4,
        min_search_radius_px=8,
        max_search_radius_px=64,
        motion_threshold=10,
    )
    tracker = RacketHeadTracker(config)
    anchor = _anchor(wrist_x=100, wrist_y=80, elbow_x=70, elbow_y=80)
    # The wrist+1*(wrist-elbow) projection lands at (130, 80) so put a
    # blob of moving pixels slightly to the right to test the refinement.
    motion = np.zeros((120, 200), dtype=np.uint8)
    motion[75:86, 132:143] = 255

    from scripts.cv.racket_tracking import _FrameContext  # type: ignore[attr-defined]

    sample = tracker.track(
        anchor, _FrameContext(width=200, height=120, motion_mask=motion)
    )

    assert sample.interpolated is False
    assert sample.confidence >= config.refined_confidence_floor
    assert 132.0 <= sample.x <= 143.0
    assert 75.0 <= sample.y <= 86.0


# ---------------------------------------------------------------------------
# Video-stream orchestration
# ---------------------------------------------------------------------------


def test_track_in_video_with_static_frames_yields_extrapolated_samples():
    anchors = [
        _anchor(frame_idx=0, wrist_x=50, wrist_y=40, elbow_x=30, elbow_y=40),
        _anchor(frame_idx=1, wrist_x=52, wrist_y=40, elbow_x=32, elbow_y=40),
    ]
    capture = FakeVideoCapture([_static_frame(), _static_frame()])

    samples = track_racket_heads_in_video(
        "fake.mp4",
        anchors,
        capture_factory=_capture_factory([capture]),
    )

    assert [s.frame_idx for s in samples] == [0, 1]
    assert all(s.interpolated for s in samples)
    assert samples[0].x == pytest.approx(50 + 1.2 * 20)


def test_track_in_video_refines_when_blob_moves_inside_search_window():
    config = RacketTrackingConfig(
        extrapolation_k=1.0,
        min_search_radius_px=10,
        max_search_radius_px=64,
        motion_threshold=20,
        min_motion_pixels=8,
    )

    # Frame 0 has a bright blob at (130, 80); frame 1 shifts it to (140,
    # 80). The frame-difference mask should light up around the new
    # blob position, so the refined sample at frame 1 should be pulled
    # towards that.
    width, height = 200, 120
    frame0 = _frame_with_moving_blob(width, height, (130, 80))
    frame1 = _frame_with_moving_blob(width, height, (142, 80))

    anchor0 = _anchor(frame_idx=0, wrist_x=100, wrist_y=80, elbow_x=70, elbow_y=80)
    anchor1 = _anchor(frame_idx=1, wrist_x=100, wrist_y=80, elbow_x=70, elbow_y=80)

    capture = FakeVideoCapture([frame0, frame1])
    samples = track_racket_heads_in_video(
        "fake.mp4",
        [anchor0, anchor1],
        config=config,
        capture_factory=_capture_factory([capture]),
    )

    by_frame = {s.frame_idx: s for s in samples}
    # Frame 0 has no previous frame, so the tracker can't refine.
    assert by_frame[0].interpolated is True
    # Frame 1 sees the motion mask and refines towards the blob.
    assert by_frame[1].interpolated is False
    assert by_frame[1].x > by_frame[0].x


def test_track_in_video_clamps_to_frame_bounds_for_off_screen_extension():
    config = RacketTrackingConfig(extrapolation_k=5.0)  # huge extrapolation
    anchor = _anchor(frame_idx=0, wrist_x=180, wrist_y=80, elbow_x=160, elbow_y=80)
    capture = FakeVideoCapture([_static_frame(200, 120)])

    samples = track_racket_heads_in_video(
        "fake.mp4",
        [anchor],
        config=config,
        capture_factory=_capture_factory([capture]),
    )

    assert samples[0].x == pytest.approx(199.0)  # clamped to width-1
    assert samples[0].interpolated is True


def test_track_in_video_no_capture_falls_back_to_pure_extrapolation():
    anchors = [
        _anchor(frame_idx=0, wrist_x=10, wrist_y=10, elbow_x=0, elbow_y=10),
    ]
    samples = track_racket_heads_in_video(
        "fake.mp4",
        anchors,
        capture_factory=_capture_factory([FakeVideoCapture(opened=False)]),
    )

    assert len(samples) == 1
    assert samples[0].interpolated is True
    assert samples[0].x == pytest.approx(10 + 1.2 * 10)


# ---------------------------------------------------------------------------
# MediaPipe-payload adapter
# ---------------------------------------------------------------------------


def _make_landmarks_payload(num_frames: int) -> list[dict]:
    """Build a minimal MediaPipe-style landmarks payload (right-handed)."""

    out: list[dict] = []
    for i in range(num_frames):
        landmarks = [
            {"x": 0.0, "y": 0.0, "z": 0.0, "visibility": 0.0}
            for _ in range(17)
        ]
        # Right elbow (14) and right wrist (16).
        landmarks[14] = {"x": 0.4, "y": 0.5, "z": 0.0, "visibility": 0.95}
        landmarks[16] = {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.95}
        out.append(
            {
                "frameIndex": i,
                "timestamp": i * 33.0,  # milliseconds
                "landmarks": landmarks,
            }
        )
    return out


def test_build_anchors_from_frame_landmarks_projects_normalised_to_pixels():
    payload = _make_landmarks_payload(2)

    anchors = build_anchors_from_frame_landmarks(
        payload,
        dominant_side="right",
        player_id=2,
        video_width=200,
        video_height=120,
    )

    assert len(anchors) == 2
    first = anchors[0]
    assert first.player_id == 2
    assert first.frame_idx == 0
    assert first.timestamp_sec == pytest.approx(0.0)
    assert first.wrist.x == pytest.approx(100.0)
    assert first.wrist.y == pytest.approx(60.0)
    assert first.elbow.x == pytest.approx(80.0)
    assert first.elbow.y == pytest.approx(60.0)


def test_track_racket_heads_from_landmarks_returns_jsonable_payload():
    payload = _make_landmarks_payload(2)
    capture = FakeVideoCapture(
        frames=[_static_frame(200, 120), _static_frame(200, 120)],
        width=200,
        height=120,
    )
    dim_probe = FakeVideoCapture(opened=True, width=200, height=120)

    result = track_racket_heads_from_landmarks(
        "fake.mp4",
        payload,
        dominant_side="right",
        player_id=3,
        capture_factory=_capture_factory([dim_probe, capture]),
    )

    decoded = json.loads(json.dumps(result))

    assert set(decoded) == {"players", "summary"}
    assert decoded["players"][0]["player_id"] == 3
    assert decoded["players"][0]["dominant_side"] == "right"
    assert len(decoded["players"][0]["samples"]) == 2
    assert decoded["summary"]["sample_count"] == 2
    assert decoded["summary"]["video_width"] == 200
    assert decoded["summary"]["video_height"] == 120


def test_empty_anchor_list_returns_empty_sample_list():
    samples = track_racket_heads_in_video("fake.mp4", [], capture_factory=_capture_factory([]))
    assert samples == []


def test_track_in_video_marks_samples_with_distinct_confidence_band():
    """Refined samples sit at ≥0.5 confidence; interpolated stay <0.5."""

    config = RacketTrackingConfig(
        extrapolation_k=1.0,
        min_search_radius_px=8,
        motion_threshold=10,
        min_motion_pixels=4,
    )
    width, height = 200, 120
    static = _frame_with_moving_blob(width, height, (130, 80))
    moved = _frame_with_moving_blob(width, height, (140, 80))
    capture = FakeVideoCapture([static, moved])

    anchors = [
        _anchor(frame_idx=0, wrist_x=100, wrist_y=80, elbow_x=70, elbow_y=80),
        _anchor(frame_idx=1, wrist_x=100, wrist_y=80, elbow_x=70, elbow_y=80),
    ]
    samples = track_racket_heads_in_video(
        "fake.mp4",
        anchors,
        config=config,
        capture_factory=_capture_factory([capture]),
    )

    by_frame = {s.frame_idx: s for s in samples}
    assert by_frame[0].confidence < 0.5
    assert by_frame[1].confidence >= 0.5
    # Wire-format tuple has 5 entries
    tup = by_frame[1].to_tuple()
    assert len(tup) == 5
    assert tup[0] == 1  # frame_idx
    assert tup[1] == 1  # player_id


def test_sample_to_tuple_preserves_frame_player_xy_confidence():
    sample = RacketSample(
        frame_idx=42,
        player_id=7,
        timestamp_sec=1.4,
        x=320.5,
        y=144.25,
        confidence=0.81,
        interpolated=False,
    )
    assert sample.to_tuple() == (42, 7, 320.5, 144.25, 0.81)
