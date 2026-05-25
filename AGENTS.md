# Multi-agent workflow (Padel Analyzer)

Use this when splitting work across **multiple Cursor chats**, **Composer sessions**, or **git worktrees**. Each stream should own a **slice** of the repo and avoid drive-by edits elsewhere.

## Workstreams (ownership)


| ID                           | Scope                          | Primary paths                                                              | Typical tasks                                                                              |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A — Client / analysis UX** | UI, MediaPipe, canvas, routing | `client/src/`**, `client/index.html`, `client/public/**`                   | Upload flow, results video player, metrics UI, skeleton overlay, performance of frame loop |
| **B — Server / data**        | API, DB, YouTube pipeline      | `server/`**, `drizzle/**`, `data/` (runtime only; don’t commit DB blobs)   | tRPC routers, SQLite schema, `youtube.ts` / `yt-dlp`, static `/uploads`                    |
| **C — Tooling / PWA / docs** | Build, deploy, installability  | `vite.config.ts`, `package.json`, `tsconfig.json`, `README.md`, PWA assets | Service worker, manifest icons, env docs, CI scripts                                       |
| **D — ML Models**            | ONNX models, inference libs, training scripts | `client/public/models/`, `client/src/lib/analysisPipeline.ts`, `client/src/lib/tracknet.ts`, `client/src/lib/courtCalibration.ts`, `training/` | Export/quantize ONNX models, TrackNet ball tracking, court homography, stroke classifier |


**Shared contracts** (coordinate before parallel edits): `shared/types.ts`, `server/routers/index.ts` (router merge), `client/src/lib/trpc.ts` (client router type).

**ML shared contracts** (Workstream D must agree with A + B before branching): `BallTrajectory`, `PadelStrokeType`, `CourtHomography` types in `shared/types.ts`; `analysis.ts` router additions for ball trajectory storage. See [`ML_UPGRADE_PLAN.md`](./ML_UPGRADE_PLAN.md) for full upgrade roadmap.

## Merge order (reduces conflicts)

1. **Contracts first** — `shared/types.ts`, any new tRPC procedure names and input/output shapes.
2. **Server second** — implement procedures + DB migration/push if schema changes.
3. **Client last** — consume new APIs and UI.

If two streams touch the same file, **serialize**: merge stream 1, then rebase stream 2.

## Branch naming

- `feat/client-<topic>` — e.g. `feat/client-timeline-scrub`
- `feat/server-<topic>` — e.g. `feat/server-auth-stub`
- `chore/tooling-<topic>` — e.g. `chore/tooling-pwa-icons`

## Git worktrees (optional, true parallelism)

Same repo, different folders and branches:

```bash
cd /path/to/padel-analyzer
git worktree add ../padel-analyzer-client feat/client-my-task
git worktree add ../padel-analyzer-server feat/server-my-task
```

Open each folder in a **separate Cursor window**; assign one agent/chat per worktree.

## Environment & commands

- **Dev:** `npm run dev` — default **[http://localhost:3001](http://localhost:3001)** (avoid port 3000 if another app uses it).
- **DB:** `npx drizzle-kit push` after schema changes in `drizzle/schema.ts`.
- **YouTube downloads:** server expects `**yt-dlp`** on `PATH` (Homebrew: `brew install yt-dlp`) and `**ffmpeg**` for merges (`brew install ffmpeg`).

## Hotspots (expect merge conflicts)

- `server/routers/index.ts` — new routers must be merged into `appRouter`.
- `shared/types.ts` — shared analysis/pose types.
- `client/src/App.tsx` — new routes.
- `package.json` / `vite.config.ts` — dependency or alias changes.

## Agent brief template (paste at top of a new chat)

```
Workstream: A | B | C (see AGENTS.md)
Branch: feat/<area>-<topic>
Goal: <one sentence>
Out of scope: <what not to touch>
Depends on: <merged PRs or none>
```

## Rules of thumb

- **Small PRs** per workstream; no unrelated refactors.
- **Match existing patterns** in the same folder (imports, tRPC usage, Tailwind).
- **Don’t commit** `data/*.db` or large uploads; they’re gitignored by design.

