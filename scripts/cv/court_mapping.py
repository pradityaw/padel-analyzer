"""Court mapping and lightweight ball tracking for stationary padel video.

The module intentionally uses only OpenCV, NumPy, and standard library tools so
it can run in batch jobs without the client/server application. Court positions
are expressed on a bird's-eye grid where ``x`` spans the court width and ``y``
spans the court length. Defaults match a regulation padel court: 10m x 20m.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from typing import Any, Iterable, Sequence

import cv2
import numpy as np


Point = tuple[float, float]
LineSegment = tuple[float, float, float, float]


def _float(value: Any) -> float:
    """Return a native Python float for JSON serialization."""

    return float(value)


def _int(value: Any) -> int:
    """Return a native Python int for JSON serialization."""

    return int(value)


def _point(point: Sequence[float]) -> list[float]:
    return [_float(point[0]), _float(point[1])]


def _points(points: Iterable[Sequence[float]]) -> list[list[float]]:
    return [_point(point) for point in points]


def _matrix(matrix: np.ndarray | Sequence[Sequence[float]] | None) -> list[list[float]] | None:
    if matrix is None:
        return None
    array = np.asarray(matrix, dtype=np.float64)
    return [[_float(value) for value in row] for row in array.tolist()]


def _order_points(points: Sequence[Sequence[float]]) -> list[Point]:
    """Order four points as top-left, top-right, bottom-right, bottom-left."""

    if len(points) != 4:
        raise ValueError("Exactly four points are required")
    pts = np.asarray(points, dtype=np.float32)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)

    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return [(_float(x), _float(y)) for x, y in ordered]


@dataclass(slots=True)
class CourtMappingConfig:
    """Tunable parameters for court detection and lightweight tracking."""

    grid_width: float = 10.0
    grid_height: float = 20.0
    manual_court_points: list[Point] | None = None
    sample_frame_index: int = 0
    canny_threshold1: int = 50
    canny_threshold2: int = 150
    blur_kernel_size: int = 5
    hough_rho: float = 1.0
    hough_theta: float = math.pi / 180.0
    hough_threshold: int = 50
    hough_min_line_length: int = 60
    hough_max_line_gap: int = 12
    horizontal_angle_tolerance_deg: float = 15.0
    vertical_angle_tolerance_deg: float = 15.0
    min_court_area_ratio: float = 0.08
    background_history: int = 60
    background_var_threshold: float = 24.0
    ball_min_area: float = 6.0
    ball_max_area: float = 500.0
    ball_min_circularity: float = 0.35
    bright_threshold: int = 170
    max_association_distance_px: float = 80.0
    max_tracking_frames: int | None = None


@dataclass(slots=True)
class CourtLineDetection:
    """Detected line primitives and confidence for a video frame."""

    line_segments: list[LineSegment]
    detected_points: list[Point]
    intersection_points: list[Point]
    confidence: float
    frame_size: tuple[int, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "line_segments": [[_float(v) for v in line] for line in self.line_segments],
            "detected_points": _points(self.detected_points),
            "intersection_points": _points(self.intersection_points),
            "confidence": _float(self.confidence),
            "frame_size": [_int(self.frame_size[0]), _int(self.frame_size[1])],
        }


@dataclass(slots=True)
class CourtHomography:
    """Perspective transform between image pixels and bird's-eye court grid."""

    source_points: list[Point]
    destination_points: list[Point]
    homography_matrix: np.ndarray
    output_grid_size: tuple[float, float]
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "grid_width": _float(self.output_grid_size[0]),
            "grid_height": _float(self.output_grid_size[1]),
            "homography": _matrix(self.homography_matrix),
            "source_points": _points(self.source_points),
            "destination_points": _points(self.destination_points),
            "confidence": _float(self.confidence),
        }


