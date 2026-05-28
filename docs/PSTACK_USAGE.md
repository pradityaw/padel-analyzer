# Pstack usage — Padel Analyzer

[pstack](https://github.com/cursor/plugins/tree/main/pstack) is Lauren Tan’s (@poteto) Cursor plugin for rigorous agent workflows. This repo layers it **on top of** existing multi-workstream docs (`AGENTS.md`, pm-developer, architect gates).

## Install (once, global)

In any Cursor Agent chat:

```text
/add-plugin pstack
```

Also enable **cursor-team-kit** in **Cursor Settings → Plugins** (provides `/deslop`, `control-ui`, `control-cli`). pstack skills are cached under `~/.cursor/plugins/cache/cursor-public/` after install.

Reload the window after enabling plugins if `/poteto-mode` does not appear.

## When to use what

| You want… | Use |
|-----------|-----|
| Prioritise backlog, acceptance criteria, workstream routing | `@pm-developer` |
| Implement, fix bugs, perf, refactors | `/poteto-mode <task>` |
| Understand how code works | `/how` |
| Understand why something was built | `/why` |
| Boundary / type design before coding | `/architect` |
| Adversarial PR review | `/interrogate` |
| Long autonomous run | `/poteto-mode` + `/loop` |

Full playbook list: [pstack README](https://github.com/cursor/plugins/blob/main/pstack/README.md).

## Typical flow

1. **Scope** — `@pm-developer Item from PRODUCT_BACKLOG: #10` (or paste a feature idea).
2. **Copy** the `/poteto-mode` handoff block from the PM reply.
3. **New Agent chat** — paste the handoff; let poteto-mode pick the playbook and todos.
4. **Ship** — `/deslop` before commit; open PR; `/babysit` if you want CI triage.

Respect workstream boundaries and merge order from [AGENTS.md](../AGENTS.md).

## Copy-paste examples (padel-analyzer)

### Overlay / frame loop perf (Workstream A)

```text
/poteto-mode Workstream A. Perf: Analysis page overlay stutters on long videos. Run a CPU trace, find the hot path in the overlay worker / drawOverlay path, fix with measured before/after. Branch: feat/client-overlay-frame-budget. Out of scope: server/**, mobile/**. Verify: control-ui + qa-artifacts Playwright smoke.
```

### Server / YouTube pipeline bug (Workstream B)

```text
/poteto-mode Workstream B. Bug fix: YouTube download fails intermittently. Repro with yt-dlp on PATH, root-cause, fix with runtime evidence. Branch: feat/server-yt-download-retry. Out of scope: client/**. Verify: control-cli for server scripts; manual curl/tRPC check.
```

### Feedback-bot / triage script (Workstream C tooling)

```text
/poteto-mode Workstream C. Bug fix: Slack feedback triage script drops events on retry. Repro from scripts/feedback-bot/, fix root cause. Branch: chore/tooling-feedback-triage-retry. Out of scope: client/src/**, server/routers/**. Verify: control-cli.
```

### Cross-stream persistence (S → B → C)

```text
/poteto-mode Workstream S then B then C. Multi-phase plan: PRODUCT_BACKLOG #10 — persist in-progress analysis and low-detection signals on the analysis record. Shared types first, then server persistence, then client/sessionStorage removal. Branch: feat/server-analysis-progress-persist. Verify: control-ui end-to-end upload → analysis → refresh.
```

## Subagents

For delegated implementation work inside a playbook step, use:

```text
subagent_type: "poteto-agent"
```

Not `generalPurpose` — poteto-agent loads poteto-mode principles first.

## Reuse on future projects

1. `/add-plugin pstack` once globally.
2. Copy the **Pstack execution** section from `AGENTS.md` and `.cursor/rules/pstack-execution.mdc`.
3. Adjust the playbook → ownership table for that repo.
4. Optional later: `/automate-me` for a personal routing skill on top of pstack.

## Smoke test

Step-by-step script: [PSTACK_SMOKE_TEST.md](./PSTACK_SMOKE_TEST.md).

After setup, run this once:

- [ ] `/poteto-mode` appears in skill picker
- [ ] `@pm-developer` scopes PRODUCT_BACKLOG **#10** and returns a `/poteto-mode` handoff
- [ ] New chat with that handoff opens a todo list (principles read first)
- [ ] Agent stays within declared workstream paths
- [ ] Verification mentions `control-ui` or `control-cli` as appropriate

Pilot backlog item for smoke test: **#10 — Persist analysis in-progress state beyond sessionStorage** ([PRODUCT_BACKLOG.md](../PRODUCT_BACKLOG.md)).
