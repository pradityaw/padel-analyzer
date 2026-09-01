# Mobile vs Web Parity Audit

Branch: `feat/mobile-record-mode-ui` · Phase 3 (Mobile)
Compared: `mobile/src/screens/` vs `client/src/pages/` (web routes in `client/src/App.tsx`)

## Screen inventory

| Web page (route) | Mobile screen | Status |
|---|---|---|
| Home (`/`) | HomeScreen | present |
| Upload (`/upload`) | UploadScreen + RecordScreen + SetupWizardScreen | present (mobile splits intake into upload / record / wizard) |
| Analysis (`/analysis/:id`) | AnalysisScreen | present (partial — see gaps) |
| Annotate (`/annotate`) | — | **MISSING** |
| Compare (`/compare`) | CompareScreen | present (partial — see gaps) |
| History (default `/`) | HistoryScreen | present |
| ProCompare (`/pro-compare`) | ProCompareScreen | present (partial — see gaps) |
| Login (`/login`) | LoginScreen | present |
| Privacy (`/privacy`) | PrivacyScreen | present |

Mobile-only screens (no web equivalent, not gaps): RecordScreen, SetupWizardScreen, JobStatusScreen.

## Parity gaps (mobile < web)

1. **Annotate — entirely absent on mobile.** Web `/annotate` runs the labeling flow against `trpc.annotation.*` (`unannotated` queue, `list`, `stats`, `create`). There is no mobile screen, no nav entry, and `api.ts` has no annotation helpers. Mobile users cannot label shots or contribute to the annotation dataset.

2. **ProCompare — list-only; no create or visualize.** Web `ProCompare.tsx` builds the comparison (radar/polar chart, phase-sync slider, pro overlay, download). Mobile `ProCompareScreen.tsx` only lists previously-saved comparisons and deep-links into the player's `Analysis` screen. Mobile cannot create a comparison or render the radar / phase-sync view.

3. **Compare — deltas only, no side-by-side visualization.** Web `Compare.tsx` renders detailed side-by-side metrics and overlays. Mobile `CompareScreen.tsx` shows only phase-score deltas (A minus B per phase) — no side-by-side skeleton/video overlay, no per-metric table.

4. **Analysis — match-CV feature surface dead on mobile.** `AnalysisScreen.tsx` hard-gates the whole match-analysis section behind `MATCH_CV_ENABLED = false`, so rallies, heatmap (`MobileHeatmap`), condensed-rally video toggle, and match scoring are never rendered. The code exists but is unreachable. Racket-speed overlay is explicitly web-only (AnalysisScreen surfaces a hint: "Racket speed is web-only in this beta").

5. **Analysis — no Annotate entry point.** Web reaches annotation from the analysis context; mobile AnalysisScreen has no path to label the current swing.

## Record-mode status (branch focus: `feat/mobile-record-mode-ui`)

The record → upload → analysis flow is **complete and type-clean**. No small blocking gaps found:

- `SetupWizardScreen` collects mode → framing → court-alignment → reminders, then `navigation.replace("Record", { mode, courtCorners, alignedInWizard: true })`.
- `RecordScreen` consumes `route.params` (`mode`, `courtCorners`, `alignedInWizard`), runs camera alignment + countdown + 30s cap, then `useClip()` → `uploadVideoAsset()` → `createMobileAnalysisJob({ ...uploaded, courtCorners, mode })` → `navigation.replace("JobStatus", { jobId })`.
- `HomeScreen` "Record a swing" enters Record with the last saved mode and wizard-aligned corners.
- Supporting libs are wired: `recordMode.ts` (`saveLastRecordMode` / `RECORD_MODE_LABELS`), `courtCorners.ts` (`normalizeCourtCornersForApi` rounds dims for server Zod), `api.ts` (`uploadVideoAsset`, `createMobileAnalysisJob`).

`loadLastRecordMode` is used by Upload + Home for picked-from-library clips, so the selected mode propagates even outside the record path. No typecheck errors in this flow; no edits were required.

## QA harness — is agent-device QA runnable?

**Yes, runnable.** Verified on 2026-06-18:

- `npm run mobile:typecheck` → **pass** (exit 0, before and after this phase).
- `mobile/scripts/ios-simulator.sh` → boots the simulator and opens Expo Go. Metro is running on `:8081` (`curl http://127.0.0.1:8081/status` → `packager-status:running`). An iOS 26.0 simulator (`iPhone 16e`, UDID `5E8716E1…`) reports **Booted**, and Expo Go opened to `exp://127.0.0.1:8081`.
- QA docs present: `docs/MOBILE_DEVICE_QA.md`, `docs/AGENT_DEVICE_SETUP.md`, `docs/AGENT_DEVICE_SMOKE.md`, plus `docs/agent-device-artifacts/`.

**Blocking caveats for full device QA (not blockers for launching the harness):**

- `mobile/scripts/ios-simulator.sh` has **no `status` subcommand** — it ignores `$1` and always runs the full boot+open flow. So `ios-simulator.sh status` does not *report* status; it *launches*. To check state without launching, inspect Metro (`curl …/status`) and `xcrun simctl list devices booted` directly.
- Requires full Xcode (not just CLT) at `/Applications/Xcode.app`; the script sets `DEVELOPER_DIR` to work around this.
- The 6-step checklist in `MOBILE_DEVICE_QA.md` (demo / upload / completed→analysis / missing-tracking / backend-down / physical-device) requires a reachable API (`npm run dev` on `:3001`) and `EXPO_PUBLIC_API_BASE_URL` set in `mobile/.env`. Steps 5–6 (backend-down + real physical device) are manual and not automatable headless.
- Match-CV-dependent checklist steps (ball trajectory on JobStatus) depend on CV deps being installed server-side; otherwise the empty-`ballTracking` path is what gets exercised.