@dataclass(slots=True)
class BallTrackPoint:
    """Single detected ball position in image and court coordinates."""

    frame_idx: int
    timestamp_sec: float
    image_x: float
    image_y: float
    court_x: float
    court_y: float
    confidence: float
    velocity_px_per_frame: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_idx": _int(self.frame_idx),
            "timestamp_sec": _float(self.timestamp_sec),
            "image_x": _float(self.image_x),
            "image_y": _float(self.image_y),
            "court_x": _float(self.court_x),
            "court_y": _float(self.court_y),
            "confidence": _float(self.confidence),
            "velocity_px_per_frame": (
                None if self.velocity_px_per_frame is None else _float(self.velocity_px_per_frame)
            ),
        }


@dataclass(slots=True)
class ShotEvent:
    """Heuristic event where the ball trajectory suggests a shot/contact."""

    event_id: int
    frame_idx: int
    timestamp_sec: float
    court_x: float
    court_y: float
    shot_type: str
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": _int(self.event_id),
            "frame_idx": _int(self.frame_idx),
            "timestamp_sec": _float(self.timestamp_sec),
            "court_x": _float(self.court_x),
            "court_y": _float(self.court_y),
            "shot_type": self.shot_type,
            "confidence": _float(self.confidence),
        }


class CourtMapper:
    """Detect court geometry and convert between image and court coordinates."""

    def __init__(
        self,
        video_path: str | None = None,
        frame: np.ndarray | None = None,
        config: CourtMappingConfig | None = None,
    ) -> None:
        self.video_path = video_path
        self.frame = frame
        self.config = config or CourtMappingConfig()
        self.line_detection: CourtLineDetection | None = None
        self.homography: CourtHomography | None = None

    def build_from_video(self, video_path: str | None = None) -> CourtHomography | None:
        """Read a representative frame from a video and build the homography."""

        path = video_path or self.video_path
        if path is None:
            raise ValueError("A video path is required")

        capture = cv2.VideoCapture(path)
        try:
            if hasattr(capture, "isOpened") and not capture.isOpened():
                if self.config.manual_court_points:
                    return self.build_from_points(self.config.manual_court_points)
                return None

            target_idx = max(0, self.config.sample_frame_index)
            frame: np.ndarray | None = None
            current_idx = 0
            while True:
                ok, candidate = capture.read()
                if not ok:
                    break
                frame = candidate
                if current_idx >= target_idx:
                    break
                current_idx += 1

            if frame is None:
                if self.config.manual_court_points:
                    return self.build_from_points(self.config.manual_court_points)
                return None
            return self.build_from_frame(frame)
        finally:
            capture.release()

    def build_from_frame(self, frame: np.ndarray | None = None) -> CourtHomography | None:
        """Detect court corners in a frame and compute image-to-court transform."""

        frame = frame if frame is not None else self.frame
        if self.config.manual_court_points:
            return self.build_from_points(self.config.manual_court_points)
        if frame is None:
            return None

        detection = self.detect_court_lines(frame)
        source_points = self.estimate_court_quadrilateral(frame, detection)
        if source_points is None:
            return None
        confidence = max(detection.confidence, 0.05)
        return self._build_homography(source_points, confidence)

    def build_from_points(self, source_points: Sequence[Sequence[float]]) -> CourtHomography:
        """Build a homography from manually supplied image-space court corners."""

        return self._build_homography(_order_points(source_points), confidence=1.0)

    def detect_court_lines(self, frame: np.ndarray) -> CourtLineDetection:
        """Detect likely court line segments with Canny edges and Hough lines."""

        height, width = frame.shape[:2]
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame.copy()
        kernel = self.config.blur_kernel_size
        if kernel > 1 and kernel % 2 == 1:
            gray = cv2.GaussianBlur(gray, (kernel, kernel), 0)
        edges = cv2.Canny(gray, self.config.canny_threshold1, self.config.canny_threshold2)
        raw_lines = cv2.HoughLinesP(
            edges,
            self.config.hough_rho,
            self.config.hough_theta,
            self.config.hough_threshold,
            minLineLength=self.config.hough_min_line_length,
            maxLineGap=self.config.hough_max_line_gap,
        )

        line_segments: list[LineSegment] = []
        horizontal: list[LineSegment] = []
        vertical: list[LineSegment] = []
        if raw_lines is not None:
            for line in raw_lines.reshape(-1, 4):
                x1, y1, x2, y2 = (_float(v) for v in line)
                if x1 == x2 and y1 == y2:
                    continue
                segment = (x1, y1, x2, y2)
                angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1)))
                if angle > 90.0:
                    angle = 180.0 - angle
                if angle <= self.config.horizontal_angle_tolerance_deg:
                    horizontal.append(segment)
                    line_segments.append(segment)
                elif angle >= 90.0 - self.config.vertical_angle_tolerance_deg:
                    vertical.append(segment)
                    line_segments.append(segment)

        intersections = self._line_intersections(horizontal, vertical, width, height)
        detected_points = self._candidate_corners_from_lines(line_segments, intersections, width, height)
        line_score = min(1.0, (len(horizontal) + len(vertical)) / 10.0)
        intersection_score = min(1.0, len(intersections) / 4.0)
        confidence = 0.65 * line_score + 0.35 * intersection_score

        detection = CourtLineDetection(
            line_segments=line_segments,
            detected_points=detected_points,
            intersection_points=intersections,
            confidence=_float(confidence),
            frame_size=(width, height),
        )
        self.line_detection = detection
        return detection

    def estimate_court_quadrilateral(
        self,
        frame: np.ndarray,
        detection: CourtLineDetection | None = None,
    ) -> list[Point] | None:
        """Estimate four image-space court corners from detected line primitives."""

        if self.config.manual_court_points:
            return _order_points(self.config.manual_court_points)

        detection = detection or self.detect_court_lines(frame)
        height, width = frame.shape[:2]
        candidates: list[Point] = []

        if len(detection.intersection_points) >= 4:
            candidates.extend(detection.intersection_points)
        for x1, y1, x2, y2 in detection.line_segments:
            candidates.append((x1, y1))
            candidates.append((x2, y2))

        if len(candidates) < 4:
            return None

        pts = np.asarray(candidates, dtype=np.float32)
        x_min, y_min = np.percentile(pts, 5, axis=0)
        x_max, y_max = np.percentile(pts, 95, axis=0)
        x_min = float(np.clip(x_min, 0, width - 1))
        x_max = float(np.clip(x_max, 0, width - 1))
        y_min = float(np.clip(y_min, 0, height - 1))
        y_max = float(np.clip(y_max, 0, height - 1))
        if x_max - x_min < 8 or y_max - y_min < 8:
            return None

        area_ratio = ((x_max - x_min) * (y_max - y_min)) / float(width * height)
        if area_ratio < self.config.min_court_area_ratio:
            return None

        corners = _order_points([(x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)])
        detection.detected_points[:] = corners
        return corners

    def image_to_court(self, point: Sequence[float]) -> Point:
        """Map an image pixel point to court grid coordinates."""

        if self.homography is None:
            raise ValueError("Homography has not been computed")
        mapped = self._perspective_transform(point, self.homography.homography_matrix)
        return (_float(mapped[0]), _float(mapped[1]))

    def court_to_image(self, point: Sequence[float]) -> Point:
        """Map a court grid point back to image pixel coordinates."""

        if self.homography is None:
            raise ValueError("Homography has not been computed")
        inverse = np.linalg.inv(self.homography.homography_matrix)
        mapped = self._perspective_transform(point, inverse)
        return (_float(mapped[0]), _float(mapped[1]))

    def _build_homography(self, source_points: Sequence[Sequence[float]], confidence: float) -> CourtHomography:
        ordered_source = _order_points(source_points)
        destination: list[Point] = [
            (0.0, 0.0),
            (_float(self.config.grid_width), 0.0),
            (_float(self.config.grid_width), _float(self.config.grid_height)),
            (0.0, _float(self.config.grid_height)),
        ]
        matrix = cv2.getPerspectiveTransform(
            np.asarray(ordered_source, dtype=np.float32),
            np.asarray(destination, dtype=np.float32),
        )
        homography = CourtHomography(
            source_points=ordered_source,
            destination_points=destination,
            homography_matrix=matrix,
            output_grid_size=(_float(self.config.grid_width), _float(self.config.grid_height)),
            confidence=_float(confidence),
        )
        self.homography = homography
        return homography

    @staticmethod
    def _perspective_transform(point: Sequence[float], matrix: np.ndarray) -> Point:
        src = np.asarray([[[point[0], point[1]]]], dtype=np.float32)
        dst = cv2.perspectiveTransform(src, matrix)[0, 0]
        return (_float(dst[0]), _float(dst[1]))

    @staticmethod
    def _line_intersections(
        horizontal: Sequence[LineSegment],
        vertical: Sequence[LineSegment],
        width: int,
        height: int,
    ) -> list[Point]:
        intersections: list[Point] = []
        for h_line in horizontal:
            for v_line in vertical:
                point = CourtMapper._line_intersection(h_line, v_line)
                if point is None:
                    continue
                x, y = point
                if -5 <= x <= width + 5 and -5 <= y <= height + 5:
                    intersections.append((_float(np.clip(x, 0, width - 1)), _float(np.clip(y, 0, height - 1))))
                if len(intersections) >= 200:
                    return intersections
        return intersections

    @staticmethod
    def _line_intersection(a: LineSegment, b: LineSegment) -> Point | None:
        x1, y1, x2, y2 = a
        x3, y3, x4, y4 = b
        denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(denom) < 1e-6:
            return None
        px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom
        py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom
        return (_float(px), _float(py))

    @staticmethod
    def _candidate_corners_from_lines(
        lines: Sequence[LineSegment],
        intersections: Sequence[Point],
        width: int,
        height: int,
    ) -> list[Point]:
        candidates: list[Point] = list(intersections)
        for x1, y1, x2, y2 in lines:
            candidates.append((x1, y1))
            candidates.append((x2, y2))
        if len(candidates) < 4:
            return []
        pts = np.asarray(candidates, dtype=np.float32)
        x_min, y_min = np.percentile(pts, 5, axis=0)
        x_max, y_max = np.percentile(pts, 95, axis=0)
        return _order_points(
            [
                (float(np.clip(x_min, 0, width - 1)), float(np.clip(y_min, 0, height - 1))),
                (float(np.clip(x_max, 0, width - 1)), float(np.clip(y_min, 0, height - 1))),
                (float(np.clip(x_max, 0, width - 1)), float(np.clip(y_max, 0, height - 1))),
                (float(np.clip(x_min, 0, width - 1)), float(np.clip(y_max, 0, height - 1))),
            ]
        )


