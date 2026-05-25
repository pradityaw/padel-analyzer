# QA Guide — Phases 0 & 1

> **Scope:** Pre-release gates (Phase 0) and the core web upload → analysis → replay path (Phase 1).  
> **Product label:** [Mobile Swing Replay Beta](./BETA_SCOPE.md) — pose + phases are primary; ball overlay is best-effort.  
> **Bug reports:** File issues in [`docs/bug-reports/`](./bug-reports/README.md) using the template there.

---

## Phase overview

| Phase | Goal | When to run |
|-------|------|-------------|
| **0 — Pre-flight** | Environment, dependencies, and automated gates pass before manual QA | Every release branch, before any tester session |
| **1 — Core flow** | Upload or YouTube → server job completes → analysis replay works | After Phase 0 passes; repeat on web + one mobile device for beta |

**Out of scope for Phases 0–1** (do not file Sev-1 bugs unless product explicitly changes scope):

- Mobile racket-head overlay / km/h speed (web-only for this beta)
- Match CV rallies / heatmaps / condensed rally video
- Guaranteed ball track on glass reflections or heavy occlusion
- Public App Store / Play Store release

See [BETA_SCOPE.md](./BETA_SCOPE.md) for the full in/out list.

---

## Phase 0 — Pre-flight & release gates

### 0.1 Environment setup

| Check | Command / action | Pass |
|-------|------------------|------|
| Node deps installed | `npm ci` | Exit 0 |
| Dev server starts | `npm run dev` | App at `http://localhost:3001`, `/healthz` → 200 |
| Python 3 available | `python3 --version` | 3.10+ |
| CV Python deps | `pip install -r scripts/cv/requirements.txt` (+ MediaPipe for pose stage) | Import `cv2`, `mediapipe` without error |
| ffmpeg on PATH | `ffmpeg -version` | Required for rally detection ingestion |
| yt-dlp on PATH (YouTube tests) | `yt-dlp --version` | Required for YouTube upload path |
| SQLite writable | `data/padel.db` exists after first boot | Server starts without DB errors |

**Optional env (TrackNet ball backend):**

```bash
PADEL_BALL_BACKEND=tracknet
TRACKNET_MODEL_PATH=scripts/cv/models/tracknet-v2.onnx
```

If the ONNX model is missing, ball stage falls back to OpenCV — that is expected, not a Phase 0 failure.

### 0.2 Automated release gates

Run before manual QA or widening beta:

```bash
npm run release:beta-gates
```

This runs, in order:

1. `npm run typecheck`
2. `npm run mobile:typecheck`
3. `npm run test:contracts`
4. Court calibration QA script
5. Mobile ball-tracking tests
6. Tracking integration smoke
7. `pytest scripts/cv/tests`

**Pass criteria:** All steps exit 0. Any failure blocks Phase 1 until fixed or explicitly waived in a bug review.

**Optional (browser surface):**

```bash
npm run qa:browser
```

Requires dev server + `AUTH_MODE=off` per Playwright config. Failures → file bug with Playwright trace path under `qa-artifacts/` (gitignored).

### 0.3 Secrets & hygiene

| Check | Pass |
|-------|------|
| No `.env` or tokens committed | `git status` clean of secrets |
| No large uploads / DB blobs staged | `data/uploads/`, `*.db` not in commit |
| Server errors sanitized in production | Raw yt-dlp stderr not shown to users (see ARCHITECTURE_REVIEW) |

### Phase 0 sign-off

Record in your QA session notes:

- Date / branch / commit SHA
- `release:beta-gates`: pass / fail (paste failing step)
- `qa:browser`: pass / fail / skipped
- Python + ffmpeg + yt-dlp versions
- Sign-off: **Phase 0 pass** → proceed to Phase 1

---

## Phase 1 — Upload → analysis → replay

### 1.1 Test assets

Use a mix of clips so timing and quality gates are exercised:

| Asset | Duration | Purpose |
|-------|----------|---------|
| **Short swing** | 5–30 s, single player, good lighting | Happy path, quick turnaround |
| **Medium clip** | 2–5 min | Processing-time banner (moderate tier) |
| **Long match** (optional) | 10–21 min | Stress test; expect **~2× video length** wall time on server |
| **YouTube URL** | ≤ 30 min (`YOUTUBE_MAX_DURATION_SEC`) | Download + analysis; client should show pre-submit duration guard |

