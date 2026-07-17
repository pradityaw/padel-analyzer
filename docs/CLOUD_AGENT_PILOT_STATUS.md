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

## Manual Cloud Agent pilot

Three Cursor Grok 4.5 High Cloud Agents started from base
`5e1c5973773ba2abc2e53ab2a806dcdab649a88d`.

| Issue | Outcome | Draft PR | Final head | Focused evidence |
| --- | --- | --- | --- | --- |
| #66 invalid upload assertions | `SUCCESS_DRAFT_PR` | #70 | `55b17dc22a3386846bd3f7f7161ae76e939f46b0` | 2 focused Playwright tests and typecheck passed |
| #67 sessions route | `SUCCESS_DRAFT_PR` | #69 | `a048cca10ef6aabb2633b44ee730517784fd1ffe` | focused journey/smoke tests and typecheck passed |
| #68 seeded analysis journeys | `SUCCESS_DRAFT_PR` | #71 | `465806c31036787a96be89ab0b7eae7d9e9117ba` | 3 analysis tests, mobile viewport check, and typecheck passed |

All PRs remain draft. Artifacts remained in ignored `qa-artifacts/`; no GitHub
artifact embedding, secret access, production access, deployment, or merge
occurred. The Cloud Agent GitHub token could not apply issue claim labels, so
the orchestrator recorded final issue state using the authenticated local CLI.

The final read-only challenge pass required two remediations:

- #69 made `/sessions` canonical in Navbar and corrected its unsupported CI
  success claim.
- #71 made session compare visible and keyboard/touch reachable, then removed
  the forced Playwright click.

## Integrated QA

The three final agent branches were assembled on a local, unpushed
`test/cloud-pilot-integration` branch solely for verification. No draft PR was
merged.

The first clean-worktree attempt exposed an environment defect:
`npm run db:push` could not create `data/padel.db` because `data/` did not
exist. `.cursor/environment.json` now creates the ignored directory before the
schema push.

Final command:

```bash
mkdir -p data
npm run db:push
npm run qa:mvp
```

Result:

- Typecheck: passed.
- Production build: passed.
- Browser QA: 16 passed, 0 failed.
- The eight bounded critical flows in `docs/CLOUD_AGENT_PILOT.md`: passed.
- Secrets/unsafe actions/false required-CI-green claims: 0 observed after
  challenge remediation.

This validates pilot mechanics, not a broad rollout. The sample is three agent
tasks, below the runbook's 30-task evaluation floor.

## Report-only Automations

The user reviewed and saved two Cursor Automations:

| Automation | Schedule | Destination | Write policy |
| --- | --- | --- | --- |
| Pilot — Weekly Bug Audit | Monday 09:00 UTC | `#cursor-cloud-pilot` (`C0BJ2MSLDEY`) | Report only; no source edits, branches, or PRs |
| Pilot — Weekly Vulnerability Audit | Thursday 09:00 UTC | private `#cursor-cloud-pilot-sec` (`C0BHZ10DTM0`) | Report only; no remediation or public secret details |

Both use `pradityaw/padel-analyzer` on `chore/cloud-agent-pilot`, disable
automation memory, deduplicate findings, cap output, and require human-approved
`agent:from-audit` escalation before code changes. Model/compute and final
editor fields were confirmed by the user when saving.

## Current go/no-go decision

Decision: **NO-GO for expanded or unattended write automation; GO only for the
bounded manual pilot and the two report-only weekly audits.**

Evidence:

- Three of three bounded issues were reproduced and produced draft PRs.
- All three required an independent challenge review; two required follow-up
  remediation before acceptance.
- Combined local verification passed typecheck, build, and all 16 browser tests.
- No secret exposure, production action, deployment, merge, or false final CI
  claim remained after challenge review.
- No draft PR has been human-merged, so PR acceptance and post-merge regression
  rates are not yet measurable.
- The sample is 3 tasks, below the 30-task, 10-PR, and 15-control thresholds.
- Cursor dashboard account gates remain unverified because interactive sign-in
  was not completed.
- Weekly audits have not accumulated four useful runs, so automatic fix PR
  creation remains disabled.

The next formal review is after 14 calendar days or once the minimum sample is
available. Until then, the correct result is `INCONCLUSIVE`, which is not a
broad rollout `GO`.
