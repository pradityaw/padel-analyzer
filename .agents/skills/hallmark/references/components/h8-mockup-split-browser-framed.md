### H8 · Mockup Split (screenshot-led)
Headline left, product screenshot right, the mockup tilted 1–3° for life. **No hand-drawn browser chrome** — gate **57** forbids traffic-light dots and fake URL bars. Use a real screenshot in a `<figure>` with at most a hairline border, or a floating no-frame treatment.
*Use when:* you're selling a web app and you have a clean, well-lit screenshot.
*Don't confuse with:* H7 Clipped-Edge (which extends past the viewport) or H2 Split Diptych (which uses photography or proof column, not a product mockup).

```html
<section class="hero-mock">
  <div>
    <h1>The studio's new mute button.</h1>
    <p>Press <kbd>⌘ M</kbd> from anywhere.</p>
  </div>
  <figure class="mock">
    <img src="/screenshots/studio-mute.png" alt="Studio app with mute shortcut highlighted" />
  </figure>
</section>
```
```css
.hero-mock { display: grid; grid-template-columns: 1fr 1.2fr; gap: var(--space-2xl); align-items: center; }
.mock { margin: 0; transform: rotate(1.5deg); border: var(--rule-hair) solid var(--color-rule-2); border-radius: 12px; overflow: hidden; box-shadow: 0 24px 60px -20px oklch(20% 0.02 60 / 0.18); }
.mock img { display: block; width: 100%; height: auto; }
```

For device frames, use external tools (Browserframe, Ray.so) — do not redraw chrome in CSS. See [`assets.md` § App mockups](../assets.md).