**Limits (from `shared/config.ts`):**

- Max upload: **2 GB**
- YouTube cap: **30 minutes**
- Min frames for successful job: **10** at sample FPS (default **15 fps**)

### 1.2 Processing time expectations (UI)

The upload page shows tiered estimates (`client/src/lib/processingTimeEstimate.ts`):

| Tier | Rough wall time | When |
|------|-----------------|------|
| **quick** | ≤ ~4 min | Short clips (≤ ~3 min video) |
| **moderate** | ~4–15 min | Mid-length |
| **long** | 15+ min | Long matches; ratio approaches **~2.3× video length** + ~90 s overhead |

YouTube adds download time to the range. **Pass:** banner appears before submit; during processing, elapsed copy stays within the stated window or explains overrun without crashing.

**Known UX gap (defer unless product promotes to Sev-1):** navigating away from `/upload` loses in-progress job UI — server may still complete the job. Verify via History or DB, not only the upload page.

### 1.3 End-to-end pipeline (what QA is validating)

After the user clicks analyze, the server runs these stages (see `server/lib/parallelAnalysisOrchestrator.ts`):

| Stage | UI label (approx.) | Hard-fail? | Notes |
|-------|-------------------|------------|-------|
| Upload + job create | Saving / queued | Yes | Multer → `data/uploads/` |
| Ingestion | Rally detection | Yes | Python + ffmpeg |
| Agent A | Court calibration | Soft-fail | Job continues with fallback |
| Agent B | Player pose / phases | **Yes** | MediaPipe Python; quality gate ≥ 10 frames |
| Agent C | Ball trajectory | Soft-fail | TrackNet → OpenCV fallback |
| Aggregation | Racket + save | Soft (racket) | Artifacts in `data/analysis-agents/job-{id}.json` |

**Queue:** `MAX_CONCURRENT = 1` — second job shows **Queued** until the first finishes. Long wait while queued is expected, not a hang.

**Pass (job):** `status: completed`, `analysisId` set, no `errorMessage`.

**Fail (job):** `status: failed` with readable `errorMessage` — file bug with job id, video name, and stage from `mobileAnalysis.getById`.

### 1.4 Web manual checklist

Run at `http://localhost:3001` after Phase 0 pass.

#### A — Landing & history

| # | Step | Pass criteria |
|---|------|---------------|
| 1 | Open `/` | Sessions list or empty state loads; no white screen |
| 2 | Open a completed analysis from history | `/analysis/:id` loads without 500 |
| 3 | Demo analysis (if available, e.g. `analysisId: -1`) | Skeleton + synthetic ball; no crash |

#### B — File upload

| # | Step | Pass criteria |
|---|------|---------------|
| 4 | Select valid `.mp4` / `.mov` / `.webm` | Preview + processing-time banner |
| 5 | Submit short clip | Progress UI; stages advance; completes → redirect or link to analysis |
| 6 | Oversized file (> 2 GB) | Client or server rejects with clear error (no hang) |
| 7 | Cancel / error recovery | Failed job shows error + retry path (re-select video) |

#### C — YouTube

| # | Step | Pass criteria |
|---|------|---------------|
| 8 | Paste valid URL → Look up | Thumbnail, title, duration |
| 9 | Duration > 30 min | Blocked on client and/or server with clear message |
| 10 | Analyze | Download + processing banner; job completes or fails with message |

#### D — Analysis replay (`/analysis/:id`)

| # | Step | Pass criteria |
|---|------|---------------|
| 11 | Video plays | No black screen; controls respond |
| 12 | Skeleton overlay | Tracks player; toggle works |
| 13 | Phase timeline | Segments visible; click seeks (if implemented) |
| 14 | Time display | Current / total time sane; ±seek on timeline bar |
| 15 | Ball marker | Visible when `ballTracking` non-empty; **empty is OK** for older jobs or failed ball stage |
| 16 | Racket speed badge | Web-only feature; present when data exists |
| 17 | Reload page | Same analysis reloads; no corrupt JSON crash |
| 18 | Low pose quality | Warning shown if detection rate low (sessionStorage or persisted banner) |

#### E — Resilience

