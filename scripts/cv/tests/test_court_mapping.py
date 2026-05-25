import json

import cv2
import numpy as np

from scripts.cv.court_mapping import (
    BallTrackPoint,
    BallTracker,
    CourtHomography,
    CourtMapper,
    CourtMappingConfig,
    ShotPositionExtractor,
    track_ball_and_shots,
)


def synthetic_court_frame(width: int = 640, height: int = 360) -> tuple[np.ndarray, list[tuple[float, float]]]:
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    corners = [(110.0, 45.0), (530.0, 45.0), (585.0, 315.0), (55.0, 315.0)]
    poly = np.asarray(corners, dtype=np.int32)
    cv2.polylines(frame, [poly], isClosed=True, color=(255, 255, 255), thickness=3)
    cv2.line(frame, (83, 180), (558, 180), (255, 255, 255), 2)
    cv2.line(frame, (320, 45), (320, 315), (255, 255, 255), 2)
    cv2.line(frame, (185, 45), (158, 315), (255, 255, 255), 2)
    cv2.line(frame, (455, 45), (482, 315), (255, 255, 255), 2)
    return frame, corners


def make_homography() -> CourtHomography:
    source = [(0.0, 0.0), (100.0, 0.0), (100.0, 200.0), (0.0, 200.0)]
    mapper = CourtMapper(config=CourtMappingConfig(manual_court_points=source))
    homography = mapper.build_from_points(source)
    assert homography is not None
    return homography


class FakeCapture:
    def __init__(self, frames: list[np.ndarray], fps: float = 30.0):
        self.frames = frames
        self.fps = fps
        self.idx = 0
        self.released = False

    def isOpened(self) -> bool:
        return True

    def read(self):
        if self.idx >= len(self.frames):
            return False, None
        frame = self.frames[self.idx]
        self.idx += 1
        return True, frame.copy()

    def get(self, prop_id):
        if prop_id == cv2.CAP_PROP_FPS:
            return self.fps
        return 0

    def release(self):
        self.released = True


def make_ball_frames(positions: list[tuple[int, int] | None], width: int = 120, height: int = 220) -> list[np.ndarray]:
    frames = []
    for position in positions:
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        if position is not None:
            cv2.circle(frame, position, 5, (255, 255, 255), -1)
        frames.append(frame)
    return frames


def assert_json_serializable(payload):
    json.dumps(payload, allow_nan=False)


def test_homography_maps_known_source_corners_to_destination_grid():
    source = [(100.0, 50.0), (500.0, 60.0), (540.0, 320.0), (80.0, 310.0)]
    mapper = CourtMapper(config=CourtMappingConfig(manual_court_points=source))
    homography = mapper.build_from_points(source)

    expected = [(0.0, 0.0), (10.0, 0.0), (10.0, 20.0), (0.0, 20.0)]
    for src, dst in zip(homography.source_points, expected):
        mapped = mapper.image_to_court(src)
        assert np.allclose(mapped, dst, atol=1e-4)


def test_image_to_court_and_court_to_image_round_trip():
    source = [(100.0, 50.0), (500.0, 60.0), (540.0, 320.0), (80.0, 310.0)]
    mapper = CourtMapper(config=CourtMappingConfig(manual_court_points=source))
    mapper.build_from_points(source)

    image_point = (310.0, 170.0)
    court_point = mapper.image_to_court(image_point)
    round_trip = mapper.court_to_image(court_point)

    assert np.allclose(round_trip, image_point, atol=1e-3)


def test_court_line_detection_on_synthetic_frame_returns_confidence_or_quad():
    frame, _ = synthetic_court_frame()
    config = CourtMappingConfig(hough_threshold=35, hough_min_line_length=40, min_court_area_ratio=0.03)
    mapper = CourtMapper(frame=frame, config=config)

    detection = mapper.detect_court_lines(frame)
    quad = mapper.estimate_court_quadrilateral(frame, detection)

    assert detection.confidence > 0 or quad is not None
    assert detection.line_segments


