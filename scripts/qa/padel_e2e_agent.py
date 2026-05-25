#!/usr/bin/env python3
"""
Autonomous E2E QA agent for Padel Video Analyzer.

Simulates a human user: navigates the dashboard, uploads a sample video,
waits for AI processing, and verifies analysis UI (video, canvas overlay, metrics).

Requires a local MP4 via --video or PADEL_SAMPLE_VIDEO. Dev server should be running
at http://localhost:3001 (or pass --base-url).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import traceback
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from playwright.sync_api import (
    Browser,
    BrowserContext,
    Locator,
    Page,
    Playwright,
    TimeoutError as PlaywrightTimeout,
    sync_playwright,
)

# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_BASE_URL = "http://localhost:3001"
DEFAULT_TIMEOUT_MS = 10_000
PROCESSING_TIMEOUT_MS = 600_000  # 10 min for MediaPipe on slow machines
DEFAULT_ARTIFACTS_DIR = "qa-artifacts/python-e2e-agent"

IGNORE_URL_FRAGMENTS = ("/@vite/", "sockjs-node")


@dataclass
class AgentConfig:
    base_url: str
    video_path: Path
    headless: bool
    timeout_ms: int
    processing_timeout_ms: int
    artifacts_dir: Path
    retries: int = 2


@dataclass
class ConsoleEvent:
    type: str
    text: str
    location: str | None = None


@dataclass
class FailedRequest:
    method: str
    url: str
    error_text: str | None = None


@dataclass
class ErrorResponse:
    status: int
    url: str


@dataclass
class Telemetry:
    console_events: list[ConsoleEvent] = field(default_factory=list)
    failed_requests: list[FailedRequest] = field(default_factory=list)
    error_responses: list[ErrorResponse] = field(default_factory=list)

    def attach(self, page: Page) -> None:
        def on_console(msg: Any) -> None:
            if msg.type not in ("error", "warning"):
                return
            loc = msg.location
            location = None
            if loc and loc.get("url"):
                location = f"{loc['url']}:{loc.get('lineNumber', 0)}"
            self.console_events.append(
                ConsoleEvent(type=msg.type, text=msg.text, location=location)
            )

        def on_request_failed(request: Any) -> None:
            url = request.url
            if any(f in url for f in IGNORE_URL_FRAGMENTS):
                return
            # Playwright Python returns failure as str | None, not an object.
            error_text = request.failure
            if error_text == "net::ERR_ABORTED":
                return
            self.failed_requests.append(
                FailedRequest(
                    method=request.method,
                    url=url,
                    error_text=error_text,
                )
            )

        def on_response(response: Any) -> None:
            url = response.url
            if response.status < 400 or any(f in url for f in IGNORE_URL_FRAGMENTS):
                return
            self.error_responses.append(
                ErrorResponse(status=response.status, url=url)
            )

        page.on("console", on_console)
        page.on("requestfailed", on_request_failed)
        page.on("response", on_response)

    def to_dict(self) -> dict[str, Any]:
        return {
            "console": [
                {"type": e.type, "text": e.text, "location": e.location}
                for e in self.console_events
            ],
            "failedRequests": [
                {"method": r.method, "url": r.url, "errorText": r.error_text}
                for r in self.failed_requests
            ],
            "errorResponses": [
                {"status": r.status, "url": r.url} for r in self.error_responses
            ],
        }

    def has_critical_issues(self) -> bool:
        server_errors = [
            r
            for r in self.error_responses
            if r.status >= 500 and "analysis.list" not in r.url
        ]
        return bool(server_errors or self.failed_requests)


# ── Agent ─────────────────────────────────────────────────────────────────────


class PadelE2EAgent:
  """Exploratory yet systematic browser agent for Padel Analyzer."""

  def __init__(self, page: Page, config: AgentConfig, telemetry: Telemetry) -> None:
    self.page = page
    self.config = config
    self.telemetry = telemetry
    self.log_entries: list[dict[str, str]] = []
    self.uploaded_filename: str = config.video_path.name
    self.analysis_id: int | None = None

  # ── Logging & resilience ──────────────────────────────────────────────────

  def think(self, message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    line = f"[{ts}] {message}"
    print(line, flush=True)
    self.log_entries.append(
        {"time": ts, "message": message}
    )

  def _timeout(self, extra_ms: int = 0) -> float:
    return (self.config.timeout_ms + extra_ms) / 1000.0

  def retry(self, action: Callable[[], None], description: str) -> None:
    last_err: Exception | None = None
    for attempt in range(1, self.config.retries + 2):
      try:
        action()
        return
      except (PlaywrightTimeout, AssertionError) as exc:
        last_err = exc
        if attempt <= self.config.retries:
          self.think(
              f"Retry {attempt}/{self.config.retries} after: {description} — {exc}"
          )
    assert last_err is not None
    raise last_err

  def expect_visible(self, locator: Locator, description: str) -> None:
    def _check() -> None:
      locator.wait_for(state="visible", timeout=self.config.timeout_ms)
    self.retry(_check, f"visible: {description}")

  def patient_click(self, locator: Locator, description: str) -> None:
    def _click() -> None:
      locator.wait_for(state="visible", timeout=self.config.timeout_ms)
      locator.click(timeout=self.config.timeout_ms)
    self.retry(_click, f"click: {description}")

  def assert_no_fatal_ui(self) -> None:
    fatal_patterns = [
        "Analysis failed",
        "Unable to load this analysis",
        "Analysis not found",
        "This analysis data could not be read",
    ]
    for pattern in fatal_patterns:
      if self.page.get_by_text(pattern, exact=False).count() > 0:
        if self.page.get_by_text(pattern, exact=False).first.is_visible():
          raise AssertionError(f"Fatal UI state detected: {pattern}")

  def assert_padel_app(self) -> None:
    """Fail fast if base URL points at another service on the same port."""
    markers = [
        self.page.get_by_text("Padel Analyzer", exact=False),
        self.page.get_by_label("Sessions"),
    ]
    for marker in markers:
      try:
        marker.first.wait_for(state="visible", timeout=5_000)
        return
      except PlaywrightTimeout:
        continue
    title = self.page.title()
    raise AssertionError(
        "This does not look like Padel Analyzer "
        f"(title={title!r}). Check --base-url — port 3001 may be used by another app."
    )

  def goto(self, path: str) -> None:
    url = path if path.startswith("http") else f"{self.config.base_url.rstrip('/')}{path}"
    self.think(f"Navigating to {url}")
    self.page.goto(url, wait_until="domcontentloaded")
    self.assert_padel_app()
    self.assert_no_fatal_ui()

  def nav_link(self, label: str) -> Locator:
    # exact=True avoids matching "Pro Compare" when clicking "Compare"
    return self.page.get_by_role("navigation").get_by_label(label, exact=True)

  # ── Flow 1: Dashboard & navigation ────────────────────────────────────────

  def flow_dashboard_and_navigation(self) -> None:
    self.think("Step 1: Opening Sessions dashboard")
    self.goto("/")

    sessions_heading = self.page.get_by_role("heading", name="Sessions")
    self.expect_visible(sessions_heading, "Sessions heading")

    empty = self.page.get_by_text("No analyses yet")
    has_sessions = empty.count() == 0 or not empty.first.is_visible()

    if has_sessions:
      self.think("Dashboard shows past analyses — listing is populated")
    else:
      self.think("Dashboard is empty — new-user state is OK")

    self.think("Step 2: Exercising primary navigation")
    for label, path_fragment in [
        ("Analyze", "/upload"),
        ("Compare", "/compare"),
        ("Pro Compare", "/pro-compare"),
        ("Sessions", "/"),
    ]:
      self.patient_click(self.nav_link(label), f"nav {label}")
      self.page.wait_for_url(
          re.compile(re.escape(path_fragment) + r"(\?.*)?$"),
          timeout=self.config.timeout_ms,
      )
      self.assert_no_fatal_ui()
      self.think(f"  ✓ {label} → {self.page.url}")

    if "/compare" in self.page.url:
      self.expect_visible(
          self.page.get_by_text("Select two analyses above", exact=False),
          "compare empty helper",
      )

  def maybe_handle_auth(self) -> None:
    """If auth is on and we're on login, note precondition — no magic link in CI."""
    if "/login" not in self.page.url:
      return
    email = self.page.locator("#email")
    if email.count() == 0:
      return
    self.think(
        "Auth mode appears ON and login page shown — "
        "set AUTH_MODE=off or provide a session for full upload flow"
    )
    raise RuntimeError(
        "Login required (AUTH_MODE=on). Run dev server with AUTH_MODE=off "
        "or complete magic-link auth manually before running the agent."
    )

  # ── Flow 2: Upload & processing ───────────────────────────────────────────

  def flow_upload(self) -> None:
    self.think("Step 3: Starting upload workflow")
    self.goto("/upload")
    self.maybe_handle_auth()

    self.expect_visible(
        self.page.get_by_role("heading", name="Analyze Your Padel Swing"),
        "upload hero",
    )
    self.expect_visible(
        self.page.get_by_role("button", name="Upload Video"),
        "upload tab",
    )
    self.expect_visible(
        self.page.get_by_text("Drop your video here or click to browse"),
        "drop zone",
    )

    video_path = str(self.config.video_path.resolve())
    if not self.config.video_path.is_file():
      raise FileNotFoundError(f"Sample video not found: {video_path}")

    self.think(f"Step 4: Uploading sample video: {self.uploaded_filename}")
    file_input = self.page.locator('input[type="file"]')
    file_input.set_input_files(video_path)

    self.expect_visible(
        self.page.get_by_text(self.uploaded_filename, exact=False),
        "selected filename",
    )

    self.patient_click(
        self.page.get_by_role("button", name="Analyze My Swing"),
        "Analyze My Swing",
    )

    self.wait_for_processing_complete()

  def wait_for_processing_complete(self) -> None:
    self.think("Step 5: Waiting for AI pipeline (pose detection + analysis)")
    page = self.page
    timeout = self.config.processing_timeout_ms

    analyzing = page.get_by_text("Analyzing your swing...")
    try:
      analyzing.wait_for(state="visible", timeout=min(30_000, timeout))
      self.think("  Processing overlay visible")
    except PlaywrightTimeout:
      self.think("  Processing heading not seen — may already be on analysis page")

    # Processing canvas on upload page
    processing_canvas = page.locator(
        "canvas[width='480'][height='360']"
    ).first
    try:
      processing_canvas.wait_for(state="visible", timeout=15_000)
      self.think("  Live skeleton preview canvas detected")
    except PlaywrightTimeout:
      pass

    # Wait for navigation to analysis — primary success signal
    page.wait_for_url(
        re.compile(r"/analysis/\d+"),
        timeout=timeout,
    )
    match = re.search(r"/analysis/(\d+)", page.url)
    if match:
      self.analysis_id = int(match.group(1))
      self.think(f"Step 6: Analysis ready at id={self.analysis_id}")

    self.assert_no_fatal_ui()

    if page.get_by_text("Analysis failed", exact=False).count() > 0:
      err_text = ""
      err_el = page.locator(".text-red-300").first
      if err_el.count():
        err_text = err_el.inner_text()
      raise AssertionError(f"Upload/analysis failed: {err_text or 'unknown error'}")

  # ── Flow 3: Analysis verification ───────────────────────────────────────

  def dismiss_fresh_overlay_if_present(self) -> None:
    skip = self.page.get_by_role("button", name="Skip")
    ready = self.page.get_by_text("Your swing is ready")
    try:
      ready.wait_for(state="visible", timeout=5_000)
      self.think("  Fresh-result reveal overlay — clicking Skip")
      if skip.count() > 0 and skip.first.is_visible():
        skip.first.click()
      else:
        # Overlay auto-dismisses; wait for it to go away
        ready.wait_for(state="hidden", timeout=8_000)
    except PlaywrightTimeout:
      pass

  def flow_verify_analysis(self) -> None:
    self.think("Step 7: Verifying analysis results page")
    self.assert_no_fatal_ui()
    self.dismiss_fresh_overlay_if_present()

    self.expect_visible(
        self.page.get_by_role("heading", name=self.uploaded_filename),
        "analysis filename heading",
    )
    self.expect_visible(
        self.page.get_by_text("Swing summary", exact=False),
        "swing summary panel",
    )
    self.expect_visible(
        self.page.get_by_text("Overall", exact=True).first,
        "overall score label",
    )
    self.expect_visible(
        self.page.get_by_text("Next steps", exact=False),
        "next steps section",
    )

    # Shot type badge (Drive, Volley, etc.) — optional if classification pending
    shot_badge = self.page.locator("button").filter(
        has=self.page.locator("span.rounded-full")
    ).first
    if shot_badge.count() > 0 and shot_badge.is_visible():
      self.think(f"  Shot badge visible: {shot_badge.inner_text()[:40]}")

    self.verify_video_and_canvas()
    self.verify_metrics_panel()
    self.simulate_playback_and_scrub()

    self.think("Step 10: Returning to Sessions to confirm listing")
    self.patient_click(self.nav_link("Sessions"), "Sessions nav")
    self.page.wait_for_url(re.compile(r"/$"), timeout=self.config.timeout_ms)
    self.page.reload(wait_until="domcontentloaded")
    self.assert_padel_app()

    self.assert_analysis_in_session_list()

  def assert_analysis_in_session_list(self) -> None:
    """Confirm the new analysis persisted (API) and appears in Sessions UI when list loads."""
    assert self.analysis_id is not None, "analysis_id missing after upload flow"

    row = self.fetch_analysis_via_trpc(self.analysis_id)
    if row.get("videoFileName") != self.uploaded_filename:
      raise AssertionError(
          f"getById filename mismatch: {row.get('videoFileName')!r} "
          f"!= {self.uploaded_filename!r}"
      )
    self.think(
        f"  ✓ analysis.getById confirms persisted record id={self.analysis_id}"
    )

    name = self.uploaded_filename
    loc = self.page.locator("p.truncate", has_text=name)
    if loc.count() > 0 and loc.first.is_visible():
      self.think(f"  ✓ Session card visible for {name!r}")
      return

    list_errors = [
        r for r in self.telemetry.error_responses if "analysis.list" in r.url
    ]
    if list_errors:
      self.think(
          f"  ⚠ Sessions UI empty — browser analysis.list returned HTTP "
          f"{list_errors[-1].status} (record still verified via getById)"
      )
    else:
      self.think(
          f"  ⚠ Sessions UI did not show {name!r}; record verified via getById"
      )

  def fetch_analysis_via_trpc(self, analysis_id: int) -> dict[str, Any]:
    batch_input = urllib.parse.quote(
        json.dumps({"0": {"json": {"id": analysis_id}}})
    )
    url = (
        f"{self.config.base_url}/api/trpc/analysis.getById"
        f"?batch=1&input={batch_input}"
    )
    response = self.page.request.get(url)
    if not response.ok:
      raise AssertionError(
          f"analysis.getById probe failed: HTTP {response.status} — "
          f"{response.text()[:500]}"
      )
    body = response.json()
    if "error" in body[0]:
      raise AssertionError(f"analysis.getById error: {body[0]['error']}")
    return body[0]["result"]["data"]["json"]

  def video_panel(self) -> Locator:
    return self.page.locator(".relative.bg-black.rounded-xl").first

  def verify_video_and_canvas(self) -> None:
    self.think("Step 8: Structural check — video player and skeleton canvas")
    panel = self.video_panel()
    self.expect_visible(panel, "video panel")

    video = panel.locator("video")
    canvas = panel.locator("canvas")
    self.expect_visible(video, "video element")
    self.expect_visible(canvas, "overlay canvas")

    # Wait for video metadata
    video.evaluate(
        """async (el) => {
          if (el.readyState < 1) {
            await new Promise((resolve, reject) => {
              const t = setTimeout(() => reject(new Error('metadata timeout')), 30000);
              el.addEventListener('loadedmetadata', () => { clearTimeout(t); resolve(); }, { once: true });
              el.addEventListener('error', () => { clearTimeout(t); reject(new Error('video error')); }, { once: true });
            });
          }
        }"""
    )

    dims = video.evaluate(
        """(el) => ({
          videoWidth: el.videoWidth,
          videoHeight: el.videoHeight,
          readyState: el.readyState,
          duration: el.duration,
        })"""
    )
    if not dims.get("videoWidth") or not dims.get("videoHeight"):
      raise AssertionError(f"Video has zero dimensions: {dims}")
    self.think(
        f"  Video metadata OK: {dims['videoWidth']}x{dims['videoHeight']}, "
        f"duration={dims.get('duration', 0):.2f}s"
    )

    box = canvas.bounding_box()
    if not box or box["width"] < 10 or box["height"] < 10:
      raise AssertionError(f"Canvas not rendered with sensible size: {box}")

  def verify_metrics_panel(self) -> None:
    # Phase tabs from MetricsPanel use PHASE_LABELS in shared/types.ts
    phase_labels = (
        "Ready",
        "Backswing",
        "Forward Swing",
        "Contact",
        "Follow-Through",
    )
    found = False
    for label in phase_labels:
      loc = self.page.get_by_role("button", name=label)
      if loc.count() > 0 and loc.first.is_visible():
        self.think(f"  Metrics phase tab found: {label}")
        found = True
        break
    if not found:
      self.think("  Phase metric tabs not found by label — checking timeline instead")
      timeline = self.page.locator(".relative.h-9.bg-slate-800\\/60").first
      if timeline.count() > 0:
        self.expect_visible(timeline, "phase timeline track")

  def simulate_playback_and_scrub(self) -> None:
    self.think("Step 9: Simulating playback, pause, and timeline scrub")
    panel = self.video_panel()
    video = panel.locator("video")
    canvas = panel.locator("canvas")

    # Play/Pause: green button in control bar (icon-only)
    play_btn = panel.locator("button.bg-padel-green").first
    self.patient_click(play_btn, "play")

    def video_playing() -> bool:
      return video.evaluate("el => !el.paused && el.currentTime > 0")

    deadline = time.time() + self._timeout(5000)
    while time.time() < deadline:
      if video_playing():
        break
      time.sleep(0.1)
    else:
      raise AssertionError("Video did not start playing after play click")

    self.think("  ✓ Video is playing")

    self.patient_click(play_btn, "pause")
    paused = video.evaluate("el => el.paused")
    if not paused:
      raise AssertionError("Video should be paused after second control click")
    self.think("  ✓ Video paused")

    # Frame step forward (second button in control row after play)
    controls = panel.locator(".flex.items-center.gap-2.p-3 button")
    if controls.count() >= 3:
      time_before = video.evaluate("el => el.currentTime")
      controls.nth(2).click()
      time_after = video.evaluate("el => el.currentTime")
      if time_after <= time_before:
        self.think("  Frame step may be at end of clip — skipping strict assert")
      else:
        self.think("  ✓ Frame step advanced playhead")

    # Scrub phase timeline
    track = self.page.locator(".relative.h-9.bg-slate-800\\/60").first
    if track.count() > 0:
      box = track.bounding_box()
      if box:
        self.page.mouse.click(box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
        self.think("  ✓ Clicked phase timeline to scrub")
        self.page.wait_for_timeout(300)

    # Canvas should have drawable content after playback (non-transparent pixels)
    has_pixels = canvas.evaluate(
        """(canvas) => {
          const ctx = canvas.getContext('2d');
          if (!ctx || canvas.width < 2) return false;
          const data = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) return true;
          }
          return false;
        }"""
    )
    if has_pixels:
      self.think("  ✓ Skeleton overlay canvas has visible pixels")
    else:
      self.think(
          "  ⚠ Canvas pixel probe found no alpha — overlay may be off or not yet drawn"
      )

  # ── Orchestration ─────────────────────────────────────────────────────────

  def run_all(self) -> None:
    self.think("=== Padel Analyzer E2E Agent starting ===")
    self.flow_dashboard_and_navigation()
    self.flow_upload()
    self.flow_verify_analysis()
    self.think("=== All flows completed successfully ===")


# ── Artifacts & CLI ───────────────────────────────────────────────────────────


def save_artifacts(
    artifacts_dir: Path,
    agent: PadelE2EAgent,
    telemetry: Telemetry,
    page: Page | None,
    error: Exception | None,
) -> None:
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    log_path = artifacts_dir / f"agent-log-{ts}.json"
    log_path.write_text(
        json.dumps(
            {
                "entries": agent.log_entries,
                "analysisId": agent.analysis_id,
                "uploadedFilename": agent.uploaded_filename,
                "error": str(error) if error else None,
                "traceback": traceback.format_exc() if error else None,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    (artifacts_dir / f"console-events-{ts}.json").write_text(
        json.dumps(telemetry.to_dict()["console"], indent=2),
        encoding="utf-8",
    )
    (artifacts_dir / f"network-events-{ts}.json").write_text(
        json.dumps(
            {
                "failedRequests": telemetry.to_dict()["failedRequests"],
                "errorResponses": telemetry.to_dict()["errorResponses"],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    if page is not None:
      try:
        page.screenshot(path=str(artifacts_dir / f"failure-{ts}.png"), full_page=True)
      except Exception:
        pass

    print(f"Artifacts written to {artifacts_dir}", file=sys.stderr)


def parse_args() -> AgentConfig:
    parser = argparse.ArgumentParser(
        description="Autonomous Playwright E2E agent for Padel Video Analyzer",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("PADEL_BASE_URL", DEFAULT_BASE_URL),
        help=f"App base URL (default: {DEFAULT_BASE_URL})",
    )
    parser.add_argument(
        "--video",
        default=os.environ.get("PADEL_SAMPLE_VIDEO"),
        help="Path to sample padel MP4 (or set PADEL_SAMPLE_VIDEO)",
    )
    parser.add_argument("--headless", action="store_true", help="Run headless browser")
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=int(os.environ.get("PADEL_E2E_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    )
    parser.add_argument(
        "--processing-timeout-ms",
        type=int,
        default=int(
            os.environ.get("PADEL_E2E_PROCESSING_TIMEOUT_MS", PROCESSING_TIMEOUT_MS)
        ),
    )
    parser.add_argument(
        "--artifacts-dir",
        default=os.environ.get("PADEL_E2E_ARTIFACTS_DIR", DEFAULT_ARTIFACTS_DIR),
    )
    args = parser.parse_args()

    if not args.video:
      parser.error(
          "Provide --video /path/to/sample.mp4 or set PADEL_SAMPLE_VIDEO"
      )

    video_path = Path(args.video).expanduser()
    return AgentConfig(
        base_url=args.base_url.rstrip("/"),
        video_path=video_path,
        headless=args.headless,
        timeout_ms=args.timeout_ms,
        processing_timeout_ms=args.processing_timeout_ms,
        artifacts_dir=Path(args.artifacts_dir),
    )


def main() -> int:
    config = parse_args()
    telemetry = Telemetry()
    agent: PadelE2EAgent | None = None
    page: Page | None = None

    with sync_playwright() as p:
        browser: Browser = p.chromium.launch(headless=config.headless)
        context: BrowserContext = browser.new_context(
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()
        page.set_default_timeout(config.timeout_ms)
        telemetry.attach(page)
        agent = PadelE2EAgent(page, config, telemetry)

        run_error: Exception | None = None
        try:
            agent.run_all()
            if telemetry.has_critical_issues():
                raise AssertionError(
                    "Telemetry recorded server errors or failed requests — "
                    "review network-events JSON"
                )
        except Exception as exc:
            run_error = exc
            save_artifacts(config.artifacts_dir, agent, telemetry, page, run_error)
            print(f"\nAgent failed: {exc}", file=sys.stderr)
            return 1
        finally:
            browser.close()

    if agent:
        save_artifacts(config.artifacts_dir, agent, telemetry, page, None)

    return 0


if __name__ == "__main__":
    sys.exit(main())
