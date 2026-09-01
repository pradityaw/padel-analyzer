# Analyzer dashboard — handoff (2026-05-30)

Context for continuing work in another Cursor agent/chat on this repo.

## What was built

The **SwingVision-inspired analysis dashboard** is implemented. There is no route file named `PadelVideoAnalyzer.tsx` — the **component** is `client/src/components/PadelVideoAnalyzer.tsx`, rendered from `client/src/pages/Analysis.tsx` at `/analysis/:id`.

### Layout

- **Left:** Rally playback toggle → court calibration bar → **16:9 video stage** (`VideoPlayer` with `forceAspectRatio={16/9}`) → `PhaseTimeline`
- **Right (`xl+`, 360px sticky):** `AnalyzerFilterPanel` → score + `ShotTypeBadge` + Pro Compare → `SwingCoachingPanel` → `MetricsPanel`

### New / moved files

| Path | Purpose |
|------|---------|
| `client/src/components/PadelVideoAnalyzer.tsx` | Orchestrator layout |
| `client/src/components/analyzer/AnalyzerFilterPanel.tsx` | Players / stroke / spin filters |
| `client/src/components/analyzer/AnalyzerScoreOverlay.tsx` | HUD on video stage |
| `client/src/components/analyzer/RallyPlaybackToggle.tsx` | Full vs Only Rallies |
| `client/src/components/analyzer/ShotTypeBadge.tsx` | Shot type + annotation |

### VideoPlayer props added

- `forceAspectRatio` — cinematic 16:9 stage
- `suppressPhaseBadge` — avoids duplicate phase pill when HUD is shown
- `stageOverlay` — renders `AnalyzerScoreOverlay` inside the stage (not over transport controls)
- `fillParent` — optional; current layout uses `stageOverlay` instead

### shadcn / MCP

- `.cursor/mcp.json` includes `shadcn` MCP (`npx shadcn@latest mcp`)
- `components.json` at repo root; shadcn init completed
- Added: `client/src/components/ui/accordion.tsx`, `toggle.tsx`, `toggle-group.tsx`, `scroll-area.tsx`, `separator.tsx`
- **`AnalyzerFilterPanel` uses shadcn** `@/components/ui/accordion` and `toggle-group` (base-ui) with padel theme classes

### Dependencies

- `@radix-ui/react-accordion`, `@radix-ui/react-toggle-group` in `package.json`

## Not done yet (follow-ups)

1. ~~**Migrate `AnalyzerFilterPanel`**~~ — done (`accordion`, `toggle-group`).
2. ~~**Wire filters (partial)**~~ — `selectedPlayerIds` → `VideoPlayer` racket track + HUD label; stroke filters → overlay dim/highlight + seek to contact when enabling matching type; spin → disabled preview until API exists
3. **Real match scores** in `AnalyzerScoreOverlay` (currently `You` / `Op` placeholders)
4. **Visual QA** on `/analysis/:id` at desktop + tablet widths
5. Resolve any **Button.tsx vs button.tsx** overlap from shadcn init on case-insensitive macOS if imports break

## Workstream

- **A — Client / analysis UX** only (`client/src/**`). Do not touch `shared/*` or server unless adding filter contracts.

## Verify

```bash
npm run typecheck
npm run dev   # http://localhost:3001/analysis/:id
```

## Design inputs

- SwingVision capture summary: `docs/agent-device-artifacts/flow/FLOW_SUMMARY.md`, `docs/competitor_qa.md`
- Tokens: `client/src/index.css` (`padel-green`, `padel-surface`, `padel-border`)
- Stroke types: `shared/types.ts` (`vibora`, `bandeja`, `smash`, …)
