# Architecture Review — Padel Analyzer

> Lead Architect critical assessment · April 2026
>
> This document fills in all bracketed assessments from the original review plan.
> Findings are blunt. If something reads like a junior wrote it, it's called out.

---

## 1. Current Architectural Health

### Separation of Concerns

**Backend (Server):** Express + tRPC + SQLite. Handles video storage (multer), YouTube ingestion (yt-dlp), and CRUD for analyses/annotations/comparisons. **No ML runs on the server** — all pose estimation and classification happens in the browser. The server is a thin persistence layer.

**Frontend:** React + Tailwind. The client is the **entire ML pipeline orchestrator** — MediaPipe pose detection, ONNX shot classification, swing phase segmentation, and scoring all run in `Upload.tsx` via chained calls to `mediapipe.ts` → `swingAnalyzer.ts` → `shotClassifier.ts`.

**Verdict: API boundaries are _mostly_ clean, but ML logic leaks into the UI.**

The pipeline orchestration (`runMediaPipeAndSave` in `Upload.tsx`) is a 60-line callback that mixes:
- I/O (file upload via `fetch("/api/upload")`)
- ML inference (MediaPipe + ONNX)
- Progress UI updates (`setProgress`, `setProgressMsg`, canvas drawing)
- Data persistence (tRPC `analysis.create`)

This is not a clean separation. A component should _consume_ pipeline events, not _be_ the pipeline. The analysis logic cannot be unit tested, reused from another entry point, or moved to a Web Worker without rewriting this callback.

The server, meanwhile, accepts `phasesJson` and `landmarksJson` as **opaque strings** with no validation. The backend cannot distinguish a valid analysis from garbage JSON. The new `shared/schema.ts` defines Zod schemas for this, but the `analysis.create` router still uses a plain `z.string()` — the schema is defined but not yet wired into the input validation.

### Data Pipeline

**Input:** Raw .mp4/.mov video (file upload or YouTube via yt-dlp).

**Processing chain:**
1. Video stored on server → `storageKey` returned
2. Browser creates `<video>` element, seeks frame-by-frame at **15 FPS**
3. Each frame → `PoseLandmarker.detectForVideo()` → 33 landmarks
4. All frames → `analyzeSwing()` → dominant side detection → ONNX shot classification → phase segmentation → scoring
5. Result JSON → `tRPC analysis.create` → SQLite

**Latency and frame-rate handling assessment:**

The seek-based approach (`video.currentTime = t; await onseeked`) is **synchronous and blocking**. For a 2-minute video at 15 FPS = 1,800 iterations of seek + detect, each taking ~30–50ms. That's **55–90 seconds of main-thread blocking**. The browser cannot process user input during this time.

There is **no timeout** on the `onseeked` promise — if the browser fails to seek (corrupt frame, codec issue), the pipeline hangs indefinitely. There is **no abort mechanism** — once started, the user cannot cancel.

The 15 FPS sample rate is reasonable for padel swing analysis (swings last ~1 second, giving ~15 frames per swing), but the comment in `mediapipe.ts` mentions `requestVideoFrameCallback` as an alternative that is never implemented.

---

## 2. Technical Debt & Risks

### Error Handling: ML Pipeline Resilience

**Low-light / low-quality video handling: POOR.**

- `PoseLandmarker.detectForVideo()` returns empty landmarks when it can't detect a pose. The code handles this gracefully (skips the frame, continues). However:
- There is **no minimum landmark quality check**. If MediaPipe returns landmarks with `visibility: 0.01` (essentially guessing), those frames are treated identically to `visibility: 0.99` frames.
- If **every** frame fails detection (pitch-black video), `processVideo` returns an empty array. `analyzeSwing` then gets 0 frames, `detectPhases` returns `[]`, and the analysis is saved with `overallScore: 0` and empty phases — a valid but meaningless result with no user-facing warning about poor video quality.
- `shotClassifier.ts` has a `try/catch` that returns `null` on failure — correct. But the only logging is `console.warn`. No telemetry, no user-facing "classification unavailable" message.

