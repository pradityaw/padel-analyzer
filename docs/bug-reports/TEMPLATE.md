# BUG-000 — Short title

> Copy this file to `BUG-###-short-slug.md` and delete this note.

## Summary

One sentence: what is broken from the user’s perspective?

## Environment

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Reporter** | |
| **Phase** | 0 \| 1 |
| **Surface** | web \| mobile \| server \| CI |
| **Branch / commit** | |
| **OS / browser / device** | e.g. macOS, Chrome 136 / iPhone 15 iOS 18 |
| **API URL** | e.g. `http://localhost:3001` or Fly URL |

## Severity

- [ ] **Sev-1** — Blocks upload → analysis → replay (or Phase 0 gates)
- [ ] **Sev-2** — Degraded; workaround exists
- [ ] **Sev-3** — Polish / edge case

## Steps to reproduce

1.
2.
3.

## Expected result

What should happen?

## Actual result

What happened instead?

## Evidence

| Type | Link / path |
|------|-------------|
| Screenshot | `assets/BUG-000-....png` |
| Job id | `analysis_jobs.id =` |
| Analysis id | `analyses.id =` |
| Video | filename or YouTube URL |
| Server log | paste `[pipeline]` / `[analysis-stage]` lines |
| Console / network | paste or `qa-artifacts/...` |

## Diagnostic notes (optional)

- Stage failed (if known): ingestion \| court \| player \| ball \| aggregation
- `errorMessage` from job payload:
- Python / ffmpeg / yt-dlp issues?

## Workstream hint

- [ ] **A** — Client / UX (`client/src/`)
- [ ] **B** — Server / API (`server/`)
- [ ] **C** — Tooling / PWA
- [ ] **D** — ML / CV (`scripts/cv/`)

## Triage (engineering — do not fill at report time)

| Field | Value |
|-------|-------|
| **Decision** | fix-now \| defer \| wontfix \| needs-info |
| **Owner** | |
| **Target milestone / PR** | |
| **Notes** | |