| # | Step | Pass criteria |
|---|------|---------------|
| 19 | Stop dev server mid-upload | Network error; no infinite spinner |
| 20 | Two uploads back-to-back | Second queues; both eventually complete or fail visibly |

### 1.5 Mobile smoke (Phase 1 extension)

After web Phase 1 pass, run [MOBILE_DEVICE_QA.md](./MOBILE_DEVICE_QA.md) on one iOS + one Android device against LAN or hosted API.

### 1.6 Diagnostics when something fails

1. **Browser:** DevTools console + Network tab for failed tRPC calls.
2. **Server log:** Lines `[pipeline] analysis-job-{id}` and `[analysis-stage] {stage} start|done|failed`.
3. **Job record:**

   ```bash
   node -e "
   const Database = require('better-sqlite3');
   const db = new Database('./data/padel.db');
   const row = db.prepare(
     'SELECT id, status, progress, status_message, error_message, analysis_id FROM analysis_jobs WHERE id = ?'
   ).get(Number(process.argv[1]));
   console.log(row);
   db.close();
   " <JOB_ID>
   ```

4. **Partial artifacts:** `data/analysis-agents/job-<JOB_ID>.json`
5. **Python setup:** `python3 -c "import mediapipe, cv2"`; model file `scripts/pose_landmarker_full.task`
6. **Common failure modes:**

   | Symptom | Likely cause |
   |---------|----------------|
   | Fails quickly on player stage | Missing `mediapipe` or pose model |
   | `LOW_QUALITY` after long run | < 10 frames detected; bad lighting / wrong subject |
   | Stuck at Queued | Another job running (`MAX_CONCURRENT=1`) |
   | 45+ min then timeout | Long match + TrackNet CPU; check `CV_*_TIMEOUT_MS` env |
   | Ingestion fails immediately | `ffmpeg` missing |
   | YouTube fails | `yt-dlp` missing or URL blocked |

Attach log excerpts and job id to every bug report.

### Phase 1 sign-off

| Surface | Result | Notes |
|---------|--------|-------|
| Web file upload → replay | pass / fail | Job id, analysis id |
| Web YouTube → replay | pass / fail / N/A | |
| Mobile (optional) | pass / fail / N/A | Device model |
| Open Sev-1 bugs | count | Links to `docs/bug-reports/` |

---

## Pass / fail summary

### Phase 0 — **PASS** when

- `npm run release:beta-gates` exits 0
- Dev server healthy at `:3001`
- ffmpeg (+ yt-dlp for YouTube QA) available
- No secrets or large artifacts staged for commit

### Phase 1 — **PASS** when

- Short clip: upload → completed job → analysis page with video + skeleton + scores
- Failed paths show user-visible errors (no silent hang)
- History reopen works
- Empty `ballTracking` does not crash UI
- All **Sev-1** bugs from the session are filed (fixes can follow in engineering review)

### Severity guide (for bug reports)

| Severity | Definition | Examples |
|----------|------------|----------|
| **Sev-1** | Blocks core upload → replay | Crash, job stuck with no error, corrupt analysis load |
| **Sev-2** | Degraded but workaround exists | Ball missing, slow queue, lost in-progress UI on navigation |
| **Sev-3** | Polish / edge case | Wrong estimate copy, minor layout, a11y |

---

## Related docs

- [BETA_SCOPE.md](./BETA_SCOPE.md) — in/out of beta
- [BETA_PROGRAM.md](./BETA_PROGRAM.md) — recruitment & exit criteria
- [MOBILE_DEVICE_QA.md](./MOBILE_DEVICE_QA.md) — device checklist
- [CUSTOMER_JOURNEY.md](../CUSTOMER_JOURNEY.md) — UX stages (future UI QA)
- [TECH_STRATEGY.md](../TECH_STRATEGY.md) — Milestone 1 pipeline extraction
- [AGENTS.md](../AGENTS.md) — workstream ownership for fixes

---

## QA session log (copy for each run)

```text
Date:
Tester:
Branch / commit:
Phase 0: pass | fail
Phase 1 web: pass | fail
Phase 1 mobile: pass | fail | skipped
Clips used:
Jobs created: 
Bugs filed: docs/bug-reports/BUG-___-*.md
Notes:
```
