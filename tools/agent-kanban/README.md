# Agent Kanban (Padel Analyzer)

Local Linear-style board for **Cursor Cloud Agents** against `pradityaw/padel-analyzer`.

Padel-specific workflow, guardrails, and backlog prompts: **[docs/AGENT_KANBAN.md](../../docs/AGENT_KANBAN.md)**.

## Quick start

From repo root:

```bash
npm run agent-kanban:install   # first time only (uses pnpm)
npm run agent-kanban:dev
```

Or from this directory:

```bash
pnpm install
pnpm dev
```

Open **http://localhost:3010** and sign in with a Cursor API key from the [integrations dashboard](https://cursor.com/dashboard/integrations). With "Remember" checked, the key is stored at `~/.agent-kanban/settings.json`.

> **Ports:** main app **3001** · Kanban **3010**

## Prompt templates

Copy a scoped prompt into the **Create cloud agent** dialog:

```bash
pnpm prompt -- --task m1-worker-offload-spike
pnpm prompt:list
```

From repo root: `npm run agent-kanban:prompt -- --task m2-config-dedup`

Templates live in `prompts/`; shared guardrails in `prompts/_guardrails.md`. Repo defaults in `config/padel-analyzer.json`.

## What this app does

- API-key onboarding before any Cloud Agent data loads
- Kanban columns grouped by status, repository, or created date
- Agent cards with PR links and artifact previews
- Create-agent flow via `Agent.create({ cloud: { repos } })`
- Authenticated artifact media proxied through local API routes

## Notes

Repository listing is rate-limited and cached briefly in memory. Refresh the board if previews stop loading. This tool is dev-only — not part of the production app runtime.
