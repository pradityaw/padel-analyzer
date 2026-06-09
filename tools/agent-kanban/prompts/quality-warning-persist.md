# UX — Persist quality warning for replay / deep links

Workstreams **S → B → C**. Backlog: partial — quality feedback survives upload via sessionStorage but not full replay/deep-link persistence.

## Scope

1. Trace `qualityWarning` / low-detection signals from upload through analysis storage and replay routes.
2. Add or wire the analysis-level field needed so History and `/analysis/:id` show the warning without sessionStorage handoff.
3. Update tRPC + Drizzle only if the shared contract requires it (coordinate `shared/types.ts` first).
4. UI: show the warning with existing Tennis Neon patterns in `design.md` — no invented metrics.

## Out of scope

- Landmark storage (already done)
- Broad History redesign

## Verification

- `npm run typecheck`
- `npm run db:push` if schema changes
- Manual: upload → refresh on analysis page → warning still visible
