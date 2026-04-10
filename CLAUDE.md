# Padel Analyzer — Agent Instructions

You are an autonomous coding agent working on this project. Follow the Ralph Loop protocol below.

## Project Overview

Padel swing video analyzer. Users upload padel swing videos; the app runs **MediaPipe BlazePose** in-browser to extract skeleton landmarks frame-by-frame, then scores the swing with an ONNX model and produces coaching insights. Everything runs client-side (browser ML) with a thin Express/tRPC server for persistence.

## Tech Stack

- **Frontend:** React 19, Vite 6, TypeScript, TailwindCSS v4, Framer Motion, Recharts, Wouter (routing), tRPC React Query client
- **Backend:** Express 5, tRPC v11, better-sqlite3, Drizzle ORM, Multer (file uploads)
- **ML:** MediaPipe Tasks Vision (BlazePose), ONNX Runtime Web
- **DB:** SQLite at `data/padel.db`; schema in `drizzle/schema.ts`

## Key File Locations

| Purpose | Path |
|---|---|
| Shared types/contracts | `shared/types.ts` |
| tRPC client setup | `client/src/lib/trpc.ts` |
| tRPC server router merge | `server/routers/index.ts` |
| DB schema | `drizzle/schema.ts` |
| Swing scoring logic | `client/src/lib/swingAnalyzer.ts` |
| Shot classifier | `client/src/lib/shotClassifier.ts` |
| Upload page | `client/src/pages/Upload.tsx` |
| Analysis page | `client/src/pages/Analysis.tsx` |
| History page | `client/src/pages/History.tsx` |
| ProCompare page | `client/src/pages/ProCompare.tsx` |

## Commands

```bash
# Dev server (port 3001)
npm run dev

# Type check
npm run typecheck

# Run tests
npm run test

# Push DB schema changes
npx drizzle-kit push
```

## Workstream Ownership (AGENTS.md)

- **A — Client/analysis UX:** `client/src/` — UI, MediaPipe, canvas, routing
- **B — Server/data:** `server/`, `drizzle/`, `data/` — tRPC routers, SQLite, YouTube pipeline
- **C — Tooling/PWA:** `vite.config.ts`, `package.json`, `tsconfig.json` — build, deploy, PWA

**Shared contracts** (coordinate before parallel edits): `shared/types.ts`, `server/routers/index.ts`, `client/src/lib/trpc.ts`

**Merge order:** contracts → server → client

## Hotspots (watch for conflicts)

- `server/routers/index.ts` — new routers must be merged into `appRouter`
- `shared/types.ts` — shared analysis/pose types
- `client/src/App.tsx` — new routes
- `package.json` / `vite.config.ts` — dependency changes

---

## Ralph Loop Task Protocol

**Execute exactly one story per invocation. Do not batch stories.**

### Step 1 — Orientation
1. Read `prd.json` (project root) — find the **highest priority** story where `passes: false`
2. Read `progress.txt` (project root) — check the `## Codebase Patterns` section at the top for known patterns and gotchas

### Step 2 — Branch
Check that you are on the branch named in `prd.json` → `branchName` (currently `ralph/production-ready`).  
If not, create it from main: `git checkout -b ralph/production-ready main`

### Step 3 — Implement
Implement the selected story. Keep changes **minimal and focused** — only touch what the story requires. Follow existing code patterns in each file's directory.

### Step 4 — Quality gates
Run all three quality checks. **Do NOT commit if any fail.**

```bash
npm run typecheck   # must exit 0
npm run test        # must exit 0 (or "no test files found" is acceptable until tests exist)
```

If a check fails, fix the issue before proceeding.

### Step 5 — Commit
Stage and commit **all** changes:

```bash
git add -A
git commit -m "feat: [Story ID] - [Story Title]"
```

### Step 6 — Update prd.json
Set `passes: true` for the completed story in `prd.json`. Write the file back to disk.

### Step 7 — Update progress.txt
Append (never overwrite) to `progress.txt`:

```
## [ISO date] - Story [ID]: [Title]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas
  - Useful context
---
```

If you discovered a **general, reusable** pattern, also add it to the `## Codebase Patterns` section at the **top** of `progress.txt` (create the section if absent).

### Step 8 — Stop condition
After completing the story, check if **all** stories in `prd.json` have `passes: true`.

- If yes → reply with exactly: `<promise>COMPLETE</promise>`
- If no → end your response normally (the loop will invoke you again for the next story)

---

## Quality Rules

- Never commit code that fails `typecheck` or `test`
- Keep PRs small — one story per commit
- Match existing import style, Tailwind conventions, tRPC patterns in each area
- Don't modify files outside your story's scope
- Don't commit `data/*.db` or large upload files (gitignored)
