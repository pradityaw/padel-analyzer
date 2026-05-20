# Beta program — recruitment and exit criteria

**Product scope for this milestone:** see [BETA_SCOPE.md](./BETA_SCOPE.md) (Mobile Swing Replay Beta).

## Recruitment checklist

- [ ] Publish a short landing promise: upload a swing, get pose-based feedback in under a minute.
- [ ] Recruit 15–30 active padel players (mix of club + recreational) who can record in good lighting.
- [ ] Collect Telegram handles or email for a single feedback channel (see `scripts/feedback-bot/` for the triage helper).
- [ ] Confirm each tester can reach your hosted URL over HTTPS (or provide a Fly app URL + `AUTH_MODE` instructions).
- [ ] Share a one-page “what to try” list: upload, history, compare, optional YouTube flow on web.
- [ ] Set expectations: ball overlay is best-effort; racket speed is web-only until mobile follow-up ([BETA_SCOPE.md](./BETA_SCOPE.md)).

## Feedback loop

- Prefer **Telegram** (or Slack) for rapid screenshots and “this felt wrong” notes; point testers at `scripts/feedback-bot/README.md` for how you ingest issues.
- Run `npm run feedback:collect` / `npm run feedback:triage` on a schedule during the beta window.

## Exit criteria (ready to widen beta or prep store)

- [ ] **Release gates**: `npm run release:beta-gates` passes on the release branch.
- [ ] **Stability**: no Sev-1 crashes on upload → analysis → replay for web + mobile happy path.
- [ ] **Auth (hosted)**: magic-link sign-in works with `AUTH_MODE=on`, sessions persist, logout clears cookie.
- [ ] **Data**: SQLite + volume backups documented; optional Postgres path reviewed (`docs/POSTGRES.md`).
- [ ] **Quality**: low pose-detection banner is understood by testers; median pose-detection rate acceptable on real clips.
- [ ] **Privacy**: `/privacy` reviewed and linked from the app; retention expectations communicated.
- [ ] **Mobile**: internal EAS build (`preview` / `development` profiles in `mobile/eas.json`) verified on one iOS + one Android device against the hosted API ([MOBILE_DEVICE_QA.md](./MOBILE_DEVICE_QA.md)).
- [ ] **Tracking artifacts**: Fly/volume retains `data/analysis-agents/` (or tracking is empty by design after redeploy — document for testers).

When all boxes are checked, move to a wider beta or start store paperwork (screenshots, support URL, review notes).

## Pre-ship commands

```bash
npm run release:beta-gates
```

Optional: `npm run qa:browser` with server + `AUTH_MODE=off` per Playwright config.
