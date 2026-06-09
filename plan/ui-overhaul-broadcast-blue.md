# UI/UX Overhaul — "Court Flood" rebrand (supersedes Broadcast Blue)

> **2026-06-10 amendment:** after sign-off the user supplied a reference (Fixtured
> sports-schedule app shot) via `hallmark study`. The extracted DNA replaces the
> Broadcast Blue tokens below with the **Court Flood** system now locked in
> `design.md`: navy paper `#0a0f2e`, royal-blue flood surfaces `#2b3fbd`
> (max one per viewport), accent `#5b8cff`, **white-pill CTAs** (`#fff` on navy
> ink), sand `#e8c468`, and a second font — Archivo Variable condensed 800
> uppercase for display. Radius language becomes pill buttons + `rounded-2xl`
> cards. Scope, phases, risks, and gates below are unchanged; wherever the table
> below says Broadcast Blue values, `design.md` wins.

**Status:** executing
**Date:** 2026-06-10
**Workstream:** A (client UI + mobile screens) · design.md amendment at root
**Verb:** `hallmark redesign` (multi-page, design.md-managed flow)

## Goal

Kill the vibe-coded feel for good. Replace the Tennis Neon palette (lime `#a3e635`
on slate — the most fingerprinted AI-dashboard combo) with the **Broadcast Blue**
system the user selected, rebuild the broken token foundation, remove the remaining
AI-fingerprint chrome (N1 navbar, canonical AI hero, shimmer-bar), and sweep every
web page + mobile screen through the locked system. Features, routes, data
contracts, and component APIs stay untouched.

## Decisions (user-confirmed)

1. **Palette:** full rebrand → **B · Broadcast Blue** (court blue on graphite).
2. **Scope:** entire web app (marketing + app pages + shared components) **and**
   mobile screens, in this pass.
3. **June-3 redesigned pages** (History, Upload, Analysis, PadelVideoAnalyzer,
   mobile HistoryScreen): re-token sweep + accent-discipline fixes, **structure kept**.

## The locked system — Broadcast Blue

DNA (structure/type/rhythm) from design.md is preserved: stat-led headers,
chronological ledgers, one loud number per card, tabular numerals, Workbench /
Stat-Led macrostructure families. Only the colour system and the fingerprinted
chrome change.

| Role | Hex | OKLCH (approx) | Replaces |
| --- | --- | --- | --- |
| paper (app bg) | `#0b1014` | `oklch(0.16 0.012 240)` | `#0f172a` padel-dark |
| surface (card) | `#141b22` | `oklch(0.22 0.018 245)` | `#1e293b` padel-surface |
| raised (stage) | `#070b0f` | `oklch(0.13 0.012 240)` | `#0b1220` |
| rule (border) | `#263039` | `oklch(0.31 0.02 240)` | `#334155` padel-border |
| ink | `#f1f5f9` | `oklch(0.97 0.005 240)` | slate-50 |
| ink-2 | `#94a3b2` | `oklch(0.71 0.02 240)` | slate-400 |
| muted | `#5e6c7a` | `oklch(0.52 0.025 240)` | slate-500 |
| **accent** | `#41a4ff` | `oklch(0.69 0.16 250)` | `#a3e635` padel-green |
| accent-ink | `#04101c` | — | black |
| sand (PB/pro) | `#e3c06b` | `oklch(0.81 0.10 85)` | `#f59e0b` padel-gold |
| focus | `#41a4ff` | — | padel-green |

- **Accent discipline:** court blue ≤ ~5% of any viewport — one hero metric per
  card, primary CTA fill, active tab/filter, focus ring. Nothing else.
- **Sand** replaces gold for personal-best / pro markers (warm trophy tone against
  the cool field).
- Typography (Geist roles), spacing, motion stance, CTA voice: unchanged from
  design.md — they were never the problem.
- `SHOT_TYPE_COLORS` and skeleton-joint colours are **data encodings, not brand** —
  reviewed for contrast against the new surfaces but not auto-swept.

## Architecture

