# Product Backlog — Padel Analyzer

> Owned by the **PM Developer** agent. Updated as items are scoped, started, or completed.
>
> Sources: [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md) severity list, [`TECH_STRATEGY.md`](./TECH_STRATEGY.md) milestones.

---

## Now (current highest-priority remaining work)

| # | Item | Owner | Status | Ref |
|---|------|-------|--------|-----|
| 1 | ~~Rules of Hooks violation (`useMemo` after return)~~ | C | **Done** | Severity #1 |
| 2 | ~~JSON.parse without try/catch — crash on corrupt data (8+ files)~~ | B + C | **Done** | Severity #2 |
| 3 | ~~tRPC error formatter — raw errors leak to client~~ | B | **Done** | Severity #3 |
| 4 | ~~Input length limits on JSON string fields~~ | S → B | **Done** | Severity #4 |
| 5 | ~~Non-transactional annotation create + analysis update~~ | B | **Done** | Severity #5 |
| 6 | ~~TOCTOU race in YouTube download~~ | B | **Done** | Severity #6 |
| 7 | ~~N+1 queries in proCompare list and export~~ | B | **Done** | Severity #7 |
| 8 | ~~No pagination on `analysis.list` (returns all rows with JSON blobs)~~ | B | **Done** | Severity #8 |
| 9 | True worker offload for the analysis pipeline — `pipeline.worker.ts` exists, but full MediaPipe/ONNX execution still runs on the main thread because of DOM/runtime constraints | A | Partial | Milestone 1 |
| 10 | Persist “analysis in progress” and low-detection quality signals beyond sessionStorage so refresh/deep-link flows still show the right state | A + B + C | Open | UX gap |
| 11 | Normalize analysis data storage so list/replay scale beyond large JSON blobs in SQLite rows | B + S + C | Open | Milestone 3 |

---

## Next (current milestone deliverables)

### Milestone 1 — Extract the Analysis Pipeline

Goal: Decouple ML orchestration from `Upload.tsx` so it is testable, cancellable, and can run in a Web Worker.

| Deliverable | Owner | Status |
|-------------|-------|--------|
| `client/src/lib/analysisPipeline.ts` — AsyncGenerator orchestration | A | **Done** |
| `client/src/lib/pipeline.worker.ts` — Web Worker wrapper | A | **Partial** (capability probe + stub; not full offload) |
| `Upload.tsx` becomes a thin event consumer | A + C | **Done** |
| Abort/cancel button during processing | C | **Done** |
| Spike: MediaPipe in Worker on Safari | A | **Partial** (feature-detection and graceful fallback only; no verified Safari run) |
| Persist in-progress analysis state across navigation / reload | A + C | Open |
| Persist low-detection warning on the analysis record instead of sessionStorage-only handoff | S + B + C | Open |

### Milestone 2 — Consolidate Scoring Configuration

Goal: Single source of truth for ranges, weights, labels, feedback. Most constants already moved to `shared/config.ts`; remaining drift items below.

| Deliverable | Owner | Status |
|-------------|-------|--------|
| ~~Wire per-row `sampleFps` into exports (instead of global constant)~~ | B | **Done** |
| ~~Add `PHASE_ORDER` constant to `shared/config.ts`~~ | S | **Done** |
| ~~`findContactFrame` dominant-side bug~~ | A | **Done** (earlier session) |
| ~~Move magic numbers to `shared/config.ts`~~ | S | **Done** (earlier session) |
| Remaining phase-order/config duplication cleanup in adjacent modules when touched (`skillClassifier.ts`, other training helpers) | A + D | Open |

---

## Later (future milestones + medium/low-severity fixes)

### Milestone 3 — Normalize Data Storage & Add Pagination

| Deliverable | Owner | Status |
|-------------|-------|--------|
| Separate landmarks into file-based storage (write-once `.json`) | B + S | Not started |
| ~~`analysis.list` returns metadata only (no JSON blobs)~~ | B | **Done by default** (`phasesJson` optional, `landmarksJson` excluded) |
| ~~Cursor-based pagination on `analysis.list`~~ | B | **Done** |
| Lazy-load landmarks on replay player mount | C | Not started |

### Medium / low-severity fixes

| # | Item | Owner | Status | Ref |
|---|------|-------|--------|-----|
| 9 | ~~Missing `aria-label` on icon-only buttons~~ | C | **Done** | Severity #9 |
| 10 | ~~Inconsistent empty states (PhaseTimeline returns null)~~ | C | **Done** | Severity #10 |
| 11 | ~~Dead code (`annotated` variable)~~ | B | **Done** | Severity #11 |
| 12 | ~~Shimmer bar hardcodes hex instead of CSS variable~~ | C | **Done** | Severity #12 |
| 13 | ~~PhaseTimeline seek is mouse-only (no keyboard / `role="slider"`)~~ | C | **Done** | Severity #13 |
| — | ~~`MetricsPanel` tabs lack `role="tab"` / `aria-selected`~~ | C | **Done** | Review §3 |
| — | ~~`Navbar` icon-only links missing `aria-label` / screen-reader text on mobile~~ | C | **Done** | Review §3 |
| — | VideoPlayer keeps a black video stage for letterboxing; other surrounding surfaces now use theme tokens | C | Partial / acceptable | Review §3 |
| — | History selected shot-type pills still use `color: "#000"` for contrast on colored backgrounds | C | Low-priority polish | Review §3 |

### UX journey gaps (from ARCHITECTURE_REVIEW.md §3)

| Gap | Owner | Status |
|-----|-------|--------|
| ~~No "Processing Failed" recovery — must re-select video~~ | C | **Done** |
| No "Analysis in Progress" persistence (navigate away = lost) | A + C | Open |
| Video quality feedback now appears after upload via sessionStorage handoff; persistent replay/deep-link support still needs schema + storage | A → S/B → C | Partial |
| ~~YouTube duration check is server-only — client should pre-validate~~ | C + B | **Done** |

---

## Icebox (ideas not yet sized)

| Idea | Notes |
|------|-------|
| Server-side ML processing | Depends on Milestone 1 pipeline extraction |
| Authentication & multi-user | Required before any hosted deployment |
| Observability (structured logging, error boundaries) | Pino on server, error boundary on client |
| Testing (unit / integration / E2E) | Currently zero coverage |
| PWA / offline replay | Service worker + manifest |
| Formalize "Tennis Neon" design system | Move implicit Tailwind tokens into a `/docs` spec |
| Replay bookmarks / annotations on timeline | User request — not yet scoped |
| Side-by-side video comparison overlay | Extends existing `/compare` page |
| Shot-specific drill recommendations | Extends coaching panel with external content |

---

## Fresh Recommended Order

1. **Persist quality + in-progress state**  
   Add an analysis-level field for quality warnings / detection rate and define how in-progress jobs survive navigation or refresh.

2. **Finish Milestone 1 honestly**  
   Decide whether full worker offload is actually feasible with the current MediaPipe + DOM setup, or whether the extracted pipeline should remain main-thread with better UX and cancellation.

3. **Start Milestone 3**  
   Move heavy landmarks out of inline SQLite rows and keep replay data lazy-loaded.

4. **Low-risk polish**  
   History filter pill color cleanup and any remaining shared config dedupes when adjacent files are touched.

---

## Legend

- **Owner** uses workstream IDs from `AGENTS.md`: S (Shared), A (Pipeline), B (Server), C (UI), D (Tooling)
- **Done** = merged or applied in working tree
- **Open** = not started
- **Partial** = some work done, more remains
- Strikethrough (~~text~~) = completed
