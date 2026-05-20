"""Heuristic match scoring from rally boundaries and ball tracking cues.

Consumes Phase 1 rally windows and optional Phase 2 ball/shot data to
produce point events and a running padel-style game score (points, games,
sets). This module is intentionally lightweight — no ML.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

PADEL_POINT_LABELS = (0, 15, 30, 40)


@dataclass
class ScoringConfig:
    """Tuneable scoring heuristics."""

    max_rally_gap_sec: float = 8.0
    min_rally_duration_sec: float = 0.4
    players_per_side: int = 2
    games_per_set: int = 6
    sets_to_win: int = 2


@dataclass
class PointEvent:
    point_id: int
    timestamp_sec: float
    winning_side: str
    rally_id: int
    rally_duration_sec: float
    shot_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "point_id": int(self.point_id),
            "timestamp_sec": float(self.timestamp_sec),
            "winning_side": self.winning_side,
            "rally_id": int(self.rally_id),
            "rally_duration_sec": float(self.rally_duration_sec),
            "shot_count": int(self.shot_count),
        }


@dataclass
class GameScore:
    side_a_points: int = 0
    side_b_points: int = 0
    side_a_games: int = 0
    side_b_games: int = 0
    set_scores: list[dict[str, int]] = field(default_factory=lambda: [{"side_a": 0, "side_b": 0}])

    def to_dict(self) -> dict[str, Any]:
        return {
            "side_a_points": int(self.side_a_points),
            "side_b_points": int(self.side_b_points),
            "side_a_games": int(self.side_a_games),
            "side_b_games": int(self.side_b_games),
            "set_scores": [
                {"side_a": int(s["side_a"]), "side_b": int(s["side_b"])} for s in self.set_scores
            ],
            "display": {
                "side_a": _format_side_score(self.side_a_points, self.side_a_games, self.set_scores),
                "side_b": _format_side_score(self.side_b_points, self.side_b_games, self.set_scores),
            },
        }


def _format_side_score(points: int, games: int, set_scores: list[dict[str, int]]) -> str:
    point_label = PADEL_POINT_LABELS[min(points, 3)] if points < 4 else "Game"
    current_set = set_scores[-1] if set_scores else {"side_a": 0, "side_b": 0}
    return f"{point_label} · {games} games · set {current_set['side_a']}-{current_set['side_b']}"


def _rally_start(rally: Mapping[str, Any]) -> float:
    return float(rally.get("start", rally.get("start_sec", 0.0)) or 0.0)


def _rally_end(rally: Mapping[str, Any]) -> float:
    return float(rally.get("end", rally.get("end_sec", 0.0)) or 0.0)


def _rally_id(rally: Mapping[str, Any], index: int) -> int:
    return int(rally.get("rally_id", index))


def _shots_in_rally(
    ball_tracking: Mapping[str, Any] | None,
    start: float,
    end: float,
) -> list[Mapping[str, Any]]:
    if not ball_tracking:
        return []
    shots = ball_tracking.get("shots", [])
    if not isinstance(shots, list):
        return []
    out: list[Mapping[str, Any]] = []
    for shot in shots:
        if not isinstance(shot, Mapping):
            continue
        ts = float(shot.get("timestamp_sec", shot.get("time", 0.0)) or 0.0)
        if start <= ts <= end:
            out.append(shot)
    return out


def _infer_winning_side(
    rally: Mapping[str, Any],
    shots: Sequence[Mapping[str, Any]],
    rally_index: int,
) -> str:
    """Infer which side won the rally from ball end position or alternation."""

    if shots:
        last = shots[-1]
        court_y = last.get("court_y")
        if court_y is not None:
            y = float(court_y)
            # Net is mid-court on a 20m length grid — far side vs near side heuristic.
            return "side_b" if y >= 10.0 else "side_a"
        direction = str(last.get("shot_type", ""))
        if "direction_change" in direction:
            return "side_b" if rally_index % 2 else "side_a"

    avg_motion = float(rally.get("avg_motion", rally.get("avg_ball_velocity", 0.0)) or 0.0)
    if avg_motion > 0:
        return "side_a" if rally_index % 2 == 0 else "side_b"
    return "side_a" if rally_index % 2 == 0 else "side_b"


def _advance_points(score: GameScore, winner: str, config: ScoringConfig) -> None:
    a_pts = score.side_a_points
    b_pts = score.side_b_points

    if winner == "side_a":
        a_pts += 1
    else:
        b_pts += 1

    # Deuce / advantage style: at 3-3 (40-40) need 2 clear points
    if a_pts >= 4 and b_pts >= 4:
        if abs(a_pts - b_pts) >= 2:
            _award_game(score, "side_a" if a_pts > b_pts else "side_b", config)
            return
        score.side_a_points = a_pts
        score.side_b_points = b_pts
        return

    if a_pts >= 4 and a_pts - b_pts >= 2:
        _award_game(score, "side_a", config)
        return
    if b_pts >= 4 and b_pts - a_pts >= 2:
        _award_game(score, "side_b", config)
        return

    score.side_a_points = min(a_pts, 3)
    score.side_b_points = min(b_pts, 3)


def _award_game(score: GameScore, winner: str, config: ScoringConfig) -> None:
    score.side_a_points = 0
    score.side_b_points = 0
    if winner == "side_a":
        score.side_a_games += 1
    else:
        score.side_b_games += 1

    current = score.set_scores[-1]
    if winner == "side_a":
        current["side_a"] += 1
    else:
        current["side_b"] += 1

    if (
        current["side_a"] >= config.games_per_set
        and current["side_a"] - current["side_b"] >= 2
    ) or (
        current["side_b"] >= config.games_per_set
        and current["side_b"] - current["side_a"] >= 2
    ):
        sets_won_a = sum(1 for s in score.set_scores if s["side_a"] > s["side_b"])
        sets_won_b = sum(1 for s in score.set_scores if s["side_b"] > s["side_a"])
        if sets_won_a < config.sets_to_win and sets_won_b < config.sets_to_win:
            score.set_scores.append({"side_a": 0, "side_b": 0})
        score.side_a_games = 0
        score.side_b_games = 0


class MatchScorer:
    """State machine: each completed rally resolves to a point event."""

    def __init__(self, config: ScoringConfig | None = None) -> None:
        self.config = config or ScoringConfig()
        self.state = "IDLE"
        self.score = GameScore()
        self.points: list[PointEvent] = []

    def process_rally(
        self,
        rally: Mapping[str, Any],
        rally_index: int,
        ball_tracking: Mapping[str, Any] | None = None,
    ) -> PointEvent | None:
        start = _rally_start(rally)
        end = _rally_end(rally)
        duration = max(0.0, end - start)
        if duration < self.config.min_rally_duration_sec:
            return None

        self.state = "RALLY"
        shots = _shots_in_rally(ball_tracking, start, end)
        winner = _infer_winning_side(rally, shots, rally_index)
        self.state = "POINT_RESOLVED"

        point = PointEvent(
            point_id=len(self.points) + 1,
            timestamp_sec=float(end),
            winning_side=winner,
            rally_id=_rally_id(rally, rally_index),
            rally_duration_sec=float(duration),
            shot_count=len(shots),
        )
        self.points.append(point)
        _advance_points(self.score, winner, self.config)
        self.state = "SERVING"
        return point

    def finalize(self) -> dict[str, Any]:
        self.state = "IDLE"
        return {
            "points": [p.to_dict() for p in self.points],
            "score": self.score.to_dict(),
        }


def score_match(
    rallies: Iterable[Any],
    ball_tracking: Mapping[str, Any] | None = None,
    config: ScoringConfig | None = None,
) -> dict[str, Any]:
    """Score a match from rally dicts and optional ball-tracking payload."""

    scorer = MatchScorer(config)
    rally_list = [r for r in rallies if isinstance(r, Mapping)]
    rally_list.sort(key=_rally_start)
    for index, rally in enumerate(rally_list, start=1):
        scorer.process_rally(rally, index, ball_tracking)
    return scorer.finalize()


__all__ = [
    "GameScore",
    "MatchScorer",
    "PointEvent",
    "ScoringConfig",
    "score_match",
]
