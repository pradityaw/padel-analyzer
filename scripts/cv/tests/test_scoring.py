from __future__ import annotations

import pytest

from scripts.cv.scoring import ScoringConfig, score_match


def test_score_match_emits_point_per_rally():
    rallies = [
        {"rally_id": 1, "start_sec": 0.0, "end_sec": 2.0, "duration_sec": 2.0},
        {"rally_id": 2, "start_sec": 5.0, "end_sec": 8.0, "duration_sec": 3.0},
    ]
    result = score_match(rallies)

    assert len(result["points"]) == 2
    assert result["points"][0]["point_id"] == 1
    assert result["points"][0]["winning_side"] in ("side_a", "side_b")
    assert "display" in result["score"]


def test_short_rallies_are_skipped():
    rallies = [{"rally_id": 1, "start_sec": 0.0, "end_sec": 0.1, "duration_sec": 0.1}]
    result = score_match(rallies, config=ScoringConfig(min_rally_duration_sec=0.5))
    assert result["points"] == []


def test_ball_end_court_y_influences_winner():
    rallies = [{"rally_id": 1, "start": 0.0, "end": 2.0}]
    ball_tracking = {
        "shots": [
            {"timestamp_sec": 1.5, "court_y": 15.0, "shot_type": "direction_change"},
        ]
    }
    result = score_match(rallies, ball_tracking)
    assert result["points"][0]["winning_side"] == "side_b"


def test_game_advances_after_four_clear_points():
    rallies = [
        {"rally_id": i, "start_sec": float(i * 3), "end_sec": float(i * 3 + 2)}
        for i in range(1, 5)
    ]
    result = score_match(rallies)
    assert len(result["points"]) == 4
    assert result["score"]["side_a_points"] <= 3
    assert result["score"]["side_b_points"] <= 3
