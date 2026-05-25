from __future__ import annotations

import json
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from scripts.cv.player_tracking import (
    PlayerDetector,
    PlayerMovementAnalyzer,
    PlayerObservation,
    PlayerTrack,
    PlayerTracker,
    PlayerTrackingConfig,
    analyze_player_movement,
    build_heatmap,
    compute_distance_meters,
)


class FakeCourtMapper:
    def __init__(self, scale: float = 0.1) -> None:
        self.scale = scale

    def image_to_court(self, point):
        return (float(point[0]) * self.scale, float(point[1]) * self.scale)


class FakeVideoCapture:
    def __init__(self, frames: list[np.ndarray], fps: float = 10.0) -> None:
        self.frames = frames
        self.fps = fps
        self.index = 0

    def isOpened(self) -> bool:
        return True

    def get(self, prop_id: int) -> float:
        if prop_id == cv2.CAP_PROP_FPS:
            return self.fps
        return 0.0

    def read(self):
        if self.index >= len(self.frames):
            return False, None
        frame = self.frames[self.index]
        self.index += 1
        return True, frame.copy()

    def release(self) -> None:
        pass


def _frame(width: int = 320, height: int = 240) -> np.ndarray:
    return np.zeros((height, width, 3), dtype=np.uint8)


def _obs(
    frame_idx: int,
    timestamp_sec: float,
    image_xy: tuple[float, float],
    court_xy: tuple[float, float] | None = None,
) -> PlayerObservation:
    return PlayerObservation(
        frame_idx=frame_idx,
        timestamp_sec=timestamp_sec,
        bbox=[int(image_xy[0]), int(image_xy[1]), 20, 60],
        centroid_image=[float(image_xy[0]), float(image_xy[1])],
        centroid_court_m=None if court_xy is None else [float(court_xy[0]), float(court_xy[1])],
        confidence=0.9,
    )


def test_player_detector_finds_bright_human_blobs_after_background_warmup():
    config = PlayerTrackingConfig(
        min_player_area_px=100,
        max_player_area_px=10_000,
        min_aspect_ratio=1.0,
        max_aspect_ratio=5.0,
        morph_kernel_size=3,
    )
    detector = PlayerDetector(config)
    background = _frame()
    for _ in range(5):
        detector.detect(background)

    frame = background.copy()
    cv2.rectangle(frame, (50, 50), (70, 130), (255, 255, 255), -1)
    cv2.rectangle(frame, (150, 60), (175, 145), (255, 255, 255), -1)

    boxes = detector.detect(frame)

    assert len(boxes) == 2
    assert all(h > w for _x, _y, w, h in boxes)


def test_player_tracker_keeps_id_for_drift_and_spawns_new_id_for_far_bbox():
    tracker = PlayerTracker(
        PlayerTrackingConfig(
            centroid_match_distance_px=40,
            iou_match_threshold=0.1,
            min_track_lifetime_frames=1,
        )
    )

    first = tracker.update([(10, 10, 20, 60)], frame_idx=0, timestamp_sec=0.0)
    drift = tracker.update([(14, 12, 20, 60)], frame_idx=1, timestamp_sec=0.1)
    far = tracker.update([(220, 120, 20, 60)], frame_idx=2, timestamp_sec=0.2)

    assert list(first) == [1]
    assert list(drift) == [1]
    assert list(far) == [2]
    assert sorted(tracker.active_tracks) == [1, 2]


def test_compute_distance_meters_uses_court_coordinates():
    track = PlayerTrack(
        player_id=1,
        observations=[
            _obs(0, 0.0, (0, 0), (0, 0)),
            _obs(1, 1.0, (30, 40), (3, 4)),
        ],
    )

    distance = compute_distance_meters(
        track,
        PlayerTrackingConfig(smoothing_window_frames=1, max_step_m=10.0),
    )

    assert distance == pytest.approx(5.0)


def test_compute_distance_rejects_teleport_steps():
    track = PlayerTrack(
        player_id=1,
        observations=[
            _obs(0, 0.0, (0, 0), (0, 0)),
            _obs(1, 0.1, (1000, 0), (100, 0)),
            _obs(2, 0.2, (10, 0), (1, 0)),
        ],
    )

    distance = compute_distance_meters(
        track,
        PlayerTrackingConfig(smoothing_window_frames=1, max_step_m=5.0),
    )

    assert distance == 0.0


def test_build_heatmap_returns_normalized_grid_with_trajectory_mass():
    config = PlayerTrackingConfig(
        heatmap_grid_cols=10,
        heatmap_grid_rows=20,
        heatmap_blur_sigma=0.0,
    )
    track = PlayerTrack(
        player_id=7,
        observations=[
            _obs(0, 0.0, (0, 0), (2.0, 4.0)),
            _obs(1, 0.1, (0, 0), (2.1, 4.2)),
            _obs(2, 0.2, (0, 0), (2.2, 4.4)),
        ],
    )

    heatmap = build_heatmap(track, config)

    assert heatmap.grid_cols == 10
    assert heatmap.grid_rows == 20
    assert len(heatmap.cells) == 20
    assert len(heatmap.cells[0]) == 10
    assert heatmap.sample_count == 3
    assert max(max(row) for row in heatmap.cells) == pytest.approx(1.0)
    assert sum(sum(row) for row in heatmap.raw_counts) == 3


