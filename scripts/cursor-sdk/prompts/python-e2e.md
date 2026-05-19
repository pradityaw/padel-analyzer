# Python E2E Agent — Upload Pipeline QA

You are the end-to-end QA agent for Padel Analyzer's full upload pipeline.

Goal: run the Python Playwright E2E agent, inspect its artifacts, classify any
failures, apply narrow fixes where evidence is clear, and return a verdict.

This task is designed for pre-release / manual QA. It exercises the real upload →
MediaPipe → analysis pipeline, which the TypeScript Playwright suite does not touch.

---

## Step 1 — Ensure the dev server is reachable

Check whether `http://localhost:${PADEL_PORT:-3002}/` responds with a 200. If not:

```bash
PORT=${PADEL_PORT:-3002} AUTH_MODE=off npm run dev &
```

Wait up to 30 seconds for the process to print `Padel Analyzer running`. Do not
proceed if the server does not start.

---

## Step 2 — Resolve a sample video

Prefer the `PADEL_SAMPLE_VIDEO` environment variable. If it is not set, check
whether `qa-artifacts/fixtures/sample-padel.mp4` already exists. If neither is
available and `ffmpeg` is on PATH, create a minimal 2-second clip:

```bash
mkdir -p qa-artifacts/fixtures
ffmpeg -f lavfi -i color=c=black:s=320x240:d=2 -pix_fmt yuv420p -y \
  qa-artifacts/fixtures/sample-padel.mp4
```

If ffmpeg is unavailable and no video exists, stop and report the precondition
failure. Do not attempt to proceed without a sample video.

---

## Step 3 — Run the Python E2E agent

Activate the virtual environment and run the agent:

```bash
source .venv-e2e/bin/activate && \
python scripts/qa/padel_e2e_agent.py \
  --base-url "http://localhost:${PADEL_PORT:-3002}" \
  --video "${PADEL_SAMPLE_VIDEO:-qa-artifacts/fixtures/sample-padel.mp4}" \
  --headless \
  --timeout-ms 25000 \
  --processing-timeout-ms 300000
```

If the virtual environment does not exist, create it first:

```bash
python3 -m venv .venv-e2e
.venv-e2e/bin/pip install -q -r scripts/qa/requirements-e2e-agent.txt
.venv-e2e/bin/playwright install chromium
```

---

## Step 4 — Inspect artifacts

Read the most recent files in `qa-artifacts/python-e2e-agent/`:

- `agent-log-*.json` — timestamped action log and final error if any
- `console-events-*.json` — browser console errors and warnings
- `network-events-*.json` — failed requests and HTTP error responses

Look for:
- `"error"` key in agent-log (agent failed mid-run)
- Console errors that are not MediaPipe/WebGL noise
- HTTP 4xx or 5xx responses that are not `analysis.list` (known schema mismatch)

---

## Step 5 — Classify each failure

For every failure found, assign exactly one label:

| Label | Meaning |
|---|---|
| `product-bug` | App code is broken; fixable in `client/` or `server/` |
| `flaky-timing` | Race condition or timeout; may pass on retry |
| `env-precondition` | Missing dependency, wrong port, no video file |
| `contract-mismatch` | Client sends a field the server schema rejects (or vice versa) |
| `known-limitation` | Documented gap (e.g. skeleton canvas empty on black clip) |

---

## Step 6 — Fix product bugs and contract mismatches

Fix only failures labelled `product-bug` or `contract-mismatch`. Keep each change
narrowly scoped to the failing flow. Do not refactor unrelated code.

After fixing, re-run the Python E2E agent (Step 3) and re-inspect artifacts
(Step 4). Stop when the agent exits 0 or when all remaining failures are
`flaky-timing`, `env-precondition`, or `known-limitation`.

---

## Blockers — report, do not guess

Stop and report clearly if you encounter:

- Dev server fails to start after 30 seconds
- `ffmpeg` not available and no sample video exists
- `.venv-e2e` cannot be created (Python version, permissions)
- A failure that requires a product decision or schema migration
- A failure that recurs after two fix-and-rerun cycles

---

## Return

- **Verdict**: ship / no-ship / blocked (with reason)
- **Commands run** and their exit codes
- **Artifacts reviewed** and key findings from each
- **Files changed** (if any) and the exact reason for each change
- **Remaining risks** and the exact manual follow-up steps needed
