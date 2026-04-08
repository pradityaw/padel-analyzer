# Padel Analyzer — Customer Journey

## Design Principles
- **Dark-first, neon-accented**: `bg-slate-950` base, padel-green upgraded to `#a3e635` (lime-400 neon)
- **Pro sports tool aesthetic**: data-dense but scannable, no clutter
- **Every screen has one hero action** — the eye always knows where to go next

---

## Stage 1 — Landing / Home  (/  →  History page)

### User Goal
Understand what this tool does and either start a new analysis or continue a previous one.

### Current State
Sessions list with a line chart (score progress) and session cards. Empty state has a CTA button.

### UX Improvements Proposed
- **Hero stat bar** at the top: total sessions, best score, most-used shot type (3 quick numbers)
- **Empty state upgrade**: Replace the plain icon with an animated skeleton figure doing a swing loop
- **Session cards**: Add shot-type pill badge and a mini phase-score bar (5 colored dots for each phase)
- **CTA**: "Analyze a Swing" button elevated to a sticky footer on mobile

### Visual Notes
- Score chart line → neon green stroke (`#a3e635`), grid lines dimmer
- Session cards → subtle left-border color-coded by top shot type

---

## Stage 2 — Video Submission  (/upload)

### User Goal
Get a video into the system as frictionlessly as possible.

### Entry Paths
1. **File upload** — drag/drop or file picker (.mp4, .mov, .webm, max 500 MB)
2. **YouTube link** — paste URL → preview card with thumbnail, title, duration

### Current State
Tab switcher (Upload / YouTube Link), drag zone, YouTube preview. Solid foundation.

### UX Improvements Proposed
- **"How it works" steps** → keep but upgrade icons to animated on-hover
- **Drag zone**: Add a pulsing neon-green border animation on drag-over
- **YouTube preview card**: Full-width, larger thumbnail (16:9), clearer metadata row
- **File selected state**: Show a video thumbnail preview (use `URL.createObjectURL`)
- **Micro-copy**: "Nothing leaves your device — all AI runs in your browser"

### Visual Notes
- Tab active state: neon-green underline + text glow
- CTA button: `bg-lime-400` text-black font-bold (high contrast, sport energy)

---

## Stage 3 — AI Processing  (processing overlay on /upload)

### User Goal
Trust that the analysis is working; stay engaged during the wait.

### Current State
Progress bar (0–100%) + small 320×240 canvas showing skeleton dots. Progress message text.

### UX Improvements Proposed
- **Enlarge processing canvas** to 480×360 or full-width — skeleton replay is compelling, make it the hero
- **Step indicator** (4 steps shown as a horizontal pill row):
  1. Saving video
  2. Detecting pose landmarks
  3. Classifying shot type
  4. Scoring phases
- **Animated background**: subtle slow-moving padel court grid lines
- **Real-time stats**: show "Frames processed: 142 / 300" counter alongside the %
- **Phase preview**: once phases are detected, show colored chips appearing one by one

### Visual Notes
- Progress bar: gradient from lime-400 → emerald-400, animated shimmer
- Step indicators: grey → lime with checkmark tick when complete

---

## Stage 4 — Analysis Dashboard  (/analysis/:id)

### User Goal
Understand exactly where their swing is strong and where to improve, matched to a specific video frame.

### Layout (5-column grid, lg breakpoint)
```text
┌────────────────────────────┬─────────────────┐
│  VIDEO PLAYER  (col 3/5)   │  SCORE CARD     │
│  + skeleton overlay        │  + SHOT TYPE    │
│  + phase HUD label         │  COACHING       │
├────────────────────────────│  INSIGHTS       │
│  PHASE TIMELINE (col 3/5)  │  METRICS        │
│                            │  PANEL          │
└────────────────────────────┴─────────────────┘
```

