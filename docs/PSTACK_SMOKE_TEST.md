# Pstack smoke test — run once after install

Run these steps in order after `/add-plugin pstack` and enabling **cursor-team-kit** in Settings → Plugins.

## 1. Plugin check

In Agent chat, type `/poteto` and confirm **poteto-mode** appears in the skill list.

## 2. PM scoping

Use the pre-written brief in [PSTACK_SMOKE_BRIEF.md](./PSTACK_SMOKE_BRIEF.md), or run:

```text
@pm-developer Item from PRODUCT_BACKLOG: #10 — persist in-progress analysis state beyond sessionStorage. Scope only; no code.
```

**Expect:** Feature brief, workstream assignment (S → B → C), and a ready-to-paste `/poteto-mode` handoff block at the end.

## 3. Implementation (new chat)

Open a **new** Agent chat. Paste the handoff from [PSTACK_SMOKE_BRIEF.md](./PSTACK_SMOKE_BRIEF.md) (or [PSTACK_USAGE.md](./PSTACK_USAGE.md#cross-stream-persistence-s--b--c)).

**Expect:**

- Todo list opens; first item references reading principles
- Work stays in declared paths (`shared/`, `server/`, then `client/` as scoped)
- Verification plan mentions `control-ui` for the upload → analysis flow

## 4. Stop before merge

Cancel or stop the agent after it confirms the playbook and workstream plan. Full implementation is not required for smoke test pass.

## Pass criteria

| Check | Pass? |
|-------|-------|
| `/poteto-mode` skill available | |
| pm-developer returns `/poteto-mode` handoff | |
| New chat respects workstream / out-of-scope | |
| Verification surface named (control-ui / control-cli) | |
