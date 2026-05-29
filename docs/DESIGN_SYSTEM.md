# Tennis Neon — Design System

The canonical visual spec for the Padel Analyzer web client. The `architect.mdc`
rule requires that "any UI change must follow the Tennis Neon design system
defined in /docs" — this is that document.

Tennis Neon adopts the **Nike design language** (see
[reference/nike-DESIGN.md](./reference/nike-DESIGN.md), from
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md))
and ports its principles onto our **dark** product surface. We keep Nike's
structure and restraint, not its literal light palette: video frames and
skeleton overlays are our "editorial photography," and neon lime is used the way
Nike uses ink — scarcely, for the single most important action per view.

## Principles (ported from Nike)

1. **Extreme typographic contrast.** A towering uppercase display tier
   (Bebas Neue) for hero/score moments, and a quiet Inter UI tier (12–16px) for
   everything else. Almost no middle ground.
2. **Pill geometry everywhere.** Every CTA is a full pill (`--radius-button`).
   Icon controls are circular. There is no third button shape.
3. **Flat surfaces.** No drop shadows in chrome. Depth comes from 1px hairline
   dividers (`--color-hairline`) and full-bleed video.
4. **Accent restraint.** Lime `#a3e635` signals one primary action per viewport,
   plus scores and active state. Never decorative. Neutralize gradients.
5. **8px spacing system** with a **48px section rhythm** (`--space-section`)
   between major blocks.
6. **Kinetic tap feedback.** Buttons collapse slightly on press
   (`scale ~0.96`), echoing Nike's tap-collapse.

## Tokens

All tokens live in [`client/src/index.css`](../client/src/index.css) under
`@theme` and are consumed as Tailwind utilities or `var(--token)`.

### Color

| Token | Value | Use |
|---|---|---|
| `--color-padel-green` | `#a3e635` | Primary action, score >= 80, active nav |
| `--color-padel-green-deep` | `#84cc16` | Pressed / deep accent |
| `--color-padel-gold` | `#f59e0b` | Score 60–79, pro/trophy |
| `--color-padel-dark` | `#0f172a` | App background |
| `--color-padel-surface` | `#1e293b` | Cards, raised surfaces |
| `--color-padel-border` / `--color-hairline` | `#334155` | Borders, 1px dividers |
| `--color-text-primary` | `#f8fafc` | Headlines, primary text |
| `--color-text-secondary` | `#cbd5e1` | Body text |
| `--color-text-muted` | `#94a3b8` | Captions, metadata |

Semantic phase/shot colors live in `shared/types.ts` (`PHASE_COLORS`,
`SHOT_TYPE_COLORS`) and are intentionally out of the chrome palette.

### Radius

`--radius-button` / `--radius-pill` = `9999px` (all CTAs) ·
`--radius-card` = `16px` · `--radius-md` = `12px` · `--radius-sm` = `8px`.

### Spacing (8px base)

`--space-xs` 4 · `--space-sm` 8 · `--space-md` 12 · `--space-lg` 18 ·
`--space-xl` 24 · `--space-section` 48 · `--space-card` 20.

### Typography

- `--font-sans`: **Inter** (variable) — all UI text, weights 400/500/600/700.
- `--font-display`: **Bebas Neue** — the `.display` utility (uppercase, tight
  0.9 line-height). Reserve for hero headlines and large score numerals only.

## Components

- **Button** (`components/ui/Button.tsx`): pill geometry, variants
  `primary` (lime), `ghost` (hairline outline), `danger`; sizes `sm/md/lg`;
  `tapCollapse` on press; `iconCircular` for circular icon controls.
- **Card** (`components/ui/Card.tsx`): flat `--radius-card`, hairline border,
  no shadow.
- **Section** (`components/ui/Section.tsx`): 48px section rhythm, eyebrow +
  display title.
- **Navbar**: active section uses a 2px lime underline indicator, not a fill.

## Do / Don't

**Do** keep one primary lime action per fold · use `.display` only for hero and
score numerals · separate sections with `--space-section` and hairlines · keep
all CTAs pill-shaped.

**Don't** add drop shadows or card elevation · use lime for decorative chrome ·
introduce a third button shape · use the display face for body or nav text.
