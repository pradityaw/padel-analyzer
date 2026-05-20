from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np

from scripts.cv import run_pipeline as pipeline
from scripts.cv import run_agent_stage


def test_to_json_safe_converts_numpy_values():
    payload = {
        "score": np.float32(1.5),
        "items": np.asarray([1, 2, 3], dtype=np.int64),
        "bad": float("nan"),
    }

    safe = pipeline.to_json_safe(payload)

    assert safe == {"score": 1.5, "items": [1, 2, 3], "bad": None}


def test_run_pipeline_consolidates_rallies_and_optional_modules(monkeypatch, tmp_path: Path):
    video_path = tmp_path / "match.mp4"
    video_path.write_bytes(b"fake-video")

    monkeypatch.setattr(
        pipeline,
        "analyze_video",
        lambda _: {
            "rallies": [
                {
                    "rally_id": 1,
                    "start_sec": 0.0,
                    "end_sec": 2.0,
                    "duration_sec": 2.0,
                    "avg_ball_velocity": 12.0,
                }
            ],
            "total_active_sec": 2.0,
            "total_dead_sec": 3.0,
            "trim_ratio": 0.6,
        },
    )

    exported_paths: list[str] = []
    monkeypatch.setattr(
        pipeline,
        "export_condensed_video",
        lambda _video, _rallies, output_path: exported_paths.append(output_path),
    )

    court_module = SimpleNamespace(
        track_ball_and_shots=lambda _: {
            "court": {"homography": None},
            "ball_track": [
                {"timestamp_sec": 0.5, "velocity_px_per_frame": 18.0},
                {"timestamp_sec": 2.5, "velocity_px_per_frame": 99.0},
            ],
            "shots": [{"timestamp_sec": 1.0, "court_x": 3.0, "court_y": 4.0}],
            "summary": {"shot_count": 1},
        }
    )

    def fake_load(module_name: str):
        if module_name == "court_mapping":
            return court_module
        return None

    monkeypatch.setattr(pipeline, "_load_optional_module", fake_load)

    result = pipeline.run_pipeline(
        str(video_path),
        output_dir=str(tmp_path / "exports"),
        public_prefix="/uploads/cv",
    )

    assert exported_paths
    assert result["trimmed_video_url"] == "/uploads/cv/match_condensed.mp4"
    # ``capabilities`` is an open contract — we only assert on the keys we
    # rely on so newer signals (audio onsets, multi-signal rallies, …) can
    # be added without churning every consumer test.
    capabilities = result["capabilities"]
    assert capabilities["dead_time_trimming"] is True
    assert capabilities["court_mapping"] is True
    assert capabilities["player_tracking"] is False
    assert capabilities["player_tracking_available"] is False
    assert capabilities["scoring"] is False
    assert result["rallies"][0]["start"] == 0.0
    assert result["rallies"][0]["end"] == 2.0
    assert result["rallies"][0]["max_speed"] == 18.0
    assert result["rallies"][0]["shot_positions"] == [
        {"timestamp_sec": 1.0, "court_x": 3.0, "court_y": 4.0}
    ]
    assert result["rallies"][0]["player_heatmaps"] == []


def test_run_pipeline_skip_export_leaves_trimmed_url_null(monkeypatch, tmp_path: Path):
    video_path = tmp_path / "match.mp4"
    video_path.write_bytes(b"fake-video")
    monkeypatch.setattr(
        pipeline,
        "analyze_video",
        lambda _: {
            "rallies": [{"rally_id": 1, "start_sec": 0.0, "end_sec": 1.0, "duration_sec": 1.0}],
            "total_active_sec": 1.0,
            "total_dead_sec": 0.0,
            "trim_ratio": 0.0,
        },
    )
    monkeypatch.setattr(pipeline, "_load_optional_module", lambda _name: None)

    result = pipeline.run_pipeline(
        str(video_path),
        output_dir=str(tmp_path / "exports"),
        public_prefix="/uploads/cv",
        skip_export=True,
    )

    assert result["trimmed_video_url"] is None
    assert result["summary"]["rally_count"] == 1


def test_run_pipeline_includes_player_heatmaps_when_player_tracking_available(
    monkeypatch,
    tmp_path: Path,
):
    video_path = tmp_path / "match.mp4"
    video_path.write_bytes(b"fake-video")
    monkeypatch.setattr(
        pipeline,
        "analyze_video",
        lambda _: {
            "rallies": [{"rally_id": 1, "start_sec": 0.0, "end_sec": 1.0, "duration_sec": 1.0}],
            "total_active_sec": 1.0,
            "total_dead_sec": 0.0,
            "trim_ratio": 0.0,
        },
    )

    court_module = SimpleNamespace(
        track_ball_and_shots=lambda _: {
            "court": {
                "homography": [[0.1, 0.0, 0.0], [0.0, 0.1, 0.0], [0.0, 0.0, 1.0]]
            },
            "ball_track": [],
            "shots": [],
        }
    )
    player_module = SimpleNamespace(
        analyze_player_movement=lambda _video, _rallies, _court: {
            "player_heatmaps": [
                {
                    "player_id": 1,
                    "heatmap": [[1.0]],
                    "trajectory": [[2.0, 7.0, 0.0]],
                    "distance_m": 0.0,
                }
            ],
            "rallies": [
                {
                    "rally_id": 1,
                    "start_sec": 0.0,
                    "end_sec": 1.0,
                    "player_heatmaps": [{"player_id": 1, "heatmap": [[1.0]]}],
                }
            ],
        }
    )

    def fake_load(module_name: str):
        if module_name == "court_mapping":
            return court_module
        if module_name == "player_tracking":
            return player_module
        return None

    monkeypatch.setattr(pipeline, "_load_optional_module", fake_load)

    result = pipeline.run_pipeline(str(video_path), skip_export=True)

    assert result["capabilities"]["player_tracking"] is True
    assert result["rallies"][0]["player_heatmaps"] == [{"player_id": 1, "heatmap": [[1.0]]}]


def test_run_agent_stage_court_payload(monkeypatch):
    class CourtModule:
        @staticmethod
        def build_court_homography(_video_path: str):
            return {"homography": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "confidence": 0.8}

    monkeypatch.setitem(__import__("sys").modules, "court_mapping", CourtModule)

    result = run_agent_stage.run_court_agent("match.mp4")

    assert result["agent"] == "courtCalibration"
    assert result["summary"]["confidence"] == 0.8
    assert result["summary"]["has_homography"] is True


def test_run_agent_stage_ball_payload(monkeypatch):
    class CourtModule:
        @staticmethod
        def track_ball_and_shots(_video_path: str):
            return {
                "court": {"homography": None},
                "ball_track": [{"frame_idx": 1}],
                "shots": [{"event_id": 1}],
                "summary": {"frames_processed": 10, "track_points": 1, "shot_count": 1},
            }

    monkeypatch.setitem(__import__("sys").modules, "court_mapping", CourtModule)

    result = run_agent_stage.run_ball_agent("match.mp4")

    assert result["agent"] == "ballTrajectory"
    assert result["summary"] == {
        "frames_processed": 10,
        "track_points": 1,
        "shot_count": 1,
    }
