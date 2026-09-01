<!-- Hallmark · design-system: design.md · genre: modern-minimal (dark, data-led sports)
 · studied: yes · DNA-source: image (Fixtured sports-schedule app concept, agency presentation shot — soft-refusal: DNA extracted, signature choices not reproduced)
 · theme: studied-DNA "Court Flood" — navy paper oklch(0.18 0.06 275) · royal-blue flood oklch(0.45 0.19 268) · white-pill CTAs
 · display: heavy condensed sans (Archivo Variable, wdth 62.5%, wght 800) · body: Geist Variable
 · supersedes: Tennis Neon (lime #a3e635 on slate) — retired 2026-06-10
 · pre-emit critique: P5 H5 E4 S5 R4 V5 -->

# Design — Padel Analyzer ("Court Flood")

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. The system is **studied DNA** extracted from a sports-schedule
app reference (image mode, 2026-06-10), adapted to this product's content and
honest-copy rules. It replaces the retired Tennis Neon palette.

## Provenance

- **Source mode:** image (user-attached screenshot of the "Fixtured" sports-schedule
  app concept — an agency presentation shot). Soft-refusal applied per `study.md`:
  structural DNA extracted; signature artwork, logo treatments, and illustrations
  are **not** reproduced.
- **Prior provenance (retired):** Strava URL study, 2026-06-03 — its structural DNA
  (stat-led headers, session ledgers, one-loud-number) is *kept*; its Tennis Neon
  palette is retired.
- **Confidence:** Tokens are estimated from source-image colour bands (image mode).
  Display face is role-based — "heavy condensed uppercase sans" — with Archivo
  (variable, condensed width) chosen from the free canon; the source's exact face
  could not be identified from a screenshot.

## Extracted DNA

1. **Dual-band surface system.** Deep navy paper for the app shell; a **saturated
   royal-blue flood** used as a *surface* (featured cards, score heroes, active
   detail headers) — brand colour as architecture, not garnish.
2. **White-pill CTA inversion.** Primary actions are white pills with dark navy
   ink. On a blue field, the inversion carries the hierarchy.
3. **Condensed display caps.** Heavy condensed uppercase headlines with tight
   leading; wide-tracked uppercase micro-labels; big tabular numerals for scores.
4. **Timeline ledger.** Left date rail (dot + hairline vertical line), compact
   result rows — title left, score right-aligned tabular.
5. **Colour-coded data cards.** Category encodes as a full card flood (the
   source's league cards → our shot-type cards). Data encoding, not brand accent.
6. **Scoreline hero.** Circular crests/avatars, one huge centred tabular score,
   micro-label above and below.
7. **Box-score table voice.** Hairline translucent rules on flood blue, white
   tabular figures.
8. **Pill-led radius language.** Buttons fully rounded; cards `rounded-2xl`;
   floating pill bottom nav on mobile.
9. **Fixtured surface kit (2026-06-10).** Glass pill bottom nav (`FloatingNav`);
   white ledger rows (`card-paper` on dark paper); one featured flood card per
   list; vertical date rail on History; horizontal circle shot-type strip; stacked
   overlapping flood cards on marketing/login splash; Tier-A sport textures on
   flood surfaces (`SportPattern`: mesh / diagonal / dots).

## Genre

modern-minimal — dark, data-led sports analytics with a flood-confident brand
band. No radial blooms, no generative gradients; data and the blue field carry it.

## Macrostructure family

Unchanged from the prior system — structure was never the problem:

- **App pages** (`Analysis` shell, `PadelVideoAnalyzer`): **Workbench** — video
  stage primary, sticky metrics rail. Header is a thin utility bar.
- **List / content pages** (`History`): **Stat-Led** — KPI strip → trend chart →
  filter rail → **timeline ledger** (date rail + result rows, per DNA #4).
- **Intake / action pages** (`Upload`): **Stat-Led intake** — honest steps rail →
  action surface → live processing ledger.
- **Marketing** (`Home`): navy band hero with condensed display caps + white-pill
  CTAs; no eyebrow-badge/gradient-wash AI stack.

## Theme — Court Flood (LOCKED)

| Role | Token | hex | oklch (approx) |
| --- | --- | --- | --- |
| paper (app bg) | `--color-paper` / `bg-paper` | `#0a0f2e` | `oklch(0.18 0.06 275)` |
| surface (card) | `--color-surface` | `#131a40` | `oklch(0.24 0.07 275)` |
| raised (stage/deepest) | `--color-raised` | `#070b22` | `oklch(0.14 0.05 275)` |
| rule (hairline) | `--color-rule` | `#28315e` | `oklch(0.32 0.07 275)` |
| **flood** (brand surface) | `--color-flood` | `#2b3fbd` | `oklch(0.45 0.19 268)` |
| flood-2 (pressed/deep) | `--color-flood-2` | `#2336a8` | `oklch(0.40 0.18 268)` |
| ink | `--color-ink` | `#f4f6ff` | `oklch(0.97 0.01 275)` |
| ink-2 (secondary) | `--color-ink-2` | `#aab3d6` | `oklch(0.76 0.05 275)` |
| muted (tertiary) | `--color-muted` | `#6b75a3` | `oklch(0.57 0.07 275)` |
| accent (links/active/hero number) | `--color-accent` | `#5b8cff` | `oklch(0.66 0.17 265)` |
| cta (primary pill) | `--color-cta` | `#ffffff` | `oklch(1 0 0)` |
| cta-ink | `--color-cta-ink` | `#0a0f2e` | — |
| sand (PB / pro) | `--color-sand` | `#e8c468` | `oklch(0.82 0.11 85)` |
| focus (ring) | `--color-accent` | `#5b8cff` | — |

**Colour discipline (replaces the ≤5% accent rule):**
- The **flood** is structural: at most **one flood surface per viewport** (the
  featured card, the score hero, or the active detail header — never several).
- The **accent** `#5b8cff` stays small: links, active tab/filter, the one hero
  metric per card, focus rings.
- **Sand** is reserved for personal-best / pro-comparison markers.
- On flood surfaces: white ink, `white/70` secondary, `white/10` translucent
  chips, `white/15` hairlines.
- `SHOT_TYPE_COLORS` are data encodings (DNA #5) — they may flood a card
  background but are not brand accents.

## Typography

Two families — condensed display + neutral body (amends the prior single-font rule).

- **Display:** `Archivo Variable`, `font-stretch: 62.5%` (condensed), weight 800,
  **uppercase**, `letter-spacing: 0.01em`, `line-height: 0.95`. Page H1s, hero
  statements, scoreline numerals' labels. Exposed as the `.font-display-condensed`
  utility / `font-display` token.
- **Body:** Geist Variable, weight 400–500.
- **Numeric:** Geist Variable + `font-variant-numeric: tabular-nums` for all
  scores, counts, durations (column alignment). Scoreline heroes use weight 800.
- **Label / eyebrow:** Geist Variable 600, uppercase, tracking `0.16em`, `text-xs`.
- **Type scale anchor:** `--text-display` = `clamp(2rem, 5vw, 3.25rem)` (condensed
  caps can run larger than the old system); hero metrics `clamp(1.75rem, 5vw, 2.5rem)`.

## Spacing

4-point scale (Tailwind steps). Cards: `p-4`/`p-5`, internal gaps `gap-2`/`gap-3`;
sections `gap-6`/`mb-6`. Tables inside cards are tight (`py-2` rows); cards
separate generously. No raw px in JSX styles except data-colour encodings.

## Radius

- Buttons / chips / nav: `rounded-full` (pill).
- Cards / surfaces: `rounded-2xl`.
- Inputs: `rounded-xl`.

## Motion

- **Library:** framer-motion (web); RN `Animated`/`Pressable` (mobile).
- **Easings:** `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; 220–350 ms.
- **Reveal:** one quiet entrance per view (`opacity` + small `y`), stagger ≤ 80 ms
  on KPI cards only. No per-card scroll reveals.
- **State motion:** `transform`/`opacity`/width only. No `whileHover={{ scale }}`.
- **Reduced motion:** collapse to ≤ 150 ms opacity crossfade.

## Microinteractions stance

- Silent success over celebratory toasts.
- Hover tooltips 800 ms; focus tooltips 0 ms.
- Destructive actions confirm before acting.
- Focus-visible ring ≥ 3:1 (`#5b8cff`), shown instantly, never animated.

## CTA voice

- **Primary:** white pill (`bg-cta text-cta-ink`), `rounded-full`, bold,
  `min-h-11`. Verb-led copy ("Analyze a swing"). Hover = slight dim
  (`hover:bg-white/90`), not scale.
- **Secondary:** translucent pill — `bg-white/10 text-ink border border-white/15`,
  hover `bg-white/15`. On paper surfaces: `border-rule bg-surface` variant.
- **Tertiary / pro:** sand-outline (`border-sand/40 text-sand`) reserved for
  pro-compare.

## Honest copy (hard rule — unchanged)

Never fabricate stats, counts, ratings, or testimonials. Real API-shaped fields
(`overallScore`, `frameCount`, `durationMs`, `shotType`, `createdAt`, aggregates
from the real list) or a labelled `—`. The source's "★★★★★ Dream sports app"
device is exactly what we do NOT carry over.

## Per-page allowances

- App pages: no decorative enrichment — the video stage and data carry the page.
  The flood surface (score hero / featured card) is structure, not enrichment.
- List pages: typography + the recharts trend chart only.
- Intake page: Tier-A CSS dropzone treatment (dashed rule, flood on drag-over).
- Marketing Home: navy band + condensed display caps + white pills; Tier-A CSS
  only (no stock imagery, no invented hero art, no re-drawn device chrome).

## What pages MUST share

- Archivo condensed display + Geist body roles above.
- The Court Flood palette and the one-flood-per-viewport discipline.
- The CTA voice (white pill primary / translucent secondary / sand pro).
- Stat-led rhythm: uppercase micro-label above a tabular hero number.
- Surface language: `bg-surface` cards, `border-rule` hairlines, `rounded-2xl`,
  pill buttons.

## What pages MAY differ on

- Macrostructure within the page-type family.
- Which surface carries the flood (featured card vs score hero vs none).
- Which KPIs are surfaced (per page's real data).

## Exports

Canonical runtime tokens live in `client/src/index.css` (web) and
`mobile/src/lib/theme.ts` (mobile).

### tokens.css
```css
:root {
  --color-paper:    oklch(0.18 0.06 275);   /* #0a0f2e navy paper   */
  --color-surface:  oklch(0.24 0.07 275);   /* #131a40 card         */
  --color-raised:   oklch(0.14 0.05 275);   /* #070b22 stage        */
  --color-rule:     oklch(0.32 0.07 275);   /* #28315e hairline     */
  --color-flood:    oklch(0.45 0.19 268);   /* #2b3fbd brand flood  */
  --color-flood-2:  oklch(0.40 0.18 268);   /* #2336a8 pressed      */
  --color-ink:      oklch(0.97 0.01 275);   /* #f4f6ff              */
  --color-ink-2:    oklch(0.76 0.05 275);   /* #aab3d6              */
  --color-muted:    oklch(0.57 0.07 275);   /* #6b75a3              */
  --color-accent:   oklch(0.66 0.17 265);   /* #5b8cff              */
  --color-cta:      oklch(1 0 0);           /* #ffffff white pill   */
  --color-cta-ink:  oklch(0.18 0.06 275);   /* #0a0f2e              */
  --color-sand:     oklch(0.82 0.11 85);    /* #e8c468 PB / pro     */
  --color-focus:    oklch(0.66 0.17 265);   /* #5b8cff              */

  --font-display: "Archivo Variable", system-ui, sans-serif; /* stretch 62.5%, wght 800, uppercase */
  --font-body:    "Geist Variable", system-ui, sans-serif;

  --space-2xs: 0.5rem; --space-xs: 0.75rem; --space-sm: 1rem;
  --space-md: 1.5rem;  --space-lg: 2rem;    --space-xl: 3rem;

  --text-display: clamp(2rem, 5vw, 3.25rem);
  --text-metric:  clamp(1.75rem, 5vw, 2.5rem);

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 220ms;
  --radius-card: 1rem; --radius-pill: 999px; --radius-input: 0.75rem;
}
```

### Tailwind v4 `@theme`
```css
@theme {
  --color-paper:    #0a0f2e;
  --color-surface:  #131a40;
  --color-raised:   #070b22;
  --color-rule:     #28315e;
  --color-flood:    #2b3fbd;
  --color-flood-2:  #2336a8;
  --color-ink:      #f4f6ff;
  --color-ink-2:    #aab3d6;
  --color-muted-2:  #6b75a3;
  --color-accent:   #5b8cff;
  --color-cta:      #ffffff;
  --color-cta-ink:  #0a0f2e;
  --color-sand:     #e8c468;
  --font-display: "Archivo Variable", system-ui, sans-serif;
  --font-body:    "Geist Variable", system-ui, sans-serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`
```json
{
  "color": {
    "paper":   { "$value": "#0a0f2e", "$type": "color" },
    "surface": { "$value": "#131a40", "$type": "color" },
    "rule":    { "$value": "#28315e", "$type": "color" },
    "flood":   { "$value": "#2b3fbd", "$type": "color" },
    "ink":     { "$value": "#f4f6ff", "$type": "color" },
    "accent":  { "$value": "#5b8cff", "$type": "color" },
    "cta":     { "$value": "#ffffff", "$type": "color" },
    "sand":    { "$value": "#e8c468", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Archivo Variable", "$type": "fontFamily" },
    "body":    { "$value": "Geist Variable", "$type": "fontFamily" }
  },
  "space": { "md": { "$value": "1.5rem", "$type": "dimension" } }
}
```

### shadcn/ui CSS variables
```css
:root {
  --background:          0.18 0.06 275;   /* paper    */
  --foreground:          0.97 0.01 275;   /* ink      */
  --primary:             1 0 0;           /* cta      */
  --primary-foreground:  0.18 0.06 275;   /* cta-ink  */
  --muted:               0.24 0.07 275;   /* surface  */
  --muted-foreground:    0.76 0.05 275;   /* ink-2    */
  --accent:              0.66 0.17 265;   /* accent   */
  --border:              0.32 0.07 275;   /* rule     */
  --input:               0.32 0.07 275;   /* rule     */
  --ring:                0.66 0.17 265;   /* focus    */
  --radius:              1rem;
}
```

## Notes — anti-patterns to NOT carry over

- No invented metrics / ratings / social proof (the source's "★★★★★" strip stays out).
- No multiple flood surfaces per viewport — one, or none.
- No `whileHover={{ scale }}` card zoom; border/background hover only.
- No third font; no lime `#a3e635` / slate `#0f172a` regressions (retired system).
- No re-drawn device chrome, no eyebrow-badge + gradient-wash hero stack.
- No shimmer-bar gradient animation; progress = width-animated solid bars.
