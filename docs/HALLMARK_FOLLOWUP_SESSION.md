# Hallmark follow-up session — paste into a new Cursor chat

**Persistent memory:** project rule `.cursor/rules/hallmark-design-handoff.mdc` · user rule `~/.cursor/rules/padel-analyzer-hallmark.mdc` (applies when workspace path contains `padel-analyzer`).

Copy everything inside the fenced block below into a new agent chat when continuing UI work.

---

```
Workstream: A (client) + mobile screens only — see AGENTS.md
Branch: feat/client-hallmark-followup (or your current branch)

## Context (already done — do not redo)

Hallmark skill is installed at `.agents/skills/hallmark`. A multi-wave pass completed 2026-06-03:

- **design.md** at repo root — LOCKED Tennis Neon palette (#a3e635 padel-green on #0f172a / #1e293b). Read it before any UI emit. Strava study used a fallback (no CSS from URL); DNA is structure/type/rhythm from sports-app patterns.
- **Redesigned:** `client/src/pages/History.tsx`, `Upload.tsx`, `Analysis.tsx` (page shell only), `client/src/components/PadelVideoAnalyzer.tsx`, `mobile/src/screens/HistoryScreen.tsx`.
- **Preserved:** all routes, tRPC wiring, VideoPlayer + overlay worker, PadelVideoAnalyzer props, honest copy (no invented stats).
- **Mobbin:** not used (paid). Do not add Mobbin-dependent workflows.
- **Typecheck:** `npm run typecheck` and `npm run mobile:typecheck` should pass.

Project rules: `.cursor/rules/hallmark-design-handoff.mdc`, `docs/ANALYZER_DASHBOARD_HANDOFF.md`.

Preview: `npm run dev` → http://localhost:3001/ and http://localhost:3001/analysis/demo

## Your task (pick one or stack in order)

### Priority A — Polish analyzer dashboard
1. Migrate `client/src/components/analyzer/AnalyzerFilterPanel.tsx` to `@/components/ui/accordion` and `toggle-group` per design.md (component-scope Hallmark; 8 states on toggles).
2. Replace `AnalyzerScoreOverlay` placeholders (`You` / `Op`) with real match/session fields when available from tRPC — or labelled `—` placeholders, never fake scores.
3. Visual QA at 375px and 1280px on `/analysis/demo` and a real `/analysis/:id` if one exists.

### Priority B — Sessions UX
1. `History.tsx` delete flow: optimistic remove + toast Undo (replace `confirm()`), per design.md microinteraction stance.
2. Align `client/src/components/Layout.tsx` / global nav with design.md (uppercase eyebrows, tabular-nums where relevant) without changing routes.

### Priority C — Mobile parity
1. Bring `mobile/src/screens/UploadScreen.tsx` and `AnalysisScreen.tsx` in line with design.md (stat-led / workbench patterns; RN StyleSheet only).
2. Keep demo path working (`isDemoAnalysisId` / sample data).

## Constraints (non-negotiable)

- Read `design.md` first; extend it if the system grows — do not ignore it.
- Tennis Neon colours only; no Strava orange / purple-gradient slop.
- Hallmark honest-copy: no invented metrics, testimonials, or social proof.
- Do not touch `shared/*`, `server/`, `drizzle/`, or `client/src/lib/` analysis pipeline unless fixing a shared contract bug.
- State files you will modify before editing; no deletions without explicit approval.
- Run `npm run typecheck` and `npm run mobile:typecheck` before finishing.

## Deliverables

- Focused PR-sized diff with a short summary of what changed and which Hallmark gates you satisfied.
- If you amend the design system, update `design.md` Provenance/Notes section.
```

---

## Optional one-liners

- **Audit only:** `hallmark audit client/src/components/analyzer/ — punch list only, no edits`
- **Single screen:** `hallmark redesign client/src/components/Layout.tsx — read design.md first, shell/nav only`
