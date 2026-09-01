# Padel Analyzer — Phased Plan & Architecture Recommendations

> Prepared 2026-06-18. Decision document: read this, then pick a phase to start.
> Source of truth for current state: this doc supersedes the (stale) 2026-04 memory.

---

## 0. Where things actually stand (verified 2026-06-18)

This is **not** a greenfield scaffold. It is a mature, actively-developed product.

| Layer | Stack | Size | State |
|---|---|---|---|
| Web client | React 19 + Vite + tRPC + Tailwind v4 + Radix + Framer Motion | ~14.2k LoC | Working; 9 pages (Home/Upload/Analysis/Annotate/Compare/History/ProCompare/Login/Privacy) |
| Mobile | Expo / React Native | ~5.5k LoC | Working; record mode in-flight on `feat/mobile-record-mode-ui` (uncommitted) |
| Server | Express + tRPC + Drizzle | ~4.9k LoC | Job queue + orchestrator + Python-CV bridge |
| Python CV | MediaPipe pose + TrackNet ball + racket/rally/court/scoring | ~9.2k LoC | The real ML brain now |
| Shared | types + Drizzle schema + config | ~1.1k LoC | Clean contract layer |
| Storage | SQLite (`padel.db`) + file stores (landmarks/rallies/uploads/thumbnails) | — | Postgres option configured |
| Tooling | agent-kanban (Next.js), cursor-sdk runners, release gates, Playwright/e2e, CV doctor | large | Sprawling |

