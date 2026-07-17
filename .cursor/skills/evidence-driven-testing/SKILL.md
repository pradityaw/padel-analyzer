---
name: evidence-driven-testing
description: Reproduce and verify Padel Analyzer behavior with sanitized, commit-bound browser evidence.
---

# Evidence-driven testing

Use this skill for every Cloud Agent bug reproduction, fix verification, and
browser QA task in this repository.

## Required inputs

- Testable expected behavior and observed behavior.
- Issue or task reference.
- Exact base and head commit SHAs.
- Explicit in-scope paths and exclusions.

## Safety boundary

- Use the local Cloud Agent checkout and port 3001 only.
- Never run `hosted:*`, Fly deployment, PM2 daemon, mobile build, feedback-bot,
  Slack-posting, or auto-merge commands.
- Never read, print, copy, record, or commit `.env*`, credentials, production
  data, `data/*.db`, uploads, tokens, or user media.
- Use generated or seeded fixtures only.
- Stop with `NEEDS_SECRETS` if verification requires a credential that was not
  explicitly provisioned as a staging-only runtime secret.
- Never merge, mark a PR ready, force-push, or bypass branch protection.

## Workflow

1. Record the base SHA, environment, test target, and reproduction plan.
2. Reproduce before editing. Run no more than three honest attempts or 25
   minutes. If the issue is not reproduced, stop with `CANNOT_REPRODUCE`.
3. Capture the exact command, exit code, and a short failure excerpt. Do not
   invent or paraphrase logs as if they were observed.
4. Implement only the smallest in-scope fix. Add a regression test when the
   affected area already has a test seam.
5. Run the failing test again, then the relevant broader check. Required CI or
   local checks remain authoritative over visual evidence.
6. For UI behavior, use Playwright or computer use against port 3001. Capture
   only the meaningful state change; keep notifications and sensitive data out
   of frame.
7. Review every screenshot or recording before sharing it.

## Evidence report

Always report:

- Issue/task and run ID.
- Base SHA and tested head SHA.
- Environment and commands with exit codes.
- Before result and after result.
- Assertions classified as `passed`, `failed`, `blocked`, or `untested`.
- Artifact paths or links, with any privacy caveat.
- CI status and any checks not run.
- Residual risk and human next action.
- Final stop code.

Allowed stop codes:

`SUCCESS_DRAFT_PR`, `CANNOT_REPRODUCE`, `AMBIGUOUS_SPEC`, `NEEDS_SECRETS`,
`OUT_OF_SCOPE`, `DEDUPED`, `CLAIM_CONFLICT`, `CI_UNRESOLVED`,
`REVIEW_NEEDS_HUMAN`, `TOO_LARGE`, and `SECURITY_ESCALATE`.

## Artifact policy

- Prefer Playwright traces, screenshots, and video retained on failure.
- Do not embed artifacts in GitHub until the repository owner accepts that
  embedded Cloud Agent artifacts use unauthenticated, unguessable URLs.
- A video demonstrates the UI path; it does not prove backend state or replace
  tests and CI.
