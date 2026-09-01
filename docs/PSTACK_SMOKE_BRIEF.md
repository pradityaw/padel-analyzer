# Pstack smoke brief — PRODUCT_BACKLOG #10

PM scoping output for validating `@pm-developer` → `/poteto-mode` handoff. Implementation tracked in code; use this as the reference handoff.

## Feature: Persist analysis progress and quality signals

**Problem:** Leaving `/upload` during server processing loses job context. Low pose-detection warnings are not stored on the analysis record for replay or deep links.

**Users affected:** All users running upload/YouTube analysis.

### Acceptance criteria

- [ ] Refreshing or returning to `/upload` resumes polling an in-flight `analysis_jobs` row when one was started this browser session.
- [ ] Completed analyses store `poseDetectionRate` and `qualityWarning` on the `analyses` row when detection is below threshold.
- [ ] `/analysis/:id` shows a dismissible low-detection banner from API data (no `sessionStorage`).
- [ ] Analysis replay loads landmarks via `analysis.getLandmarks` after metadata loads (lazy landmarks).

### Workstream assignment

| Stream | Scope |
|--------|--------|
| S | `qualityWarning` + `poseDetectionRate` on shared schemas and `analyses` table |
| B | Persist fields in `analysisJobProcessor`; `getLandmarks` procedure |
| C | Upload job resume (`localStorage`); Analysis banner + deferred landmarks query |

### Dependencies

- Merge order: S → B → C
- Requires `pstack` + `cursor-team-kit` plugins enabled

### Architect review required?

Yes — touches `shared/schema.ts`, `drizzle/schema.ts`, and cross-stream client/server flow.

---

## Handoff (paste into a new Agent chat)

```text
/poteto-mode Workstream S then B then C. Multi-phase plan: PRODUCT_BACKLOG #10 — persist in-progress analysis job resume on Upload and store pose quality on the analysis record. Shared schema + migration first, server persistence + getLandmarks, then client resume + Analysis banner without sessionStorage.

Branch: feat/analysis-progress-persist
Out of scope: mobile/**, training/**, feedback-bot/**
Depends on: drizzle migration applied (npx drizzle-kit push)
Acceptance criteria:
- [ ] Upload resumes in-flight job after refresh via stored job id + mobileAnalysis.getProgress
- [ ] analyses.poseDetectionRate + analyses.qualityWarning set on job completion
- [ ] Analysis page shows low-detection banner from API; landmarks via analysis.getLandmarks
Verify: control-ui upload → wait → refresh upload → still shows progress; open analysis → banner when qualityWarning is low_detection
```
