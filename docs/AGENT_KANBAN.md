# Agent Kanban — Padel Analyzer

Use the Cursor Agent Kanban board to run Cloud Agents against this repo.

## Quick start

```bash
cd ~/Projects/agent-kanban
pnpm dev
```

Open **http://localhost:3001** and sign in with your Cursor API key (saved at `~/.agent-kanban/settings.json` if you chose "Remember").

## Repository

- **GitHub:** `pradityaw/padel-analyzer`
- **Repository ID in Kanban:** `https://github.com/pradityaw/padel-analyzer`

## Active cloud agent (2026-05-16)

| Field | Value |
|-------|-------|
| Agent ID | `bc-7d7f54a8-2482-47db-aaf1-badb7bbf4600` |
| Task | PRODUCT_BACKLOG Milestone 1, item 10 — persist in-progress analysis state |
| Status | Running (check board for updates) |
| PR | Appears on the card when the agent opens one |

## Sample prompts (from PRODUCT_BACKLOG.md)

Copy one of these into **New agent** → prompt:

1. **Item 10 (in progress):** Persist "analysis in progress" and low-detection quality signals beyond sessionStorage so refresh/deep-link flows still show the right state.

2. **Item 11:** Normalize analysis data storage so list/replay scale beyond large JSON blobs in SQLite rows.

3. **Milestone 1 — low detection:** Persist low-detection warning on the analysis record instead of sessionStorage-only handoff.

## Workflow

1. Pick an open item from [PRODUCT_BACKLOG.md](../PRODUCT_BACKLOG.md).
2. Create agent on the board → repo `pradityaw/padel-analyzer` → paste prompt.
3. Watch the card move: Running → Finished.
4. Open the PR link on the card → review → merge in GitHub.
