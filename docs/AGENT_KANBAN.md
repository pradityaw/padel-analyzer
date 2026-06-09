# Agent Kanban — Padel Analyzer

Run Cursor Cloud Agents against this repo from a local Kanban board.

## Location

The board lives at **`tools/agent-kanban`** inside this repo (not a separate project).

## Quick start

From repo root:

```bash
npm run agent-kanban:install   # first time only
npm run agent-kanban:dev
```

Or:

```bash
cd tools/agent-kanban
pnpm install
pnpm dev
```

Open **http://localhost:3010** and sign in with your Cursor API key (saved at `~/.agent-kanban/settings.json` if you chose "Remember").

> **Ports:** padel-analyzer dev server uses **3001**; Agent Kanban uses **3010**.

## Repository defaults

| Field | Value |
|-------|-------|
| GitHub | `pradityaw/padel-analyzer` |
| Kanban repository picker | `https://github.com/pradityaw/padel-analyzer` |
| Branch | `main` |

Config file: `tools/agent-kanban/config/padel-analyzer.json`.

## Orchestrator workflow

1. Pick an open item from [PRODUCT_BACKLOG.md](../PRODUCT_BACKLOG.md).
2. Print a scoped prompt (optional): `npm run agent-kanban:prompt -- --task <name>` — see table below.
3. In Kanban: **Create cloud agent** → repo `pradityaw/padel-analyzer` → paste prompt → branch `main`.
4. Watch the card: Queued → Running → Finished → PR link.
5. Review the PR diff (reject Flask rewrites or mass deletions) → merge on GitHub.

List templates: `npm run agent-kanban:prompt:list`.

## Prompt guardrails (avoid PR #2-style failures)

- Stack: React + Vite + Express + tRPC + Drizzle — **not** Python/Flask
- Branch: `main`
- One backlog item per agent
- Do not delete `client/`, `server/`, `shared/`, `mobile/`
- Require `npm run typecheck` before opening PR
- Respect workstream ownership in [AGENTS.md](../AGENTS.md)

Shared footer is appended automatically by `print-prompt.mjs` from `tools/agent-kanban/prompts/_guardrails.md`.

## Prompt templates (current open work)

| Task key | Backlog | Workstream |
|----------|---------|------------|
| `m1-worker-offload-spike` | #9 — worker offload (partial) | A |
| `m2-config-dedup` | M2 — phase-order / config dedup | A + D |
| `quality-warning-persist` | UX — quality warning on replay | S → B → C |

```bash
npm run agent-kanban:prompt -- --task m1-worker-offload-spike
```

Copy stdout into the Kanban create-agent prompt field.

## Related tooling

| Tool | When to use |
|------|-------------|
| **Agent Kanban** (this doc) | Visual board, PR cards, artifact previews, spawning cloud agents |
| **`npm run cursor-sdk -- --task …`** | Local SDK agents with fixed review/fix prompts — see [scripts/cursor-sdk/README.md](../scripts/cursor-sdk/README.md) |
| **`npm run feedback:triage`** | Telegram/Slack tester feedback → cloud PRs |

## Orchestrator run log (2026-06-08)

Historical — items 10/11 and lazy replay landed in the working tree. Review any duplicate PRs from these agents before merging.

| Phase | Kanban agent ID |
|-------|-----------------|
| Item 10 — job resume | `bc-fab8e25a-adbf-415d-bd08-6943069e4fa6` |
| Item 11 — file landmarks | `bc-0387e5c5-2784-42df-838b-db93ce922322` |
| Lazy replay | `bc-ced16e4f-af1c-4c1e-9647-655a472150bd` |

See [PRODUCT_BACKLOG.md](../PRODUCT_BACKLOG.md) for the full roadmap.
