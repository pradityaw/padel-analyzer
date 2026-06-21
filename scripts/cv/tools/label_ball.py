#!/usr/bin/env python3
"""Local click-annotator for padel ball ground-truth labels.

Run with the project venv so OpenCV (cv2) is available, e.g.::

    .venv/bin/python3 scripts/cv/tools/label_ball.py extract <clip.mp4> <outdir>
    .venv/bin/python3 scripts/cv/tools/label_ball.py serve <outdir>

Two subcommands:

``extract <clip.mp4> <outdir> [--max-frames N] [--quality 90]``
    Decode the clip with OpenCV and write full-resolution JPEGs to
    ``<outdir>/frames/000000.jpg ...`` plus ``<outdir>/manifest.json``. Frames
    are 0-based and indexed exactly like the eval detectors
    (``_iter_bgr_frames`` in ``scripts/cv/eval_ball_tracking.py``), so a label
    for frame *i* lines up with detector frame *i*.

``serve <outdir> [--port 8765]``
    Serve a single-page click-annotator at ``http://127.0.0.1:<port>`` (loopback
    only — no upload, license-safe for the YouTube-derived clips). Click the
    ball to record ``(x, y)`` in source pixels; press ``n`` for a not-visible
    frame, ``d`` to clear. Labels autosave to a sibling ``<clip-stem>.json``
    next to the source clip (and a copy at ``<outdir>/labels.json``) in the
    schema expected by both ``scripts/cv/eval_ball_tracking.py`` and
    ``scripts/cv/tests/test_ball_eval.py``::

        {"video": "<clip filename>", "fps": 30,
         "frames": [{"frame": 0, "x": 320.5, "y": 120.0, "visible": true},
                    {"frame": 1, "visible": false}]}

Note: TrackNet needs a 3-frame sliding window, so it only emits detections from
frame index 2 onward — frames 0 and 1 are unavoidable false negatives for it.
Aim for ~15-25% not-visible frames so precision isn't degenerate.
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


# --------------------------------------------------------------------------- #
# Frame extraction                                                            #
# --------------------------------------------------------------------------- #

def extract(clip: Path, outdir: Path, max_frames: int | None, quality: int) -> int:
    import cv2  # imported lazily so `serve` doesn't require OpenCV

    clip = clip.expanduser().resolve()
    if not clip.is_file():
        raise SystemExit(f"clip not found: {clip}")

    outdir = outdir.expanduser().resolve()
    frames_dir = outdir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(clip))
    if not cap.isOpened():
        raise SystemExit(f"could not open clip: {clip}")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    files: list[dict] = []
    frame_index = 0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        name = f"{frame_index:06d}.jpg"
        cv2.imwrite(
            str(frames_dir / name),
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)],
        )
        files.append({"frame": frame_index, "file": f"frames/{name}"})
        frame_index += 1
        if max_frames and frame_index >= max_frames:
            break
    cap.release()

    manifest = {
        "clip": str(clip),
        "clip_name": clip.name,
        "fps": fps,
        "width": width,
        "height": height,
        "frame_count": len(files),
        "frames": files,
    }
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")

    print(f"extracted {len(files)} frames ({width}x{height}@{fps:.3f}fps) -> {frames_dir}")
    print(f"manifest -> {outdir / 'manifest.json'}")
    print(f"next: .venv/bin/python3 {Path(__file__).name} serve {outdir}")
    return 0


# --------------------------------------------------------------------------- #
# Annotator server                                                            #
# --------------------------------------------------------------------------- #

PAGE_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Padel ball labeler</title>
<style>
  html, body { margin: 0; background: #111; color: #eee; font: 14px/1.4 -apple-system, system-ui, sans-serif; }
  #bar { position: sticky; top: 0; background: #1c1c1c; padding: 8px 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #333; z-index: 5; }
  #bar button { background: #2a2a2a; color: #eee; border: 1px solid #444; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
  #bar button:hover { background: #3a3a3a; }
  #bar .meta { opacity: .8; }
  #status { margin-left: auto; opacity: .85; }
  #stage { display: flex; justify-content: center; padding: 16px; }
  #wrap { position: relative; line-height: 0; }
  #frameimg { max-width: 90vw; max-height: 78vh; display: block; border: 1px solid #333; cursor: crosshair; }
  #marker { position: absolute; width: 18px; height: 18px; border: 2px solid #ff3b30; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 0 2px rgba(0,0,0,.5); pointer-events: none; display: none; }
  #marker::after { content: ''; position: absolute; inset: -10px; border: 1px dashed rgba(255,255,255,.4); border-radius: 50%; }
  #novis { position: absolute; top: 10px; left: 10px; background: rgba(0,0,0,.7); color: #ff9; padding: 4px 10px; border-radius: 4px; font-size: 13px; display: none; }
  #help { max-width: 900px; margin: 0 auto; padding: 6px 16px 40px; opacity: .6; font-size: 12px; }
  code { background: #2a2a2a; padding: 1px 5px; border-radius: 3px; }
</style>
</head>
<body>
<div id="bar">
  <button id="prev">&larr; prev</button>
  <button id="next">next &rarr;</button>
  <button id="notvis" title="n">not-visible (n)</button>
  <button id="clear" title="d">clear (d)</button>
  <button id="jump">jump to unlabeled (j)</button>
  <span class="meta" id="idx"></span>
  <span class="meta" id="prog"></span>
  <span id="status"></span>
</div>
<div id="stage">
  <div id="wrap">
    <img id="frameimg" alt="">
    <div id="marker"></div>
    <div id="novis">NOT VISIBLE</div>
  </div>
</div>
<div id="help">
  Click the ball center to record a visible frame (source-pixel coords). Keys:
  <code>&larr;/&rarr;</code> or <code>space</code> prev/next &middot;
  <code>n</code> mark not-visible &middot; <code>d</code> clear frame &middot;
  <code>j</code> jump to next unlabeled &middot;
  <code>1/2</code> back/forward 10. Labels autosave to the clip's sibling <code>&lt;stem&gt;.json</code>.
  TrackNet only detects from frame 2 onward.
</div>

<script>
const img = document.getElementById('frameimg');
const marker = document.getElementById('marker');
const novis = document.getElementById('novis');
const idxEl = document.getElementById('idx');
const progEl = document.getElementById('prog');
const statusEl = document.getElementById('status');

let manifest = null;          // {frames:[{frame,file}], fps, width, height, ...}
let labels = new Map();       // frameIndex -> {x, y, visible}
let i = 0;
let saveTimer = null;

async function init() {
  manifest = await (await fetch('/manifest.json')).json();
  try {
    const saved = await (await fetch('/labels.json')).json();
    if (saved && Array.isArray(saved.frames)) {
      for (const f of saved.frames) labels.set(f.frame, {x: f.x, y: f.y, visible: f.visible !== false});
    }
  } catch (e) { /* no labels yet */ }
  // resume at first unlabeled frame after the last labeled one
  let start = 0;
  if (labels.size) start = Math.min(manifest.frame_count - 1, Math.max(...labels.keys()) + 1);
  goto(start);
  img.addEventListener('click', onClick);
  document.getElementById('prev').addEventListener('click', () => goto(i - 1));
  document.getElementById('next').addEventListener('click', () => goto(i + 1));
  document.getElementById('notvis').addEventListener('click', () => { markNotVisible(); goto(i + 1); });
  document.getElementById('clear').addEventListener('click', () => { labels.delete(i); render(); save(); });
  document.getElementById('jump').addEventListener('click', jumpUnlabeled);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', render);
}

function goto(n) {
  if (!manifest) return;
  i = Math.max(0, Math.min(manifest.frame_count - 1, n));
  const entry = manifest.frames[i];
  img.src = '/' + entry.file + '?t=' + entry.frame;  // cache-bust per frame
  render();
}

function render() {
  idxEl.textContent = `frame ${i + 1} / ${manifest.frame_count}  (idx ${i})`;
  const labeled = labels.size;
  let vis = 0;
  for (const v of labels.values()) if (v.visible) vis++;
  progEl.textContent = `labeled ${labeled} | visible ${vis} | not-visible ${labeled - vis}`;
  const cur = labels.get(i);
  if (cur && cur.visible && typeof cur.x === 'number') {
    marker.style.left = (cur.x / manifest.width * 100) + '%';
    marker.style.top = (cur.y / manifest.height * 100) + '%';
    marker.style.display = 'block';
    novis.style.display = 'none';
  } else {
    marker.style.display = 'none';
    novis.style.display = (cur && !cur.visible) ? 'block' : 'none';
  }
}

function onClick(e) {
  const rect = img.getBoundingClientRect();
  if (rect.width === 0) return;
  const x = (e.clientX - rect.left) / rect.width * manifest.width;
  const y = (e.clientY - rect.top) / rect.height * manifest.height;
  labels.set(i, {x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, visible: true});
  render();
  save();
  goto(i + 1);
}

function markNotVisible() {
  labels.set(i, {x: null, y: null, visible: false});
  render();
  save();
}

function jumpUnlabeled() {
  for (let k = 1; k <= manifest.frame_count; k++) {
    const n = (i + k) % manifest.frame_count;
    if (!labels.has(n)) { goto(n); return; }
  }
}

function onKey(e) {
  if (e.target.tagName === 'INPUT') return;
  switch (e.key) {
    case 'ArrowRight': case ' ': goto(i + 1); e.preventDefault(); break;
    case 'ArrowLeft':  goto(i - 1); break;
    case 'n': case 'N': markNotVisible(); goto(i + 1); break;
    case 'd': case 'D': case 'Delete': labels.delete(i); render(); save(); break;
    case 'j': case 'J': jumpUnlabeled(); break;
    case '1': goto(i - 10); break;
    case '2': goto(i + 10); break;
  }
}

function save() {
  statusEl.textContent = 'saving...';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const frames = [...labels.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([frame, v]) => v.visible
        ? {frame, x: v.x, y: v.y, visible: true}
        : {frame, visible: false});
    fetch('/save', {method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({frames})})
      .then(r => r.json())
      .then(d => { statusEl.textContent = d.ok ? `saved ${d.labeled} (vis ${d.visible})` : 'save failed'; })
      .catch(() => { statusEl.textContent = 'save error'; });
  }, 300);
}

init();
</script>
</body>
</html>
"""


