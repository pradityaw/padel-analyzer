# Tech Strategy — Padel Analyzer

> Lead Architect assessment · April 2026
>
> This document is the canonical reference for architectural direction. Update it when milestones are completed or priorities change.
>
> **See also:** [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) — critical code-level audit with severity-ranked fix list.

---

## 1. State of the Union

### 1.1 Architecture snapshot

```
┌──────────────────────────────────────────────────────────┐
│                     BROWSER (client/)                    │
│                                                          │
│  Upload.tsx ── mediapipe.ts ── swingAnalyzer.ts           │
│      │              │              │                      │
│      │         PoseLandmarker   detectPhases / score      │
│      │              │              │                      │
│      │              ▼              ▼                      │
│      │         shotClassifier.ts (ONNX Runtime Web)       │
│      │                                                    │
│      ├─────► tRPC (analysis.create) ─────────────────┐   │
│      │                                               │   │
│  Analysis.tsx, History.tsx, ProCompare.tsx, Annotate  │   │
│      ▲  consume stored JSON via tRPC queries         │   │
└──────┼───────────────────────────────────────────────┼───┘
       │                                               │
       │              HTTP / tRPC                       │
       ▼                                               ▼
┌──────────────────────────────────────────────────────────┐
│                   SERVER (server/)                        │
│                                                          │
│  Express + tRPC (superjson)                              │
│  Routers: analysis, youtube, annotation, proCompare      │
│  Multer upload │  yt-dlp + ffmpeg  │  SQLite (Drizzle)   │
│                                                          │
│  NO server-side ML — all inference happens in the browser│
└──────────────────────────────────────────────────────────┘
```

**Stack:** React 18 + wouter · TanStack Query via tRPC · Tailwind CSS + Radix · Framer Motion · MediaPipe Tasks-Vision · ONNX Runtime Web · Express · Drizzle ORM + better-sqlite3 · yt-dlp / ffmpeg (external)

### 1.2 What's working well

| Area | Strength |
|---|---|
| **Shared type contract** | `shared/types.ts` gives both sides a single source of truth for domain types. |
| **Server-state management** | tRPC + React Query is a clean, type-safe data layer — no Redux boilerplate. |
| **ML isolation** | All inference runs client-side; the server never needs GPU or ML dependencies. |
| **Schema** | Drizzle schema is small and well-typed; migrations are straightforward. |
| **YouTube pipeline** | yt-dlp integration is contained, validates URLs, and enforces a duration cap. |

### 1.3 Separation of concerns — current coupling risks

| Coupling | Severity | Detail |
|---|---|---|
| **Upload.tsx is the orchestrator** | **High** | `Upload.tsx` chains file upload → MediaPipe → swing analysis → ONNX classification → tRPC persist. This 180-line `runMediaPipeAndSave` callback mixes I/O, ML, progress UI, and persistence. It cannot be tested, reused from a Web Worker, or invoked from another entry point. |
| **Scoring ↔ feedback divergence** | **Medium** | `analyzeSwing()` scores phases with shot-type-specific ranges, but `getMetricFeedback()` only uses them if `loadedRanges` was previously cached. On the analysis replay page, `shotType` may not even be passed to `getMetricFeedback`, causing generic feedback for a shot that was scored with specific ranges. |
| **gapAnalyzer duplicates weights** | **Medium** | `METRIC_WEIGHTS` in `gapAnalyzer.ts` is a copy of the weight structure in `GENERIC_RANGES` from `swingAnalyzer.ts`. If one changes, the other silently drifts. |
| **shotClassifier hardcodes right wrist** | **Medium** | `findContactFrame()` always uses landmark index 16 (right wrist) regardless of the dominant side passed to `classifyShotType`. Left-dominant players get a misaligned contact window. |

### 1.4 Code quality & technical debt

#### Hardcoded magic numbers (scattered, not centralized)

