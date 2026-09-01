# Milestone 2 — Phase-order / config dedup cleanup

Workstream **A + D**. Goal: remove remaining phase-order and scoring constant duplication when touching adjacent modules.

## Scope

1. Read `shared/config.ts` as the single source of truth (`PHASE_ORDER`, weights, ranges).
2. Audit `client/src/lib/skillClassifier.ts` and nearby training helpers for duplicated constants.
3. Replace local copies with imports from `shared/config.ts` where safe.
4. Keep behavior identical — refactor only, no scoring formula changes unless a bug is proven.

## Out of scope

- New features, schema migrations, or mobile changes

## Verification

- `npm run typecheck`
- `npm run test:contracts` if shared types or config exports change
