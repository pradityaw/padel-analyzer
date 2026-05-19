# Cursor SDK MVP Runner

This is development tooling for finalizing Padel Analyzer into an MVP. It is not part of the production app runtime.

The runner starts local Cursor SDK agents against the active app worktree and feeds them reusable prompts for review, fixes, QA, and deployment planning.

## Setup

Set a Cursor API key in your shell:

```bash
export CURSOR_API_KEY="your_cursor_api_key"
```

Optional settings:

```bash
export CURSOR_MODEL="composer-2"
export PADEL_APP_CWD="/Users/dubski/padel-analyzer/.claude/worktrees/zen-wescoff"
```

If `PADEL_APP_CWD` is not set, the runner uses the repo root, then falls back to `.claude/worktrees/zen-wescoff` when it exists.

## Commands

List available tasks:

```bash
npm run cursor-sdk:list
```

Preview a prompt without calling Cursor:

```bash
npm run cursor-sdk -- --task mvp-scan --dry-run
```

Run a task:

```bash
npm run cursor-sdk -- --task mvp-scan
npm run cursor-sdk -- --task fix-critical
npm run cursor-sdk -- --task browser-qa
npm run cursor-sdk -- --task feedback-review
npm run cursor-sdk -- --task ux-review
npm run cursor-sdk -- --task qa-release
npm run cursor-sdk -- --task deploy-check
npm run cursor-sdk -- --task architect-review
```

If a local SDK run gets wedged after a crash:

```bash
npm run cursor-sdk -- --task qa-release --force
```

## Supervised background watcher

Run QA automatically when you save files (debounced). By default it **reports only** on failure; it does **not** call the Cursor SDK unless you opt in.

**One-shot cycle** (runs `qa:browser` or `qa:mvp` based on changed paths; with no prior changes, runs `qa:browser`):

```bash
npm run cursor-sdk:qa-once
```

**Watch mode** (keeps running until Ctrl+C):

```bash
npm run cursor-sdk:watch
```

**Watch + auto-fix** (after a failing QA run, invokes `browser-qa` via the SDK — requires `CURSOR_API_KEY`):

```bash
export CURSOR_API_KEY="your_key"
npm run cursor-sdk:watch -- --auto-fix
```

Outputs:

- **Report**: `.cursor-sdk-runs/latest-background-report.md` (human-readable summary + truncated logs)
- **Lock**: `.cursor-sdk-runs/watch.lock` (prevents overlapping runs; stale locks expire after ~45 minutes or if the PID is dead)
- **Queued rerun**: `.cursor-sdk-runs/pending-rerun` if a run was skipped because another was active

**Which QA command runs?**

- `npm run qa:mvp` if changes touch `server/`, `shared/`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `drizzle.config.ts`, or `playwright.config.ts`
- Otherwise `npm run qa:browser` (e.g. `client/` or `e2e/` only)

The watcher never commits, pushes, or resets git state.

## Self-test and feedback loop

Run a richer browser self-test and collect structured artifacts:

```bash
npm run qa:self-test
```

This is local and free. It runs Playwright journey tests, then writes:

- `qa-artifacts/latest-feedback-input.json`
- `qa-artifacts/latest-feedback-report.md`
- console/network/screenshot/trace/video artifacts under `qa-artifacts/`

Ask the Cursor SDK to review the latest self-test evidence:

```bash
export CURSOR_API_KEY="your_key"
npm run cursor-sdk:feedback-review
```

Or run the full local self-test and then the feedback agent in one command (requires `CURSOR_API_KEY` for the SDK step):

```bash
export CURSOR_API_KEY="your_key"
npm run cursor-sdk:self-test
```

This consumes Cursor API usage. The `feedback-review` task is report-first: it should prioritize bugs, UX friction, missing states, and test gaps without editing code unless you explicitly ask for implementation.

## Telegram feedback loop (testers → cloud PRs)

Tester messages land in a Telegram group; a daily job drains updates, groups them into threads, runs **cloud** Cursor SDK agents with `feedback-implement`, and opens GitHub PRs (you review and merge).

See **[scripts/feedback-bot/README.md](../feedback-bot/README.md)** for BotFather setup, env vars, and caps.

```bash
npm run feedback:collect     # drain Telegram → qa-artifacts/feedback/inbox.jsonl
npm run feedback:dry-run     # print thread bundles (no SDK / no Telegram post)
npm run feedback:triage      # collect + cloud agents + Telegram summary
```

Manual prompt test (local SDK, optional bundle JSON):

```bash
export CURSOR_API_KEY="your_key"
export FEEDBACK_BUNDLE_JSON='{"thread_id":"burst-1","repo_url":"https://github.com/pradityaw/padel-analyzer.git","messages":[{"update_id":1,"message_id":1,"text":"Fix navbar","ts":"","from":{"id":1},"media":[]}]}'
npm run cursor-sdk -- --task feedback-implement --dry-run
```

Scheduled runs: [.github/workflows/feedback-triage.yml](../../.github/workflows/feedback-triage.yml).

**Slack:** same pipeline via `npm run feedback:triage-slack` — see [scripts/feedback-bot/README.md](../feedback-bot/README.md#slack-feedback--cursor-sdk-pr-pipeline) and [.github/workflows/feedback-triage-slack.yml](../../.github/workflows/feedback-triage-slack.yml).

## UI/UX customer journey review

Run the dedicated UI/UX review agent:

```bash
export CURSOR_API_KEY="your_key"
npm run cursor-sdk:ux-review
```

The `ux-review` task reviews the app's customer journey and UI system, and may research public design inspiration patterns from sports analytics, coaching, fitness, and modern SaaS products. It should borrow concepts only, not copy proprietary assets or exact designs. It is report-first by default.

## Recommended MVP Loop

1. Run `mvp-scan` to get the current blocker list.
2. Run `fix-critical` for one narrow blocker at a time.
3. Review the diff manually in Cursor.
4. Run the local checks:

```bash
npm run typecheck
npm run build
npm run qa:self-test
```

5. Run `feedback-review` when you want SDK analysis of the self-test artifacts.
6. Run `ux-review` when you want customer journey/design recommendations.
7. Run `qa-release` before calling the build a release candidate.
8. Run `deploy-check` when choosing the hosting/deployment target.
9. Run `architect-review` as the final gate before merging or deploying.

## Logs

Each SDK run writes JSONL events to `.cursor-sdk-runs/` at the repo root. Treat these as local diagnostics; do not commit them.

## Safety Notes

- Do not commit `CURSOR_API_KEY` or any other secrets.
- Do not run broad tasks when the working tree has unrelated user edits.
- Keep each SDK run scoped to one workstream from `AGENTS.md`.
- The SDK runner accelerates review and implementation loops; it does not make the production app depend on Cursor.
- `qa:self-test` is local and free; `cursor-sdk:*` commands consume Cursor API usage.
- `feedback-review` and `ux-review` are advisory/report-first unless you explicitly ask the agent to implement findings.
