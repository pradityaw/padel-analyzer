# Cloud Agent pilot status

Last updated: 2026-07-17

## Baseline

| Check | Result | Evidence |
| --- | --- | --- |
| Pilot repository | Pass | `pradityaw/padel-analyzer`, default branch `main` |
| Source-control permission | Pass | GitHub CLI authenticated with repository admin access |
| Isolated local branch | Pass | `chore/cloud-agent-pilot` worktree from `origin/main` |
| Deterministic install | Pass | `npm ci` completed from the committed lockfile |
| Typecheck | Pass | `npm run typecheck` |
| Build | Pass | `npm run build` |
| Test database setup | Pass | `npm run db:push` |
| Browser baseline | Fail | 10 passed, 6 failed; failures retained under ignored `qa-artifacts/` |
| Slack connection | Pass | Cursor Slack integration responded to channel discovery |
| Dedicated Slack channel | Pending | No existing `cursor-cloud-pilot` channel was found |
| Linear connection | Deferred | GitHub Issues is the pilot tracker |
| Cursor plan/spend limit | Blocked | Dashboard requires interactive sign-in |
| SCM selected-repo grant | Blocked | Dashboard requires interactive sign-in |
| Egress allowlist lock | Blocked | Dashboard requires interactive sign-in |
| Computer-use entitlement | Blocked | Dashboard requires interactive sign-in |
| Team follow-ups/artifact posting | Blocked | Dashboard requires interactive sign-in |

The blocked dashboard checks are hard readiness gates. Repository preparation
and local QA may continue, but no production access, automatic merge, or
unattended write Automation is permitted until they are confirmed.

## Initial browser evidence

Command:

```bash
npm run db:push
npm run qa:browser
```

Observed result: 10 passed and 6 failed.

Distinct pilot candidates:

1. Invalid upload tests expect obsolete copy; the UI now presents a different,
   more inclusive file-type message.
2. The "Back to sessions" action on a missing analysis navigates to `/` instead
   of `/sessions`.
3. Seeded analysis tests no longer match the redesigned analysis and home-page
   content/actions.

These candidates are suitable for three bounded reproduce-first dry runs. They
use generated fixtures, require no secrets, and do not touch deployment,
feedback, mobile, or production paths.