1. **Web token foundation (`client/src/index.css`)** — currently the default
   *light* shadcn gray theme with 6 padel-* colours bolted on; pages paint
   `bg-padel-dark` manually. Rebuild dark-first: semantic `@theme` tokens
   (`--color-paper`, `--color-surface`, `--color-raised`, `--color-rule`,
   `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-accent`,
   `--color-accent-ink`, `--color-sand`) + all shadcn `:root` vars mapped to them.
   `body` gets paper bg by default — pages stop hand-painting backgrounds.
   Old `padel-*` token names are **removed**, not aliased (a token named "green"
   holding blue is debt); every consumer is swept in the same pass.
2. **Canvas-draw colours (`client/src/lib/uiColors.ts`, new)** — single constants
   module for runtime `ctx.strokeStyle` / overlay hexes (VideoPlayer, skeleton
   players, court overlays) so brand colours exist in exactly one place per
   platform. Not a pipeline module — UI constants only.
3. **Mobile theme (`mobile/src/lib/theme.ts`, new)** — mobile currently hardcodes
   `#a3e635` inline in all 11 screens + `App.tsx` nav theme. Create one theme
   module mirroring the web tokens; sweep screens/components to consume it.
4. **design.md** — amend in place: new Theme table, sand-for-gold rule, chrome
   archetype changes, refreshed Exports (tokens.css / Tailwind / DTCG / shadcn).
   Provenance and DNA sections stay.

## Top 3 risks & mitigations

1. **~50 files carry hardcoded `padel-*` / `slate-*` utilities; a partial sweep
   leaves a two-brand Frankenstein.**
   → Mitigation: mechanical sweep per file with a hard grep gate at the end —
   `rg "#a3e635|padel-green|padel-dark|padel-surface|padel-border|padel-gold"`
   must return zero hits in `client/` and `mobile/` (excluding data-colour
   modules explicitly listed below). Slate text utilities (`text-slate-400` etc.)
   are replaced by semantic ink tokens in the same file visit.
2. **Rewiring shadcn `:root` vars from light-gray to dark Broadcast Blue can break
   shadcn-consuming components** (accordion, toggle-group, scroll-area, separator)
   that currently render on the unthemed defaults.
   → Mitigation: map every shadcn var to the new palette deliberately (not
   mechanically), then verify each shadcn component in the browser on
   `/app/upload` and `/app/analysis/demo` before moving past Phase 1.
3. **Canvas/overlay drawing code breaks silently** — colours live in JS strings,
   not CSS, so the type-checker won't catch a missed swap, and overlay legibility
   against real video is a contrast judgement, not a token swap.
   → Mitigation: centralize in `uiColors.ts` first, sweep draws to import it,
   then visually verify skeleton/court overlays on the demo analysis with
   screenshots before sign-off. Joint/limb data colours keep high-vis values
   chosen for video contrast (chalk white / court blue), independent of brand.

## Edge cases

- **Focus rings:** `#41a4ff` on paper `#0b1014` ≈ 7:1 — passes ≥3:1; verify on
  surface and raised too.
- **Accent-ink:** white text on `#41a4ff` fails contrast; CTA text uses
  `#04101c` (near-black blue) — sweep every `text-black`-on-accent instance.
- **PB/gold markers:** every `padel-gold`/amber usage becomes sand; ProCompare's
  pro-tier gold outlines included.
- **shimmer-bar:** deleted (gradient shimmer is a named tell); progress states use
  width-animated solid accent bars per design.md motion rules.
- **Demo/sample data** (`sampleAnalysis.ts` both platforms): visual constants only
  if any; types/data untouched.
- **Reduced motion:** unchanged stance, re-verified after chrome rebuilds.
- **Mobile dark nav:** `App.tsx` React Navigation theme re-pointed to theme.ts.

## Task checklist

### Phase 1 — Foundation (web)
- [ ] Amend `design.md`: Broadcast Blue theme table, sand rule, chrome archetypes, Exports
- [ ] Rebuild `client/src/index.css`: semantic @theme tokens, dark-first shadcn vars, body paper bg, delete shimmer-bar
- [ ] Create `client/src/lib/uiColors.ts` (canvas-draw constants)
- [ ] Verify shadcn components render correctly (risk 2 gate)