**What a senior engineer would do differently:**
- Add a post-processing step that checks `frames.length / expectedFrames` and warns if detection rate is below 60%.
- Check average landmark visibility per frame and flag low-confidence analyses.
- Wrap the entire pipeline in a timeout (e.g., 3 minutes max).
- Add an abort controller so users can cancel.

### Scalability: Concurrent Requests

**Single-user only. Multiple simultaneous analyses will degrade.**

- The server has **no request queuing or rate limiting**. Two users uploading simultaneously is fine (multer handles parallel writes with random filenames).
- But two users triggering YouTube downloads of the same video hit a **TOCTOU race condition** in `youtube.ts`: both check `existsSync(filePath)`, both see `false`, both start `yt-dlp` writing to the same path simultaneously → corrupt file.
- The `analysis.list` endpoint returns **all rows with full JSON blobs** — no pagination. At 50+ analyses (~2–3 MB of landmarks each), this query returns 100+ MB of data.
- `exportTrainingData` and `exportPairedData` build entire datasets in memory — no streaming.

### Performance: UI Lag During Video Overlays

**VideoPlayer skeleton overlay is well-optimized; the pipeline is the problem.**

- `VideoPlayer.tsx` uses `requestAnimationFrame` to sync skeleton drawing with video playback — correct pattern, smooth at 15 FPS.
- The real performance issue is during **processing** (Upload page), where the main thread is blocked by the seek loop. The skeleton preview canvas updates during processing are a nice touch but don't prevent the UI from becoming unresponsive during long videos.
- `SkeletonReplay.tsx` animation loop is clean. No memory leaks from uncancelled animation frames (cleanup in `useEffect` return).

---

## 3. UX & Journey Integrity

### Current Flow

```
Upload Page                    Analysis Page                History Page
─────────────────────────────────────────────────────────────────────────
                                                            
 [File / YouTube Tab]          [Video Player + Skeleton]    [Session List]
       │                              │                          │
       ▼                              ▼                          ▼
 Select video ──────► Processing ──► Phase Timeline           Score Chart
 (drag-drop or URL)   (4 steps)     Metrics Panel             Shot Filter
       │               │             Coaching Panel            Score Cards
       │               ▼             ShotType Badge                │
       │          Navigate to ────────────────────────────► Click → Analysis
       │          /analysis/:id                                    │
       │                                                    Delete (confirm)
       ▼
 [YouTube preview]
 (thumbnail, title, duration)
                                                            
 Also: /compare (side-by-side), /annotate (labeling), /pro-compare (gap analysis)
```

**Journey gaps:**
1. **No "Processing Failed" recovery.** If the ML pipeline crashes mid-way, the error state shows "Try again" which resets everything — the video is already uploaded but the user must re-select it.
2. **No "Analysis in Progress" persistence.** If the user navigates away during processing, everything is lost.
3. **No video quality feedback.** The user uploads a dark hallway video, waits 60 seconds, and gets a score of 0 with no explanation.
4. **The YouTube "max 5 minutes" limit is only checked server-side.** The client shows "max 5 minutes" in copy but doesn't prevent the user from clicking "Analyze" on a 10-minute video — they'll wait for the download to complete before seeing the error.

### Visual Standards: "Dark Mode + Tennis Neon Green"

**Mostly consistent, with drift in edges.**

**What's right:**
- `Navbar`: Textbook use of `padel-green`, `padel-dark`, `padel-border` tokens
- `SwingCoachingPanel`: Clean dark surface + neon accent
- `Upload.tsx`: Neon green CTAs, dark surfaces, shimmer bar in brand green
- `index.css`: Centralizes theme tokens via `@theme`

