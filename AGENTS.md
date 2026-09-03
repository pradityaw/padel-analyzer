# Multi-agent workflow (Padel Analyzer)

Use this when splitting work across **multiple Cursor chats**, **Composer sessions**, or **git worktrees**. Each stream should own a **slice** of the repo and avoid drive-by edits elsewhere.

## Workstreams (ownership)


| ID                           | Scope                          | Primary paths                                                              | Typical tasks                                                                              |
| ---------------------------- | ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **A — Client / analysis UX** | UI, MediaPipe, canvas, routing | `client/src/`**, `client/index.html`, `client/public/**`                   | Upload flow, results video player, metrics UI, skeleton overlay, performance of frame loop; MagicPath UI exploration — see [docs/MAGICPATH.md](./docs/MAGICPATH.md) |
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

## Branch hygiene

- One integration branch at a time. Land it on `main`, then delete the head branch.
- Delete automation branches (`cursor/critical-bug-investigation-*` and similar) when their PR closes. Do not leave closed-PR heads on `origin`.
- Do not add extra remotes that mirror GitHub (`origin.cursor.com`, `origin-native`). `origin` is the only remote.
- Before re-enabling the **Find bugs** automation (`95f71ec6-e12a-459e-bcce-d4f99f476bae`), use the dedupe prompt in [`docs/ops/FIND_BUGS_AUTOMATION.md`](./docs/ops/FIND_BUGS_AUTOMATION.md) (PR #77 if the file is not on `main` yet). Confirm it is paused in the Cursor Automations dashboard after a cleanup.

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

## Cursor Cloud Agent pilot

Read [`docs/CLOUD_AGENT_PILOT.md`](./docs/CLOUD_AGENT_PILOT.md) and
`.cursor/skills/evidence-driven-testing/SKILL.md` before pilot work.

- The cloud environment runs `npm ci`, installs Playwright Chromium, and starts
  the non-production app on port 3001.
- Use synthetic or seeded fixtures. Do not read, print, copy, record, or commit
  `.env*`, credentials, production data, `data/*.db`, uploads, or user media.
- Never run `hosted:*`, deploy, daemon, feedback, auto-merge, mobile/native,
  YouTube download, or ML training commands in the pilot.
- Reproduce before editing. If the issue cannot be reproduced, report evidence
  and stop; do not guess a fix.
- Run the targeted test and a relevant broader check. Bind evidence to the
  tested head SHA and treat required CI as authoritative.
- Open draft PRs only. Never merge, mark ready, force-push, or bypass branch
  protection.
- Only one agent may write for an issue at a time. Keep review and CI repair
  loops bounded as specified in the pilot runbook.

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

## Cursor Cloud specific instructions

### Services overview

| Service | Start command | Default URL | Notes |
|---------|--------------|-------------|-------|
| Dev server (Express + Vite HMR) | `npm run dev` | `http://localhost:3001` | Serves both API and client |

Single-process dev: `npm run dev` starts Express (tRPC API + file uploads) with Vite dev middleware attached for the React client. No separate frontend process needed.

### Key commands reference

- **Typecheck:** `npm run typecheck`
- **Build:** `npm run build`
- **Python CV tests:** `.venv/bin/python3 -m pytest scripts/cv/tests -q`
- **Contract tests:** `npm run test:contracts`
- **CV doctor (verify pipeline deps):** `npm run cv:doctor`
- **DB push (after schema changes):** `npx drizzle-kit push`

### Non-obvious caveats

- The Python venv at `.venv/` is used by the CV pipeline. The `cv:doctor` script auto-detects `.venv/bin/python3` if present. The server spawns `python3` for CV processing; set `CV_PYTHON_BIN` env var to override the Python path.
- SQLite DB lives at `./data/padel.db`. The `data/` directory is gitignored and **must exist** before `npm run db:push` (the dev server creates it on boot; run `mkdir -p data` for a fresh clone).
- `ffmpeg` is on `PATH` in Cloud VMs. **`yt-dlp` is not always pre-installed`** — install via the Dockerfile pattern (`curl` to `/usr/local/bin/yt-dlp`) or `pip install yt-dlp` if you need YouTube import; `npm run cv:doctor` reports whether it is found.
- **First-time Python CV setup:** `sudo apt-get install -y python3.12-venv`, then `python3 -m venv .venv && .venv/bin/pip install -r scripts/cv/requirements.txt` (plus `scripts/requirements-server-analysis.txt` for server/mobile analysis jobs).
- The `tracknet-v2.onnx` model is not committed (needs separate training/download); the CV pipeline falls back to OpenCV-based ball tracking without it.
- `tsconfig.json` excludes several files from type-checking (Login, Home page, auth routes); these are WIP files with known type issues.
- `python3.12-venv` apt package is required to create the `.venv` -- it is not pre-installed on the base Ubuntu image.