STARTUP_BANNER = """
╭──────────────────────────────────────────────────────────────╮
│  Padel ball labeler — open this URL in your browser:         │
│                                                              │
│      {url}                                            │
│                                                              │
│  clip:   {clip}  ({count} frames)
│  labels: {label}  │
╰──────────────────────────────────────────────────────────────╯
  Click the ball to label a visible frame. Keys: arrows/space = move,
  n = not-visible, d = clear, j = jump to unlabeled. Ctrl-C to stop.
"""


def serve(outdir: Path, port: int) -> int:
    outdir = outdir.resolve()
    manifest_path = outdir / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"no manifest.json in {outdir} — run `extract` first")
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))

    clip_path = Path(manifest["clip"])
    label_sibling = clip_path.with_suffix(".json")  # <stem>.json next to <stem>.mp4
    working_copy = outdir / "labels.json"

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes = b"", ctype: str = "application/json") -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body:
                self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            path = urlparse(self.path).path
            if path == "/":
                self._send(200, PAGE_HTML.encode("utf8"), "text/html; charset=utf-8")
            elif path == "/manifest.json":
                self._send(200, manifest_path.read_bytes())
            elif path == "/labels.json":
                data = None
                if label_sibling.exists():
                    data = label_sibling.read_bytes()
                elif working_copy.exists():
                    data = working_copy.read_bytes()
                if data is None:
                    self._send(200, b'{"frames":[]}')
                else:
                    self._send(200, data)
            elif path.startswith("/frames/"):
                f = (outdir / path.lstrip("/")).resolve()
                if f.is_file() and str(f).startswith(str(outdir)):
                    self._send(200, f.read_bytes(), "image/jpeg")
                else:
                    self._send(404, b"not found")
            else:
                self._send(404, b"not found")

        def do_POST(self) -> None:  # noqa: N802 - http.server API
            if urlparse(self.path).path != "/save":
                self._send(404, b"not found")
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw.decode("utf8")) if raw.strip() else {}
            except Exception as exc:  # malformed JSON
                self._send(400, json.dumps({"ok": False, "error": str(exc)}).encode())
                return
            frames = payload.get("frames", []) if isinstance(payload, dict) else []
            frames = sorted(
                (f for f in frames if isinstance(f, dict) and isinstance(f.get("frame"), int)),
                key=lambda f: f["frame"],
            )
            doc = {"video": clip_path.name, "fps": manifest.get("fps"), "frames": frames}
            text = json.dumps(doc, indent=2)
            try:
                label_sibling.parent.mkdir(parents=True, exist_ok=True)
                label_sibling.write_text(text, encoding="utf8")
                working_copy.write_text(text, encoding="utf8")
            except Exception as exc:
                self._send(500, json.dumps({"ok": False, "error": str(exc)}).encode())
                return
            vis = sum(1 for f in frames if f.get("visible", True))
            body = json.dumps(
                {
                    "ok": True,
                    "path": str(label_sibling),
                    "labeled": len(frames),
                    "visible": vis,
                    "not_visible": len(frames) - vis,
                }
            )
            self._send(200, body.encode())

        def log_message(self, format: str, *args: object) -> None:  # silence default request logging
            del format, args  # intentionally quiet

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(
        STARTUP_BANNER.format(
            url=url,
            clip=clip_path.name,
            count=manifest["frame_count"],
            label=label_sibling,
        )
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping labeler.")
        httpd.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Local padel ball click-annotator.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    pe = sub.add_parser("extract", help="Decode a clip to full-res JPEGs + manifest.json.")
    pe.add_argument("clip", type=Path)
    pe.add_argument("outdir", type=Path)
    pe.add_argument("--max-frames", type=int, default=None)
    pe.add_argument("--quality", type=int, default=92)

    ps = sub.add_parser("serve", help="Serve the click-annotator for an extracted outdir.")
    ps.add_argument("outdir", type=Path)
    ps.add_argument("--port", type=int, default=8765)

    args = parser.parse_args()
    if args.cmd == "extract":
        return extract(args.clip, args.outdir, args.max_frames, args.quality)
    if args.cmd == "serve":
        return serve(args.outdir, args.port)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