| Value | Appears in | Should be |
|---|---|---|
| `15` (sample FPS) | `mediapipe.ts:63`, `swingAnalyzer.ts:389`, `SkeletonReplay.tsx`, `annotation.ts`, `proCompare.ts` | A single constant in `shared/types.ts` or a new `shared/constants.ts` |
| `500 * 1024 * 1024` (500 MB) | `Upload.tsx:196`, `upload.ts`, `index.ts:17` | Shared config constant |
| `300` (5 min YouTube cap) | `youtube.ts:108` | Named constant |
| `0.3` (shot confidence threshold) | `swingAnalyzer.ts:357` | Named constant |
| `64` (ONNX max frames) | `shotClassifier.ts:15` | Already named locally — good |

#### Missing error handling

| Location | Gap |
|---|---|
| **`mediapipe.ts`** | No timeout or retry if a seek never fires `onseeked`. A corrupt frame silently skips. No `landmarker.close()` cleanup on abort. |
| **`youtube.ts`** | yt-dlp failures surface as raw `execFile` error messages with no structured error codes. Partial downloads are not cleaned up. |
| **`shotClassifier.ts`** | Graceful fallback (`return null`) is good, but the `console.warn` is the only logging — no telemetry or persistent log. |
| **`swingAnalyzer.ts`** | `loadShotTypeRanges()` silently swallows fetch failures with an empty `catch {}`. |
| **Server routers** | No global tRPC error formatter; raw Zod errors reach the client. |

#### Redundant / dead code

| Item | Location |
|---|---|
| Duplicate `labels` map | `swingAnalyzer.ts:407-414` duplicates `METRIC_LABELS` from `shared/types.ts` |
| Unused import | `isNull` in `annotation.ts` |
| `distance()` defined twice | Once in `swingAnalyzer.ts:55`, once in `shotClassifier.ts:37` (different signatures — 2D vs 3D) |

#### State management observations

- No global client store. Analysis data lives in React Query cache, which is correct for server-derived data.
- `Analysis.tsx` keeps `currentFrameIdx` in local state while `VideoPlayer` maintains its own `currentFrame` — they sync via callback. This works but adds unnecessary re-renders. A shared ref or context would be cleaner.
- `Upload.tsx` manages 9 `useState` hooks. A `useReducer` would make state transitions (idle → selected → processing → done/error) explicit and less error-prone.

### 1.5 Scalability concerns

| Area | Limit | Impact |
|---|---|---|
| **Browser-only ML** | Processing a 2-min video at 15 FPS = 1,800 seek + detect cycles on the main thread. | UI freezes, no progress on mobile Safari. Cannot leverage server GPUs. |
| **JSON blob storage** | `landmarksJson` for 1,800 frames × 33 landmarks ≈ 2-3 MB per row, stored as a TEXT column. | SQLite reads the entire blob for any query touching `analyses`. List queries are unnecessarily heavy. |
| **No pagination** | `analysis.list` returns all rows with full JSON. | Will degrade once a user has 50+ analyses. |
| **Single-user, no auth** | No authentication or user scoping. | Fine for personal use; blocks any multi-user or hosted deployment. |

---

## 2. Three Architectural Milestones

### Milestone 1 — Extract the Analysis Pipeline (decouple ML from UI)

**Goal:** Move the MediaPipe → swing analysis → shot classification chain out of `Upload.tsx` into a standalone, testable service.

**Deliverables:**

1. **`client/src/lib/analysisPipeline.ts`** — A pure orchestration module:
   ```
   analyzePadelVideo(videoFile: File, opts: PipelineOptions): AsyncGenerator<PipelineEvent>
   ```
   Yields typed events (`progress`, `landmarks-ready`, `classification-done`, `analysis-complete`, `error`) so consumers can render UI however they want.

2. **Web Worker wrapper** (`client/src/lib/pipeline.worker.ts`) — Offloads MediaPipe + ONNX to a worker thread. The main thread receives events via `postMessage`. Eliminates UI freezes on long videos.

3. **Upload.tsx becomes a thin consumer** — Subscribes to pipeline events, updates progress UI, and calls `tRPC.analysis.create` on completion.

**Why first:** This is the highest-leverage change. It unblocks testability, worker-thread processing, and a future server-side processing option — all without touching the data model.

**Risk:** MediaPipe Tasks-Vision uses `HTMLVideoElement` and `OffscreenCanvas` APIs that may not be available in all Worker contexts. Spike this on Safari before committing.