**The pivotal decision already made (and it was the right one):** ML moved from the browser (MediaPipe/WASM) **onto the server as a Python pipeline**. This unified web + mobile on one accurate pipeline and unlocked TrackNet ball tracking. The old browser-side `analysisPipeline.ts` + `pipeline.worker.ts` now have **zero call sites** — confirmed dead code (PRODUCT_BACKLOG #9).

---

## 1. The roboflow/sports question — resolved

The handoff (`~/padel-analyzer-codex-handoff.md`, 2026-06-16) asked whether `github.com/roboflow/sports` is a good foundation. Its conclusion:

- **roboflow/sports is a small Python CV toolkit with a soccer demo, not a platform.** Reusable ideas: ball annotation/tracking, homography → top-down mapping, team-color clustering, court/radar overlays. The end-to-end demo is **soccer-specific** (hard-coded pitch geometry, soccer annotators, soccer models).
- **Recommendation in the handoff:** use as a *reference*, not a dependency. Reuse `sports/common/ball.py`, `view.py`, parts of `team.py`; replace soccer config/annotators/models.
- **Licensing flag:** MIT code, but YOLOv8/Ultralytics licensing needs verifying before product use.

**Why this is now mostly moot:** the project has *already built the padel equivalents independently* — `scripts/cv/court_mapping.py` (top-down projection), `tracknet_ball.py` (ball tracking), `player_tracking.py`, `racket_tracking.py`, `rally_detector.py`. So the "build a PadelCourtConfiguration + court annotator + minimap" next-steps from the handoff are **already realized**, just not derived from roboflow's code.

**Recommendation:** do **not** adopt roboflow/sports as a base. Treat it as a reference for two specific gaps if you hit them: (a) cleaner homography/court-keypoint handling, (b) a radar/minimap overlay. No rewrite is justified by this handoff.

---

## 2. Strategic recommendations (themes)

1. **Stop accumulating branches and dead code before adding features.** 6+ unmerged feature branches, uncommitted mobile work, quarantined browser-pipeline code. This is the highest-leverage, lowest-risk work and it's blocking clear thinking about the codebase.
2. **Auth and deployability are the gate to "hosted for others."** Magic-link auth exists but is env-gated and partially stubbed; the Docker image bundles Python but silently swallows pip failures. Fix these before any beta/hosting push.
3. **Treat the Python CV pipeline as a first-class subsystem**, not a subprocess bolt-on: version it, test it (`scripts/cv/tests` exists), and pin its model weights.
4. **Consolidate docs.** `CODEBASE_REVIEW.md` is 435 KB; there are ~5 overlapping review/strategy docs. One living ARCHITECTURE.md would serve better.

---

## 3. Phased plan

### Phase 0 — Hygiene & shippability (do first; low risk)
**Goal:** a clean, single-current-of-truth tree that builds and deploys.

- [ ] **0.1 Branch reconciliation.** Inventory all branches (`feat/mobile-record-mode-ui`, `feat/mobile-court-setup`, `chore/feedback-triage-followups`, `feat/client-nike-design-language`, `pr-12-feedback`, 3× `cursor/*`). For each: merge, rebase, or archive. Commit the uncommitted mobile-record-mode changes (or stash with a clear message).
- [ ] **0.2 Delete quarantined browser-side ML.** Remove `client/src/lib/analysisPipeline.ts`, `pipeline.worker.ts`, and the MediaPipe-in-browser path if fully unreferenced. Verify no import survives via `tsc --noEmit` + grep. Keep a one-line note in an ARCHITECTURE.md explaining the server-side pivot.
- [ ] **0.3 Verify auth wiring.** Determine which of `auth.ts` vs `authStub.ts` is mounted in `server/routers/index.ts`. Confirm session tables exist in `drizzle/schema`. Document the `AUTH_MODE` switch. (Decision needed: magic-link-only, or add OAuth/password before hosting.)
- [ ] **0.4 Harden the Docker image.** The `pip3 install ... || true` in `Dockerfile` swallows model-dependency failures — a CV stage could silently be missing at runtime. Replace `|| true` with a real check; add a `cv:doctor`-equivalent smoke in the image entrypoint. Confirm model weights (TrackNet etc.) are bundled or downloaded deterministically.
- [ ] **0.5 Green build + baseline tests as a gate.** `npm run typecheck && npm run build && npm run test:contracts && npm run test:cv` should all pass on `main`. Wire into CI if not already.

### Phase 1 — Deployability & observability
- [ ] **1.1 Postgres path** (optional but recommended for multi-user): validate `docker-compose.postgres.yml` + `drizzle.config.postgres.ts`; run a migration dry-run.
- [ ] **1.2 Structured logging** (Pino) on server; client error boundary already partially there.
- [ ] **1.3 Object storage** (`objectStorage.ts` router) — confirm local-vs-S3 abstraction works for uploads/landmarks before scaling.
- [ ] **1.4 Job queue durability** — `analysisJobQueue` is in-process SQLite today; decide if that's acceptable for hosted (single-instance Fly) or needs Redis/PG-backed queue.

### Phase 2 — ML/CV accuracy (the differentiator)
- [ ] **2.1 Ball tracking quality** — validate TrackNet outputs on a labeled padel clip set (`~/padel-ml-dataset` exists). Measure precision/recall; tune confidence thresholds.
- [ ] **2.2 Rally/shot segmentation** — `rally_detector.py` + `dead_time_trimmer.py`; verify shot boundaries vs. ground truth.
- [ ] **2.3 Scoring model validation** — `scoring.py` produces biomechanical scores; these need a ground-truth/ coherence check (compare to a human coach's ratings on a small set). This is the product's core claim and it's currently unvalidated.
- [ ] **2.4 Court calibration** — `courtCalibration.ts` (client) vs `court_mapping.py` (server): confirm single source of truth; the homography quality gates the top-down map.
- [ ] **2.5 Wall/glass bounce reasoning** — the one genuinely unsolved padel-specific problem (not in roboflow/sports either). Scope as research, not a near-term deliverable.

### Phase 3 — Mobile
- [ ] **3.1 Land record-mode UI** (current in-flight branch): record → upload → analysis flow on iOS + Android.
- [ ] **3.2 Parity audit** vs. web (History, ProCompare, Annotate).
- [ ] **3.3 Agent-device QA** — the `scripts/agent-device-*` + iOS-simulator harness exists; run it on the SwingVision competitive flow and your own screens.

### Phase 4 — Product & hosting (only after Phase 0 + auth)
- [ ] **4.1 Multi-user auth** finalized → data isolation per user in Drizzle queries.
- [ ] **4.2 Beta program** (`docs/BETA_PROGRAM.md`, `BETA_SCOPE.md` exist) — wire feedback loop (Slack feedback events already scaffolded in `slackFeedbackEvents.ts`).
- [ ] **4.3 PWA / offline replay** (icebox).
- [ ] **4.4 Rate limiting** (still absent per old audit — confirm).

---

## 4. Open decisions for you

1. **Auth model** — magic-link only, or add OAuth (Google/Apple) for mobile? Affects Phase 0.3 and Phase 4.1.
2. **Hosting topology** — single-instance Fly (simpler, in-process queue fine) vs. scaled (needs external queue + S3)? Affects Phase 1.4.
3. **CV scoring ground truth** — do you have (or can you get) a coach-labeled clip set to validate `scoring.py`? This is the biggest product-risk item.
4. **roboflow/sports** — confirm: ignore as a base (my recommendation), use as reference only for homography/minimap.

---

## 5. Recommended sequencing

```
Phase 0 (hygiene) ──► Phase 1 (deploy) ──► Phase 4 (hosting/beta)
                         │
                         └──► Phase 2 (CV accuracy)  ◄── runs in parallel, highest product value
                         └──► Phase 3 (mobile)        ◄── runs in parallel
```

**If I pick one place to start for you:** Phase 0. It's the lowest-risk, unblocks everything else, and the branch/dead-code sprawl is actively costing you clarity. Phase 2 is where the product differentiation lives once the foundation is clean.