### Video Player Overlay Additions
- **Phase HUD chip**: floating top-left of the video, shows current phase name + color dot (e.g. 🟡 Forward Swing)
- **Phase progress bar**: thin colored strip under the video that advances with the active phase color
- **Contact flash**: brief white vignette flash when frame enters "contact" phase

### Phase Timeline Additions
- Phase segments are already color-coded — add score badge inside each segment chip
- Clicking a phase segment seeks video + highlights that phase's metrics in the panel

### Metrics Panel
- Group metrics under their phase header
- Metric bars: green/amber/red based on MetricStatus
- Add "vs ideal" small delta text: e.g. "Shoulder Rotation: 42° (+8° over ideal)"

### CoachingInsights Panel
- Wire in the existing (but unused) component
- Display after the phase timeline or alongside metrics
- Top 3 actionable tips from the analysis
- Each tip has a phase label pill and a severity icon

### Score Reveal
- On first load, animate the overall score counting up from 0 to final value
- Score ring: SVG arc that draws itself

---

## Stage 5 — Frame-by-Frame Scrub  (within Analysis page)

### User Goal
Step through the swing one frame at a time to identify exactly where a technical error occurs.

### Current State
Frame-step buttons (SkipBack/SkipForward) advance by 1 frame at the sample FPS. Skeleton overlay redraws.

### UX Improvements Proposed
- **Scrub bar**: replace the phase timeline with a dual-purpose scrub timeline — shows phase segments AND acts as a seek bar (click anywhere to jump)
- **Frame ghost**: at slow/paused state, ghost the previous 2 frames at 30% opacity to show motion trail
- **Speed selector**: upgrade from 3 speeds to 5 (0.1×, 0.25×, 0.5×, 1×, 2×)
- **Keyboard shortcuts**: Space = play/pause, ← → = step frame, 1–5 = jump to phase

---

## Stage 6 — Pro Comparison  (/pro-compare)

### User Goal
See exactly how far each phase metric is from a pro benchmark and get a prioritized improvement plan.

### Entry Point
"Compare with Pro" amber button in the Analysis header (already exists).

### UX Improvements Proposed
- **Side-by-side video** (player left / pro right) with synchronized phase scrubbing
- **Gap scoreboard**: ranked list of the top 5 metric gaps, color-coded by severity
- **Radar chart**: spider chart showing player vs pro across 6 metrics per phase
- **"Focus Area" CTA**: surfaces the single biggest gap as a highlighted callout card

---

## Stage 7 — History & Progress  (back to /)

### User Goal
Track improvement trend over multiple sessions.

### UX Improvements Proposed
- **Score trendline** already exists — add a "Personal Best" annotation
- **Shot-type filter pills**: filter session cards by shot type (Bandeja / Vibora / Smash etc.)
- **Quick compare**: checkbox on 2 cards → "Compare These" CTA appears
- **Export**: CSV download of all scores and phase metrics

---

## Color System Upgrade

| Token | Current | Proposed | Rationale |
|---|---|---|---|
| padel-green | `#16a34a` | `#a3e635` | Neon lime — sport energy, high contrast on dark |
| padel-gold | `#f59e0b` | unchanged | Keeps amber for pro/trophy accents |
| padel-surface | `#1e293b` | unchanged | Good depth |
| padel-dark | `#0f172a` | unchanged | Good base |

Accent neon green (`#a3e635`) maps to Tailwind's `lime-400`. It will be used for:
- Active states, CTA buttons, progress fills
- Score numbers and phase labels
- Skeleton joint highlights at contact phase

---

## Component Architecture

- `client/src/components/ui/` — Radix-based design primitives (Button, Badge, Progress, Tooltip)
- `client/src/components/PhaseHUD.tsx` — floating phase label overlay for VideoPlayer
- `client/src/components/ScoreRing.tsx` — animated SVG score arc
- `client/src/components/StepProgress.tsx` — 4-step processing indicator
- `client/src/components/RadarChart.tsx` — recharts radar for pro compare
- Wire `CoachingInsights.tsx` into `Analysis.tsx`