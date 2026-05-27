# Slack feedback templates

Copy these into your feedback channel (`#padel-testers` or equivalent). **Pin** the bug-report template so testers see it before posting.

## Pin: bug report template

```
Bug report (copy/paste):
• What I did: …
• Expected: …
• Actual: … (exact error text on screen)
• Device: e.g. iPhone 15 / Safari, Pixel / Chrome, or Expo Go
• Screenshot or short screen recording if possible
```

Structured QA cycles should also file [`docs/bug-reports/TEMPLATE.md`](./bug-reports/TEMPLATE.md) in git.

## Thread reply: upload fix verification (PR #13)

Use after merging an upload fix so testers confirm or send diagnostics:

```
PR #13 merged — please retry upload:
1. Open /upload → tap the dashed drop zone (not only drag-and-drop)
2. Pick a .mp4 and start analysis

If it still fails, reply here with:
• Device + browser (or Expo Go)
• Exact error banner text
• Network tab: status + response for POST /api/upload (or the failed request)
```

Post via CLI (requires `.env.feedback`):

```bash
npm run feedback:post-slack-retest
# or custom text:
node scripts/feedback-bot/post-slack-thread.mjs \
  --thread-id burst-1779203975.053489 \
  --text "Your message"
```

Pin the bug template to the channel:

```bash
npm run feedback:pin-slack-template
```

Then pin the bot message in Slack (⋯ → Pin to channel).
