# MVP Readiness Scan

You are helping finalize Padel Analyzer into a live MVP.

Act as a senior engineer doing a scoped readiness scan. Read the repo first, especially:
- `AGENTS.md`
- `TECH_STRATEGY.md`
- `ARCHITECTURE_REVIEW.md`
- `package.json`
- `server/**`
- `client/src/pages/**`
- `client/src/components/**`
- `client/src/lib/**`
- `shared/**`

Goals:
1. Identify the smallest set of blockers that could prevent a useful MVP launch.
2. Separate true blockers from nice-to-have refactors.
3. Prefer fixes that preserve current architecture and avoid broad rewrites.
4. Respect AGENTS.md workstream boundaries.

Return:
- Ship/no-ship verdict.
- Top 5 blockers, ordered by severity.
- Exact files likely involved for each blocker.
- Suggested owner workstream: S, A, B, C, D, or Architect.
- A minimal execution order.

Do not make changes unless explicitly instructed in a follow-up run.
