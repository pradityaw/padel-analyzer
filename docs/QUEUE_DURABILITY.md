# Job Queue Durability

> Phase 1.4 — current state + recommendation. Verified 2026-06-18.

## TL;DR

The analysis job queue is **in-process and in-memory today**. It is fine for a
**single-instance** deployment (e.g. one Fly machine) but loses in-flight work
on every restart/crash. **Recommendation: before scaling to >1 instance, move
the queue off the web process** (Redis-backed BullMQ, or a Postgres-backed
queue like `pg-boss`). For the current single-instance beta, add the cheap
"stuck-job recovery on boot" fix below — no new dependency required.

---

## Current state (verified)

- **Job rows** live in SQLite (`analysis_jobs` table, via Drizzle). Status:
  `queued → processing → completed | failed`. These survive restarts.
- **The runner** ([`server/lib/analysisJobQueue.ts`](../server/lib/analysisJobQueue.ts))
  is a module-level `pending: number[]` array + a `running` counter, capped at
  **`MAX_CONCURRENT = 1`**. It runs **inside the web process** (Express server).
- **Scheduling** ([`scheduleAnalysisJob`](../server/lib/analysisJobProcessor.ts))
  pushes a job id onto the in-memory array and calls `drain()`.

### What breaks on restart today

1. The in-memory `pending` array is wiped → any **queued-but-not-started** job
   is never run (its row stays `queued` forever).
2. A job mid-flight (`processing`) is abandoned → its row stays `processing`
   forever; the client polling loop spins until it gives up.
3. There is **no boot-time scan** that recovers either of these.

So: every deploy / crash strands jobs. For a beta with low volume that is
tolerable (you can manually retry), but it is the single biggest reliability gap.

---

## Decision matrix

| Topology | Is the current queue OK? | What to do |
|---|---|---|
| **Single Fly machine** (today's `fly.toml`, 1 instance) | Acceptable for beta | Add the cheap boot-recovery fix below. No new dep. |
| **Single Fly machine + auto-restart / autoscale** | Risky — restarts strand jobs | Boot-recovery fix is **mandatory**. |
| **>1 instance / horizontal scale** | **No** — two workers would double-run jobs and the in-mem queue isn't shared | Move to a shared queue (Redis/BullMQ or PG-backed). See below. |

### Note on concurrency + Python CV

`MAX_CONCURRENT = 1` is intentional: each analysis spawns multiple Python CV
subprocesses (pose, ball, racket, rally) that are CPU/RAM-heavy. Raising this
on a single small Fly machine will OOM. The queue should stay co-located with
the worker that owns those subprocesses — another reason to keep it on one
instance until you have a dedicated worker tier.

---

## Recommendation A (cheap, no new dependency) — do this now

Add a **boot-time recovery pass** in `server/_core/index.ts` (after the DB is
ready, before `app.listen`):

1. Re-enqueue any row with `status = 'queued'` (call `scheduleAnalysisJob(id)`
   for each).
2. For rows stuck in `status = 'processing'` (left over from a crashed run),
   either re-queue them or mark them `failed` with a clear message
   (`"Interrupted by server restart — please retry."`).

This is ~20 lines, uses the existing Drizzle `analysisJobs` table, and turns
"every deploy strands jobs" into "every deploy resumes/retries jobs". It does
not change the in-process nature of the queue.

**Caveat:** this only helps on the **same** instance that owns the queue. It is
not a substitute for a shared queue if you scale out.

## Recommendation B (when you scale to >1 instance) — deferred

Pick one:

- **Redis + BullMQ** — the standard Node choice. Workers run as a separate
  process/machine from the web server. Gives retries, backoff, dead-letter
  queues, and durability across restarts. Adds Redis as an infra dependency.
- **Postgres-backed queue (`pg-boss` or a custom `SKIP LOCKED` worker)** — if
  you've already moved to Postgres (see `docs/POSTGRES.md`,
  `drizzle.config.postgres.ts`), this avoids adding Redis. `pg-boss` is a small,
  well-maintained lib that uses Postgres as the broker.

Either way, the migration is localized: keep `scheduleAnalysisJob` /
`processAnalysisJob` as the seam — only the queue implementation behind
`enqueueAnalysisJob` changes. The CV subprocess invocation in
`processAnalysisJob` stays identical.

---

## Verified findings (2026-06-18)

- In-memory queue confirmed: `pending: number[]` + `running` counter, no
  persistence of the queue itself (only job *rows* persist).
- No boot recovery: grep for requeue/stuck-job logic returns nothing.
- `MAX_CONCURRENT = 1` is deliberate (Python CV subprocess cost) — keep it.
- Job status lifecycle is clean (`queued → processing → completed|failed`); a
  recovery pass can rely on it.
