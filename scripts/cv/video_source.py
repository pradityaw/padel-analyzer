"""Resolve local paths or remote URIs into a readable video source for OpenCV/ffmpeg."""

from __future__ import annotations

from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import tempfile
from typing import Iterator
from urllib.parse import urlparse
from urllib.request import Request, urlopen

DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_CHUNK_BYTES = 1024 * 1024


def is_remote_video_uri(source: str) -> bool:
    parsed = urlparse(source)
    return parsed.scheme in {"http", "https"}


def _max_download_bytes() -> int:
    raw = os.environ.get("PADEL_VIDEO_MAX_BYTES", "").strip()
    if not raw:
        return DEFAULT_MAX_BYTES
    try:
        return max(1, int(raw))
    except ValueError:
        return DEFAULT_MAX_BYTES


def _stream_remote_to_temp(source: str) -> str:
    max_bytes = _max_download_bytes()
    request = Request(source, headers={"User-Agent": "padel-analyzer/1.0"})
    with urlopen(request, timeout=120) as response:
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = None
            if declared is not None and declared > max_bytes:
                raise RuntimeError(
                    f"Remote video exceeds the {max_bytes} byte download limit."
                )

        suffix = Path(urlparse(source).path).suffix or ".mp4"
        temp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        temp_path = temp.name
        downloaded = 0
        try:
            while True:
                chunk = response.read(DEFAULT_CHUNK_BYTES)
                if not chunk:
                    break
                downloaded += len(chunk)
                if downloaded > max_bytes:
                    raise RuntimeError(
                        f"Remote video exceeded the {max_bytes} byte download limit."
                    )
                temp.write(chunk)
        except Exception:
            temp.close()
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise
        else:
            temp.close()
            if downloaded <= 0:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                raise RuntimeError("Remote video download was empty.")
            return temp_path


@contextmanager
def open_video_source(source: str) -> Iterator[str]:
    """Yield a path or URI suitable for ``cv2.VideoCapture`` / ffmpeg.

    Local filesystem paths are returned as-is. Remote HTTPS URIs are streamed
    into a bounded temporary file that is removed on context exit.
    """
    if not source or not str(source).strip():
        raise FileNotFoundError("Video source is empty.")

    normalized = str(source).strip()
    if is_remote_video_uri(normalized):
        temp_path = _stream_remote_to_temp(normalized)
        try:
            yield temp_path
        finally:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
        return

    if os.path.isfile(normalized):
        yield normalized
        return

    raise FileNotFoundError(f"Video file does not exist: {normalized}")
