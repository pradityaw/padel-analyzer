from __future__ import annotations

import os
from pathlib import Path

import pytest

from scripts.cv import video_source


def test_is_remote_video_uri() -> None:
    assert video_source.is_remote_video_uri("https://bucket.example/object.mp4")
    assert not video_source.is_remote_video_uri("/tmp/local.mp4")


def test_open_video_source_local(tmp_path: Path) -> None:
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake")
    with video_source.open_video_source(str(video)) as resolved:
        assert resolved == str(video)


def test_open_video_source_missing_local() -> None:
    with pytest.raises(FileNotFoundError):
        with video_source.open_video_source("/tmp/does-not-exist-padel-video.mp4"):
            pass


def test_open_video_source_remote_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        headers = {"Content-Length": "999999999"}

        def read(self, _size: int) -> bytes:
            return b""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    monkeypatch.setenv("PADEL_VIDEO_MAX_BYTES", "16")
    monkeypatch.setattr(
        "scripts.cv.video_source.urlopen",
        lambda *_args, **_kwargs: FakeResponse(),
    )

    with pytest.raises(RuntimeError, match="download limit"):
        with video_source.open_video_source("https://example.invalid/video.mp4"):
            pass