---

### Milestone 2 — Consolidate Scoring Configuration & Fix Drift

**Goal:** Single source of truth for scoring ranges, metric weights, labels, and feedback — eliminating the silent drift between `swingAnalyzer`, `gapAnalyzer`, and `getMetricFeedback`.

**Deliverables:**

1. **`shared/scoring.ts`** — Canonical scoring configuration:
   - `SAMPLE_FPS` constant (currently duplicated as `15` in 5+ files)
   - `GENERIC_RANGES` (currently in `swingAnalyzer.ts`)
   - `METRIC_WEIGHTS` (currently duplicated in `gapAnalyzer.ts`)
   - `METRIC_LABELS` (currently in `shared/types.ts` — move here)
   - Confidence thresholds, file size limits, duration caps

2. **Refactor consumers** to import from `shared/scoring.ts`:
   - `swingAnalyzer.ts` — remove inline `GENERIC_RANGES`, import from shared
   - `gapAnalyzer.ts` — remove `METRIC_WEIGHTS`, import from shared
   - `getMetricFeedback()` — remove duplicate `labels` map
   - `mediapipe.ts`, `SkeletonReplay.tsx`, server routers — use `SAMPLE_FPS`

3. **Fix `findContactFrame` dominant-side bug** — Use the dominant-side wrist index instead of hardcoded right wrist (index 16).

**Why second:** This is a correctness issue that also reduces the chance of subtle scoring bugs as new shot types are added. Low risk, high confidence improvement.

---

### Milestone 3 — Normalize Data Storage & Add Pagination

**Goal:** Stop storing multi-megabyte JSON blobs inline with metadata. Add pagination so the app scales past 50 analyses.

**Deliverables:**

1. **Separate landmarks into a dedicated table or file-based storage:**
   - Option A: `analysis_landmarks` table with one row per frame (normalized, queryable).
   - Option B: Write landmarks to a `.json` file on disk (like video files), store only the path in SQLite.
   - Recommended: **Option B** for simplicity — landmarks are write-once, read-on-demand.

2. **`analysis.list` returns metadata only** — No `phasesJson` or `landmarksJson` in list queries. Fetch heavy data only in `getById`.

3. **Cursor-based pagination** on `analysis.list` — Use `id` as cursor, return pages of 20.

4. **Server-side `getById` returns landmarks via streaming or lazy load** — Client fetches landmarks only when the replay player mounts.

**Why third:** This is a data-layer change that requires a migration. It's important for scale but doesn't block any feature work in the short term. Do it before the analysis count grows.

---

## 3. Parking Lot (future considerations, not yet prioritized)

| Topic | Notes |
|---|---|
| **Server-side ML processing** | Move MediaPipe to a Node/Python worker for headless batch processing. Depends on Milestone 1 (pipeline extraction). |
| **Authentication & multi-user** | Add session-based auth or OAuth. Scope all data to user IDs. Required before any hosted deployment. |
| **Structured error handling** | Add a tRPC error formatter, define error codes, map yt-dlp failures to user-friendly messages. |
| **Observability** | Add structured logging (pino or similar) on the server. Add client-side error boundary with reporting. |
| **Testing** | Unit tests for `swingAnalyzer` scoring math, integration tests for tRPC routers, E2E for upload flow. Currently zero test coverage. |
| **PWA / offline** | Service worker, manifest, offline replay of cached analyses. |
| **Design system** | Formalize "Tennis Neon" tokens (colors, spacing, typography) into a `/docs` design system spec. Currently implicit in Tailwind classes. |

---

## 4. Architect Review Protocol

When you request a **"Senior Review"** or **"Architecture Check"** for a proposed feature or change, I will provide:

1. **Impact assessment** — Which files/layers are affected, risk of regressions
2. **Pros** — Benefits, alignment with milestones, simplicity
3. **Cons** — Coupling introduced, debt created, alternatives not explored
4. **Verdict** — Approve / Approve with conditions / Request redesign
5. **Follow-ups** — Cross-stream impacts, things to coordinate

No code changes will be made without your explicit approval for each file.