class BallTracker:
    """Track bright, moving ball-like blobs with streaming frame processing."""

    def __init__(self, homography: CourtHomography | None, config: CourtMappingConfig | None = None) -> None:
        self.homography = homography
        self.config = config or CourtMappingConfig()

    def detect_candidates(
        self,
        frame: np.ndarray,
        foreground_mask: np.ndarray | None = None,
    ) -> list[tuple[float, float, float]]:
        """Return ball candidate centers as ``(x, y, confidence)`` tuples."""

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame.copy()
        _, bright = cv2.threshold(gray, self.config.bright_threshold, 255, cv2.THRESH_BINARY)
        if foreground_mask is not None:
            moving = cv2.threshold(foreground_mask, 127, 255, cv2.THRESH_BINARY)[1]
            mask = cv2.bitwise_and(bright, moving)
            if cv2.countNonZero(mask) == 0:
                mask = bright
        else:
            mask = bright

        mask = cv2.medianBlur(mask, 3)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates: list[tuple[float, float, float]] = []
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < self.config.ball_min_area or area > self.config.ball_max_area:
                continue
            perimeter = float(cv2.arcLength(contour, True))
            if perimeter <= 0:
                continue
            circularity = 4.0 * math.pi * area / (perimeter * perimeter)
            if circularity < self.config.ball_min_circularity:
                continue
            moments = cv2.moments(contour)
            if abs(moments["m00"]) < 1e-6:
                continue
            x = moments["m10"] / moments["m00"]
            y = moments["m01"] / moments["m00"]
            mean_brightness = float(cv2.mean(gray, mask=cv2.drawContours(np.zeros_like(gray), [contour], -1, 255, -1))[0])
            confidence = min(1.0, 0.45 + 0.35 * min(1.0, circularity) + 0.20 * (mean_brightness / 255.0))
            candidates.append((_float(x), _float(y), _float(confidence)))
        return sorted(candidates, key=lambda item: item[2], reverse=True)

    def track_video(self, video_path: str) -> tuple[list[BallTrackPoint], int]:
        """Stream a video and emit detected ball track points."""

        capture = cv2.VideoCapture(video_path)
        subtractor = cv2.createBackgroundSubtractorMOG2(
            history=self.config.background_history,
            varThreshold=self.config.background_var_threshold,
            detectShadows=False,
        )
        points: list[BallTrackPoint] = []
        last_center: Point | None = None
        last_frame_idx: int | None = None
        frames_processed = 0

        try:
            fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
            if fps <= 1e-6:
                fps = 30.0

            frame_idx = 0
            while True:
                if self.config.max_tracking_frames is not None and frames_processed >= self.config.max_tracking_frames:
                    break
                ok, frame = capture.read()
                if not ok:
                    break
                frames_processed += 1

                foreground = subtractor.apply(frame)
                candidates = self.detect_candidates(frame, foreground)
                selected = self._associate_candidate(candidates, last_center)
                if selected is not None:
                    image_x, image_y, confidence = selected
                    court_x, court_y = self._image_to_court((image_x, image_y))
                    velocity: float | None = None
                    if last_center is not None and last_frame_idx is not None:
                        delta_frames = max(1, frame_idx - last_frame_idx)
                        velocity = math.dist((image_x, image_y), last_center) / delta_frames
                    points.append(
                        BallTrackPoint(
                            frame_idx=_int(frame_idx),
                            timestamp_sec=_float(frame_idx / fps),
                            image_x=_float(image_x),
                            image_y=_float(image_y),
                            court_x=_float(court_x),
                            court_y=_float(court_y),
                            confidence=_float(confidence),
                            velocity_px_per_frame=None if velocity is None else _float(velocity),
                        )
                    )
                    last_center = (_float(image_x), _float(image_y))
                    last_frame_idx = frame_idx
                frame_idx += 1
        finally:
            capture.release()

        return points, frames_processed

    def _associate_candidate(
        self,
        candidates: Sequence[tuple[float, float, float]],
        last_center: Point | None,
    ) -> tuple[float, float, float] | None:
        if not candidates:
            return None
        if last_center is None:
            return candidates[0]
        nearby = [
            (math.dist((candidate[0], candidate[1]), last_center), candidate)
            for candidate in candidates
            if math.dist((candidate[0], candidate[1]), last_center) <= self.config.max_association_distance_px
        ]
        if nearby:
            return min(nearby, key=lambda item: item[0])[1]
        return candidates[0]

    def _image_to_court(self, point: Point) -> Point:
        if self.homography is None:
            return (_float(point[0]), _float(point[1]))
        return CourtMapper._perspective_transform(point, self.homography.homography_matrix)


