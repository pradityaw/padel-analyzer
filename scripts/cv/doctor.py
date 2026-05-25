"""Preflight checks for the server-side CV upload pipeline."""

from __future__ import annotations

import importlib.metadata
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT / "scripts"
CV_DIR = SCRIPTS_DIR / "cv"


def package_status(import_name: str, distribution_name: str | None = None) -> dict[str, object]:
    distribution = distribution_name or import_name
    found = importlib.util.find_spec(import_name) is not None
    version = None
    if found:
        try:
            version = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"
    return {"found": found, "version": version}


def command_status(command: str, *args: str) -> dict[str, object]:
    binary = shutil.which(command)
    if not binary:
        return {"found": False, "path": None, "version": None}
    try:
        completed = subprocess.run(
            [binary, *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
        output = (completed.stdout or completed.stderr).splitlines()
        version = output[0].strip() if output else None
    except Exception as exc:  # noqa: BLE001 - diagnostic tool should not crash.
        version = f"error: {exc}"
    return {"found": True, "path": binary, "version": version}


def file_status(path: Path) -> dict[str, object]:
    exists = path.exists()
    return {
        "path": str(path.relative_to(ROOT)),
        "exists": exists,
        "bytes": path.stat().st_size if exists else 0,
    }


def main() -> int:
    report = {
        "python": {
            "executable": sys.executable,
            "version": sys.version.split()[0],
        },
        "packages": {
            "mediapipe": package_status("mediapipe"),
            "opencv": package_status("cv2", "opencv-python-headless"),
            "numpy": package_status("numpy"),
            "scipy": package_status("scipy"),
            "onnxruntime": package_status("onnxruntime"),
        },
        "commands": {
            "ffmpeg": command_status("ffmpeg", "-version"),
            "yt-dlp": command_status("yt-dlp", "--version"),
        },
        "models": {
            "poseLandmarker": file_status(SCRIPTS_DIR / "pose_landmarker_full.task"),
            "tracknetV2": file_status(CV_DIR / "models" / "tracknet-v2.onnx"),
        },
    }

    print(json.dumps(report, indent=2))

    required = [
        report["packages"]["mediapipe"]["found"],
        report["packages"]["opencv"]["found"],
        report["packages"]["numpy"]["found"],
        report["packages"]["scipy"]["found"],
        report["commands"]["ffmpeg"]["found"],
        report["commands"]["yt-dlp"]["found"],
        report["models"]["poseLandmarker"]["exists"],
    ]
    return 0 if all(required) else 1


if __name__ == "__main__":
    raise SystemExit(main())