def test_player_movement_analyzer_processes_only_rally_frames():
    frames = [_frame() for _ in range(5)]
    config = PlayerTrackingConfig(min_track_lifetime_frames=1, smoothing_window_frames=1)
    capture = FakeVideoCapture(frames, fps=10.0)

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture), patch(
        "scripts.cv.player_tracking.PlayerDetector.detect",
        return_value=[(10, 10, 20, 60)],
    ):
        result = PlayerMovementAnalyzer(
            "fake.mp4",
            rallies=[{"rally_id": 1, "start_sec": 0.1, "end_sec": 0.2}],
            court_mapper=FakeCourtMapper(scale=0.1),
            config=config,
        ).analyze()

    assert result["summary"]["frames_processed"] == 2
    assert result["summary"]["frames_skipped"] == 3
    assert len(result["tracks"]) == 1
    assert result["per_rally"][0]["rally_id"] == 1


def test_analyze_player_movement_returns_json_serializable_schema():
    frames = [_frame() for _ in range(3)]
    config = PlayerTrackingConfig(min_track_lifetime_frames=1, smoothing_window_frames=1)
    capture = FakeVideoCapture(frames, fps=10.0)

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture), patch(
        "scripts.cv.player_tracking.PlayerDetector.detect",
        return_value=[(10, 10, 20, 60)],
    ):
        result = analyze_player_movement(
            "fake.mp4",
            rallies=[{"rally_id": 1, "start_sec": 0.0, "end_sec": 0.2}],
            court_mapper=FakeCourtMapper(scale=0.1),
            config=config,
        )

    decoded = json.loads(json.dumps(result))

    assert set(decoded) == {"movement", "overlay", "player_heatmaps", "rallies"}
    assert decoded["movement"]["summary"]["frames_processed"] == 3
    assert decoded["overlay"]["court"]["width_m"] == 10.0
    assert decoded["player_heatmaps"]
    assert decoded["rallies"][0]["player_heatmaps"]


def test_empty_rally_list_returns_no_tracks_or_overlay_players():
    frames = [_frame() for _ in range(3)]
    capture = FakeVideoCapture(frames, fps=10.0)

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture):
        result = analyze_player_movement("fake.mp4", rallies=[])

    assert result["movement"]["tracks"] == []
    assert result["movement"]["per_rally"] == []
    assert result["overlay"]["players"] == []
    assert result["movement"]["summary"]["frames_skipped"] == 3


def test_court_mapper_none_keeps_court_centroid_none_and_uses_image_distance():
    frames = [_frame() for _ in range(3)]
    config = PlayerTrackingConfig(
        min_track_lifetime_frames=1,
        smoothing_window_frames=1,
        max_step_px=100.0,
    )
    capture = FakeVideoCapture(frames, fps=10.0)
    detections = [[(10, 10, 20, 60)], [(20, 10, 20, 60)], [(30, 10, 20, 60)]]

    def detect(_frame):
        return detections.pop(0)

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture), patch(
        "scripts.cv.player_tracking.PlayerDetector.detect",
        side_effect=detect,
    ):
        result = analyze_player_movement(
            "fake.mp4",
            rallies=[{"rally_id": 1, "start_sec": 0.0, "end_sec": 0.2}],
            court_mapper=None,
            config=config,
        )

    track = result["movement"]["tracks"][0]
    assert track["observations"][0]["centroid_court_m"] is None
    assert track["total_distance_m"] == pytest.approx(20.0)
    assert result["overlay"]["players"][0]["trajectory"][0][0] == pytest.approx(20.0)


def test_single_frame_rally_produces_zero_distance_track():
    frames = [_frame()]
    config = PlayerTrackingConfig(min_track_lifetime_frames=1, smoothing_window_frames=1)
    capture = FakeVideoCapture(frames, fps=10.0)

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture), patch(
        "scripts.cv.player_tracking.PlayerDetector.detect",
        return_value=[(10, 10, 20, 60)],
    ):
        result = analyze_player_movement(
            "fake.mp4",
            rallies=[{"rally_id": 1, "start_sec": 0.0, "end_sec": 0.0}],
            court_mapper=FakeCourtMapper(scale=0.1),
            config=config,
        )

    assert len(result["movement"]["tracks"]) == 1
    assert result["movement"]["tracks"][0]["total_distance_m"] == 0.0


def test_serialized_court_payload_maps_player_centroids_to_court_coords():
    frames = [_frame()]
    config = PlayerTrackingConfig(min_track_lifetime_frames=1)
    capture = FakeVideoCapture(frames, fps=10.0)
    court_payload = {
        "homography": [[0.1, 0.0, 0.0], [0.0, 0.1, 0.0], [0.0, 0.0, 1.0]]
    }

    with patch("scripts.cv.player_tracking.cv2.VideoCapture", return_value=capture), patch(
        "scripts.cv.player_tracking.PlayerDetector.detect",
        return_value=[(10, 10, 20, 60)],
    ):
        result = analyze_player_movement(
            "fake.mp4",
            rallies=[{"rally_id": 1, "start": 0.0, "end": 0.0}],
            court_mapper=court_payload,
            config=config,
        )

    centroid = result["movement"]["tracks"][0]["observations"][0]["centroid_court_m"]
    assert centroid == pytest.approx([2.0, 7.0])