class ShotPositionExtractor:
    """Extract simple shot/contact events from a ball trajectory."""

    def __init__(self, min_frame_gap: int = 3) -> None:
        self.min_frame_gap = min_frame_gap

    def extract(self, track_points: Sequence[BallTrackPoint]) -> list[ShotEvent]:
        """Detect events from direction reversals and local court-Y extrema."""

        if len(track_points) < 3:
            return []

        events: list[ShotEvent] = []
        last_event_frame = -10_000
        for idx in range(1, len(track_points) - 1):
            prev_point = track_points[idx - 1]
            point = track_points[idx]
            next_point = track_points[idx + 1]
            if point.frame_idx - last_event_frame < self.min_frame_gap:
                continue

            prev_vec = (point.court_x - prev_point.court_x, point.court_y - prev_point.court_y)
            next_vec = (next_point.court_x - point.court_x, next_point.court_y - point.court_y)
            prev_speed = math.hypot(*prev_vec)
            next_speed = math.hypot(*next_vec)
            if prev_speed < 1e-6 or next_speed < 1e-6:
                continue

            dot = prev_vec[0] * next_vec[0] + prev_vec[1] * next_vec[1]
            cosine = dot / (prev_speed * next_speed)
            y_reversal = (prev_vec[1] > 0 > next_vec[1]) or (prev_vec[1] < 0 < next_vec[1])
            speed_change = abs(next_speed - prev_speed) / max(prev_speed, next_speed)

            shot_type: str | None = None
            confidence = 0.0
            if cosine < -0.25:
                shot_type = "direction_change"
                confidence = min(0.95, 0.65 + 0.30 * abs(cosine))
            elif y_reversal:
                shot_type = "court_y_extremum"
                confidence = 0.7
            elif speed_change > 0.55:
                shot_type = "velocity_change"
                confidence = min(0.85, 0.55 + 0.30 * speed_change)

            if shot_type is None:
                continue

            events.append(
                ShotEvent(
                    event_id=len(events) + 1,
                    frame_idx=point.frame_idx,
                    timestamp_sec=point.timestamp_sec,
                    court_x=point.court_x,
                    court_y=point.court_y,
                    shot_type=shot_type,
                    confidence=_float(confidence),
                )
            )
            last_event_frame = point.frame_idx

        return events