**What's drifting:**
- `VideoPlayer.tsx`: Uses `bg-black` and `bg-slate-900` instead of `padel-dark`/`padel-surface`
- `PhaseTimeline.tsx`: Hardcoded `shadow-[0_0_4px_rgba(255,255,255,0.7)]` for the playhead
- `.shimmer-bar` in `index.css`: Hardcodes `#a3e635` instead of `var(--color-padel-green)` — if the theme color changes, shimmer drifts
- Empty states are inconsistent: `VideoPlayer` shows a bordered message, `PhaseTimeline` returns `null` (nothing), `MetricsPanel` shows an empty body with tabs but no content
- `History.tsx` chart colors are hardcoded hex values, not derived from theme

**Accessibility gaps:**
- Icon-only buttons in `VideoPlayer` (play, pause, skip, speed, skeleton toggle) have **no `aria-label`**
- `MetricsPanel` tabs use `<button>` without `role="tab"` / `aria-selected` / `role="tablist"`
- `PhaseTimeline` seeking is mouse-only — no keyboard navigation, no `role="slider"`
- `Navbar` hides link labels on mobile (`hidden sm:inline`) but doesn't add `aria-label` to the remaining icon-only links

---

## 4. Technical Debt Register — The Hard Truth

### Junior-Level Patterns

| Issue | Location | Why it's junior |
|---|---|---|
| **Rules of Hooks violation** | `Analysis.tsx:147` — `useMemo` called after conditional returns at lines 125, 133 | This will cause "Rendered more hooks than during the previous render" crashes in React strict mode. A senior would put all hooks before any returns. |
| **`JSON.parse` without try/catch — everywhere** | `Analysis.tsx:101-102`, `Compare.tsx:36-42`, `Annotate.tsx:39`, `ProCompare.tsx:307-349`, `annotation.ts:147-148`, `proCompare.ts:153,194,269-281` | One corrupt row in SQLite crashes the entire page/endpoint. A senior wraps these in try/catch with fallback UI. |
| **`(p: any)` in production code** | `proCompare.ts:195` | Explicit `any` in a typed codebase. Should be `(p: { type: string; metrics?: Record<string, number> })` or use the shared `SwingPhase` type. |
| **Dead code shipped** | `annotation.ts:106-108` — `const annotated = db.select(...)` is assigned but never used | Either a leftover from a refactor or an incomplete implementation. A senior deletes dead code or marks it with a TODO. |
| **Non-transactional writes** | `annotation.ts:21-37` — insert annotation then update analysis as separate operations | Crash between steps = annotation exists but analysis `shotType` is stale. A senior uses `db.transaction()`. |
| **N+1 queries** | `proCompare.ts:52-67` (list), `proCompare.ts:245-260` (export) | Per-row queries inside a loop. Classic junior ORM anti-pattern. Should be a JOIN or batch query. |
| **TOCTOU race condition** | `youtube.ts:123-125` — `existsSync` then `downloadVideo` | Two concurrent requests for the same YouTube URL both pass the check and both write to the same file. Should use atomic write (temp file + rename) or a lock. |
| **No input length limits** | `analysis.ts:19-20` — `phasesJson: z.string()`, `landmarksJson: z.string()` with no `.max()` | A client can POST a 500 MB JSON string and it will be inserted into SQLite. Should have `.max(10_000_000)` or similar. |
| **No tRPC error formatter** | `trpc.ts` — no `errorFormatter` configured | Raw database errors, yt-dlp stderr, and stack traces leak to the client. A senior adds an error formatter that sanitizes messages in production. |

### Backend ↔ Frontend Inconsistencies

