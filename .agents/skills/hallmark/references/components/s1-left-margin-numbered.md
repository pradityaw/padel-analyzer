
### S1 · Left-margin numbered (vertical stack)
A mono-cap number or label (`01 — Foundations`) stacked **above** the section heading in a single column — never beside it.
*Use when:* the page is editorial / specimen and ordinal labels are genuinely needed (cap at 1–2 per page).
*Don't confuse with:* S5 Bottom-anchored (which puts the label *under* the section). Gate **66** bans tag-left / header-right two-column section heads.

```html
<header class="head-margin">
  <p class="num-label">01 — Foundations</p>
  <h2>…</h2>
</header>
```
```css
.head-margin { display: flex; flex-direction: column; gap: var(--space-sm); align-items: flex-start; }
.num-label { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; margin: 0; }
.head-margin h2 { margin: 0; min-width: 0; overflow-wrap: anywhere; }
```