def _empty_court(config: CourtMappingConfig) -> dict[str, Any]:
    return {
        "grid_width": _float(config.grid_width),
        "grid_height": _float(config.grid_height),
        "homography": None,
        "source_points": [],
        "destination_points": [],
        "confidence": 0.0,
    }


def build_court_homography(video_path: str, config: CourtMappingConfig | None = None) -> dict[str, Any]:
    """Build a JSON-serializable court homography payload for a video."""

    active_config = config or CourtMappingConfig()
    mapper = CourtMapper(video_path=video_path, config=active_config)
    homography = mapper.build_from_video(video_path)
    if homography is None:
        return _empty_court(active_config)
    return homography.to_dict()


def _court_homography_from_payload(payload: dict[str, Any]) -> CourtHomography | None:
    matrix = payload.get("homography")
    source = payload.get("source_points") or []
    destination = payload.get("destination_points") or []
    if matrix is None or len(source) != 4 or len(destination) != 4:
        return None
    return CourtHomography(
        source_points=[(float(x), float(y)) for x, y in source],
        destination_points=[(float(x), float(y)) for x, y in destination],
        homography_matrix=np.asarray(matrix, dtype=np.float64),
        output_grid_size=(float(payload["grid_width"]), float(payload["grid_height"])),
        confidence=float(payload.get("confidence", 0.0)),
    )


def track_ball_and_shots(video_path: str, config: CourtMappingConfig | None = None) -> dict[str, Any]:
    """Track the ball and extract shot events with JSON-serializable output."""

    active_config = config or CourtMappingConfig()
    court_payload = build_court_homography(video_path, active_config)
    homography = _court_homography_from_payload(court_payload)
    tracker = BallTracker(homography=homography, config=active_config)
    ball_points, frames_processed = tracker.track_video(video_path)
    shots = ShotPositionExtractor().extract(ball_points)

    return {
        "court": court_payload,
        "ball_track": [point.to_dict() for point in ball_points],
        "shots": [shot.to_dict() for shot in shots],
        "summary": {
            "frames_processed": _int(frames_processed),
            "track_points": _int(len(ball_points)),
            "shot_count": _int(len(shots)),
        },
    }


__all__ = [
    "BallTracker",
    "BallTrackPoint",
    "CourtHomography",
    "CourtLineDetection",
    "CourtMapper",
    "CourtMappingConfig",
    "ShotEvent",
    "ShotPositionExtractor",
    "build_court_homography",
    "track_ball_and_shots",
]