| Inconsistency | Detail |
|---|---|
| **Server accepts any string as `phasesJson`; client sends validated data** | The schema contract exists in `shared/schema.ts` but the server's Zod validation still uses `z.string()`. The server trusts the client blindly. |
| **Server stores `sampleFps` per row; client hardcodes playback at 15 FPS** | `SkeletonReplay.tsx` uses `SAMPLE_FPS` (now centralized), but `VideoPlayer.tsx` accepts `sampleFps` as a prop. If a future analysis uses 30 FPS, the skeleton replay would be correct but the video player would need the prop wired through. |
| **`shotType` comes from two sources** | ML classifier sets it during analysis; manual annotation overwrites it via `annotation.create`. The `analysis` row and `annotation` row can disagree if the annotation is later deleted. |
| **Export `sampleFps` is always the constant, not the per-row value** | `annotation.ts:140` and `proCompare.ts:298` use `SAMPLE_FPS` instead of `r.sampleFps` from the analysis row — if a future row has a different FPS, the export lies. |
| **YouTube duration check is server-only** | The client shows "max 5 minutes" in help text but doesn't pre-validate `ytInfo.durationSeconds` before calling `download`. User waits for the full download before getting the error. |

---

## 5. Immediate Action Items (Marching Orders)

### Priority 1 (Critical): Wire the JSON schema into server validation

**Status: PARTIALLY DONE.** `shared/schema.ts` defines `createAnalysisInputSchema` with `phasesJson`/`landmarksJson` refinements that validate the JSON structure. But `server/routers/analysis.ts` still uses a hand-rolled `z.object(...)` without those refinements. **Wire `createAnalysisInputSchema` into the `analysis.create` procedure.**

Also add `.max()` limits to string fields and bounds to numeric fields.

### Priority 2 (UX): Processing state improvements

**Status: DONE.** `Upload.tsx` now shows:
- Elapsed time counter
- Estimated time remaining (computed from progress rate)
- Per-stage descriptions explaining what the ML is doing
- Live activity indicator (pulsing green dot)

**Still needed:**
- Abort/cancel button
- Post-analysis quality warning if landmark detection rate < 60%
- Client-side YouTube duration pre-validation

### Priority 3 (Clean Up): Central configuration

**Status: DONE.** `shared/config.ts` centralizes all hardcoded metrics. 12 files rewired. Magic numbers eliminated. `METRIC_WEIGHTS` derived from `GENERIC_RANGES` to prevent drift.

**Still needed:**
- Wire `SAMPLE_FPS` config into exports (use per-row `sampleFps` instead of the constant)
- Add phase order constant to shared config (duplicated in `ProCompare.tsx` and `proCompare.ts`)

---

## 6. Severity-Ranked Fix List

| # | Severity | Issue | File(s) | Effort |
|---|---|---|---|---|
| 1 | **Critical** | Rules of Hooks violation — `useMemo` after conditional return | `Analysis.tsx:147` | 5 min |
| 2 | **Critical** | JSON.parse without try/catch (crash on corrupt data) | 8+ files | 30 min |
| 3 | **High** | No tRPC error formatter — raw errors leak to client | `trpc.ts` | 15 min |
| 4 | **High** | No input length limits on JSON string fields | `analysis.ts` | 10 min |
| 5 | **High** | Non-transactional annotation create + analysis update | `annotation.ts` | 10 min |
| 6 | **High** | TOCTOU race in YouTube download | `youtube.ts` | 20 min |
| 7 | **Medium** | N+1 queries in proCompare list and export | `proCompare.ts` | 30 min |
| 8 | **Medium** | No pagination on analysis.list | `analysis.ts` | 20 min |
| 9 | **Medium** | Missing `aria-label` on icon-only buttons | `VideoPlayer`, `Navbar` | 15 min |
| 10 | **Medium** | Inconsistent empty states (null vs message vs blank) | Multiple components | 20 min |
| 11 | **Low** | Dead code (`annotated` variable, unused `statusBg`) | `annotation.ts`, `SwingCoachingPanel` | 5 min |
| 12 | **Low** | Shimmer bar hardcodes hex instead of CSS variable | `index.css` | 2 min |
| 13 | **Low** | PhaseTimeline seek is mouse-only | `PhaseTimeline.tsx` | 15 min |