def test_ball_candidate_detection_finds_small_bright_circle():
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    cv2.circle(frame, (72, 48), 5, (255, 255, 255), -1)
    foreground = np.zeros((120, 160), dtype=np.uint8)
    cv2.circle(foreground, (72, 48), 7, 255, -1)
    tracker = BallTracker(homography=None)

    candidates = tracker.detect_candidates(frame, foreground)

    assert candidates
    x, y, confidence = candidates[0]
    assert abs(x - 72) <= 1
    assert abs(y - 48) <= 1
    assert confidence > 0


def test_ball_tracking_with_mocked_video_capture_emits_json_serializable_points(monkeypatch):
    frames = make_ball_frames([(20, 40), (28, 45), (36, 50)])
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: FakeCapture(frames))
    tracker = BallTracker(make_homography(), CourtMappingConfig(max_tracking_frames=3))

    points, frames_processed = tracker.track_video("mock.mp4")
    payload = [point.to_dict() for point in points]

    assert frames_processed == 3
    assert len(points) == 3
    assert points[1].velocity_px_per_frame is not None
    assert_json_serializable(payload)


def test_shot_extraction_detects_direction_change_event():
    trajectory = [
        BallTrackPoint(i, i / 30.0, float(i), 0.0, float(x), float(y), 0.9)
        for i, (x, y) in enumerate([(1, 2), (2, 5), (3, 8), (4, 5), (5, 2), (6, 1)])
    ]
    extractor = ShotPositionExtractor(min_frame_gap=1)

    shots = extractor.extract(trajectory)

    assert shots
    assert shots[0].shot_type in {"direction_change", "court_y_extremum"}
    assert_json_serializable([shot.to_dict() for shot in shots])


def test_track_ball_and_shots_returns_expected_schema_and_native_values(monkeypatch):
    frames = make_ball_frames([(20, 40), (30, 60), (40, 80), (50, 60), (60, 40)], width=120, height=220)
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: FakeCapture(frames))
    config = CourtMappingConfig(
        manual_court_points=[(0.0, 0.0), (120.0, 0.0), (120.0, 220.0), (0.0, 220.0)],
        max_tracking_frames=5,
    )

    payload = track_ball_and_shots("mock.mp4", config)

    assert set(payload.keys()) == {"court", "ball_track", "shots", "summary"}
    assert payload["court"]["grid_width"] == 10.0
    assert payload["court"]["grid_height"] == 20.0
    assert payload["court"]["homography"] is not None
    assert payload["summary"]["frames_processed"] == 5
    assert payload["summary"]["track_points"] == len(payload["ball_track"])
    assert isinstance(payload["summary"]["shot_count"], int)
    assert_json_serializable(payload)


def test_empty_video_returns_empty_tracking_schema(monkeypatch):
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: FakeCapture([]))

    payload = track_ball_and_shots("empty.mp4", CourtMappingConfig())

    assert payload["summary"] == {"frames_processed": 0, "track_points": 0, "shot_count": 0}
    assert payload["court"]["confidence"] == 0.0
    assert payload["ball_track"] == []
    assert payload["shots"] == []
    assert_json_serializable(payload)


def test_manual_override_points_work_when_line_detection_missing():
    frame = np.zeros((220, 120, 3), dtype=np.uint8)
    config = CourtMappingConfig(
        manual_court_points=[(0.0, 0.0), (120.0, 0.0), (120.0, 220.0), (0.0, 220.0)]
    )
    mapper = CourtMapper(frame=frame, config=config)

    homography = mapper.build_from_frame(frame)

    assert homography is not None
    assert homography.confidence == 1.0
    assert np.allclose(mapper.image_to_court((60.0, 110.0)), (5.0, 10.0), atol=1e-4)


def test_missed_ball_detections_are_skipped_without_hallucinated_points(monkeypatch):
    frames = make_ball_frames([(20, 40), None, (40, 60)])
    monkeypatch.setattr(cv2, "VideoCapture", lambda _: FakeCapture(frames))
    tracker = BallTracker(make_homography(), CourtMappingConfig(max_tracking_frames=3))

    points, frames_processed = tracker.track_video("mock.mp4")

    assert frames_processed == 3
    assert len(points) == 2
    assert [point.frame_idx for point in points] == [0, 2]
    assert_json_serializable([point.to_dict() for point in points])