### Phase 2 — Chrome (web)
- [ ] `Navbar.tsx` — redesign away from N1 fingerprint (wordmark + text links, active = accent underline rail, no per-link icons)
- [ ] `components/home/MarketingNav.tsx` — same voice
- [ ] `ui/Button.tsx`, `ui/Badge.tsx`, `ui/Card.tsx`, `ui/Section.tsx`, `ui/SkeletonCard.tsx`, `ui/Stepper.tsx` — re-token

### Phase 3 — Marketing surface
- [ ] `home/Hero.tsx` — restructure: kill eyebrow-badge + accent-span-headline + gradient-wash stack
- [ ] `home/HowItWorks.tsx`, `home/PosePreview.tsx`, `home/TrustStrip.tsx`, `home/RecentSessionsTeaser.tsx`
- [ ] `pages/Home.tsx` (28-line composition — verify rhythm)

### Phase 4 — Untouched app pages
- [ ] `pages/Login.tsx` (+ loading spinner)
- [ ] `pages/Privacy.tsx`
- [ ] `pages/Compare.tsx`
- [ ] `pages/ProCompare.tsx` (784 lines — largest single page)
- [ ] `pages/Annotate.tsx`

### Phase 5 — Re-token sweep (June-3 pages, structure kept)
- [ ] `pages/History.tsx`
- [ ] `pages/Upload.tsx` (1145 lines)
- [ ] `pages/Analysis.tsx`
- [ ] `components/PadelVideoAnalyzer.tsx` + `analyzer/*` (FilterPanel, ScoreOverlay, RallyPlaybackToggle, ShotTypeBadge)

### Phase 6 — Shared components (web)
- [ ] `VideoPlayer.tsx` (1023 lines, canvas draws → uiColors)
- [ ] `SkeletonReplay.tsx`, `FrameSkeletonPlayer.tsx`, `CourtCalibrationOverlay.tsx`, `CourtHeatmapOverlay.tsx`
- [ ] `ScoreCard.tsx`, `ScoreReveal.tsx`, `SwingRing.tsx`, `WeeklyGoal.tsx`
- [ ] `CoachingInsights.tsx`, `SwingCoachingPanel.tsx`, `CoachMarks.tsx`, `MetricsPanel.tsx`, `PhaseTimeline.tsx`, `RallyTimeline.tsx`

### Phase 7 — Mobile
- [ ] Create `mobile/src/lib/theme.ts` (Broadcast Blue tokens)
- [ ] `mobile/App.tsx` navigation theme
- [ ] 11 screens: Home, History, Upload, Analysis, Compare, ProCompare, Record, JobStatus, Login, Privacy, SetupWizard
- [ ] 5 components: NavGrid, SectionCard, SkeletonPreview, RecordModeBadge, CourtAlignmentOverlay

### Phase 8 — Verification & bookkeeping
- [ ] Grep gate: zero `#a3e635` / `padel-*` token hits outside data-colour allowlist
- [ ] `npm run typecheck && npm run mobile:typecheck`
- [ ] Browser pass: every web route at 375 / 768 / 1280 px — screenshots, slop-test gates (no horizontal scroll, focus rings, accent ≤5%)
- [ ] Overlay legibility check on `/app/analysis/demo` (risk 3 gate)
- [ ] Hallmark stamps + single `.hallmark/log.json` entry (`scope: app`)
- [ ] Update `.cursor/rules/padel-analyzer-hallmark.mdc` memory (palette no longer Tennis Neon)

## Out of scope

- Any feature, route, data-contract, or pipeline change (`shared/*`, `server/*`,
  `client/src/lib/` analysis modules — except the new `uiColors.ts` constants file)
- The deferred UX follow-ups from June 3 (FilterPanel accordion migration,
  optimistic delete + Undo, real match scores) — separate tasks
- New pages, copy rewrites beyond removing fabricated/placeholder slop

## Verification steps

```bash
npm run typecheck && npm run mobile:typecheck
rg "#a3e635|padel-green|padel-dark|padel-surface|padel-border|padel-gold" client mobile
npm run dev   # http://localhost:3001 — walk every route, check /app/analysis/demo
```
