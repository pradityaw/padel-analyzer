# Bug reports

QA and testers file bugs here so engineering can triage **fix now** vs **defer** in a weekly bug review.

## Quick start

1. Copy [TEMPLATE.md](./TEMPLATE.md) to a new file: `BUG-###-short-slug.md` (increment `###`).
2. Fill every section — especially **repro steps**, **job/analysis ids**, and **severity**.
3. Attach screenshots to `docs/bug-reports/assets/` (optional) and link them from the report.
4. Open a PR or commit the report on your QA branch (these files **are** tracked in git).

## Naming

```text
docs/bug-reports/BUG-001-upload-spinner-never-stops.md
docs/bug-reports/BUG-002-analysis-reload-crash.md
docs/bug-reports/assets/BUG-001-screenshot.png
```

## Triage workflow (engineering)

Use labels in each report’s **Triage** section:

| Decision | Meaning |
|----------|---------|
| **fix-now** | Sev-1 or blocking beta; assign workstream (A/B/C/D from [AGENTS.md](../../AGENTS.md)) |
| **defer** | Valid bug; schedule after current milestone |
| **wontfix** | Out of scope ([BETA_SCOPE.md](../BETA_SCOPE.md)) or duplicate |
| **needs-info** | QA to re-run with logs / job id |

**Bug review agenda (suggested):**

1. All open **Sev-1** — must have owner or explicit waive
2. **Sev-2** — prioritize by user impact vs effort
3. **Sev-3** — backlog / icebox

Cross-reference [PRODUCT_BACKLOG.md](../../PRODUCT_BACKLOG.md) and [ARCHITECTURE_REVIEW.md](../../ARCHITECTURE_REVIEW.md) before duplicating known debt.

## Phase mapping

| Phase | QA doc | Typical bugs |
|-------|--------|--------------|
| 0 | [QA_PHASES_0_1.md](../QA_PHASES_0_1.md#phase-0--pre-flight--release-gates) | Gate failures, missing deps, CI red |
| 1 | [QA_PHASES_0_1.md](../QA_PHASES_0_1.md#phase-1--upload--analysis--replay) | Upload, job failure, replay, overlay sync |

## Slack / feedback bot

Informal feedback in Slack/Telegram is collected separately (`scripts/feedback-bot/`). For structured QA cycles, **still file a bug report here** so triage has a single checklist and severity.

## Index (maintain manually)

| ID | Title | Severity | Triage | Reported |
|----|-------|----------|--------|----------|
| — | Upload video (Slack burst-1779203975) — fixed in PR #13 | Sev-2 | verify | 2026-05-26 |
