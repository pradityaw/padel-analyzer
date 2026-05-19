# Fix Critical MVP Blockers

You are helping finalize Padel Analyzer into a live MVP.

Focus only on critical issues that can break the upload, analysis, results, history, or production build flow. Keep changes narrow and match local patterns.

Before editing:
1. Read `AGENTS.md` and respect workstream ownership.
2. Check `ARCHITECTURE_REVIEW.md` for known high-priority issues.
3. Inspect current git status and avoid overwriting unrelated user changes.

Preferred critical fix areas:
- React runtime crashes, especially hook-order issues.
- Unguarded `JSON.parse` that can crash pages or routers.
- Server input validation that trusts opaque JSON strings.
- Upload/analysis failures with no useful recovery.
- Build/typecheck failures.
- Missing production-safe error handling where raw internals leak to users.

After editing:
- Run the smallest relevant checks first.
- Run `npm run typecheck` if TypeScript files changed.
- Run focused tests if available.
- Report changed files, checks run, and any remaining risk.

Do not commit or push changes unless explicitly asked by the user.
