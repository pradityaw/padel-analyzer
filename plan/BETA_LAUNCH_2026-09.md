# Beta Launch Readiness Plan (web-first closed beta on Fly)

> Written 2026-09-02. Source of truth for the current milestone.
> Decision: **Web Swing Replay Beta, pose-only**, magic-link auth, hosted on Fly.

## Verdict

The app is **not** ready for a real-user beta today. Local gates pass, but the hosted instance is broken, there are two divergent mains, auth does not exist, and ball tracking cannot legally ship. This plan gets a web-first, pose-only, magic-link closed beta on Fly in front of 10–20 real players, with a working feedback loop.

## Where we are (verified 2026-09-02)

What is green:

- `npm run release:beta-gates` passes: typecheck, mobile typecheck, contract tests, 18 court-calibration tests, 121 Python CV tests.
- iOS UI smoke CI green on `feat/mobile-record-mode-ui`; PR #25 is mergeable.
- Record → upload → job → analysis flow is complete on mobile; web upload uses the same server jobs.
- Pino logging, rate limiting, queue/storage docs landed (phase 1). Mobile bundle id is real (`com.padelanalyzer.mobile`); `mobile/eas.json` preview profile already targets the Fly URL.

What blocks a beta:

1. **Hosted app is broken.** `https://padel-analyzer.fly.dev/healthz` is 200, but `analysis.list` returns `no such table: analyses`. Migrations were never run on the volume.
2. **Two mains.** `feat/mobile-record-mode-ui` (Court Flood) and `origin/main` (Nike, PR #21) conflict in 12 client files. Decision: **Court Flood wins.**
3. **Critical server fixes are on neither branch.** PR #81 holds `recoverPendingAnalysisJobs`, atomic YouTube download, cloud playback URLs, Slack route ordering, and CV subprocess stdout guards.
4. **Auth does not exist.** `server/routers/index.ts` mounts `authStub.ts`. Real auth files are excluded in `tsconfig.json` and import tables that are not in `drizzle/schema.ts`.
5. **Ball tracking cannot ship hosted.** TrackNet weights are gitignored and license-unclear. Docker image has no `onnxruntime`. Decision: **pose + phases only.**
6. **No in-app feedback or server crash reporting.**
7. **No tester-facing guidance.** `analysis.delete` is DB-only. CoachMarks tour is dead code.
8. **Nothing enforces the gates.** No CI workflow runs `release:beta-gates`.
9. **Upload cap is unsafe.** `MAX_UPLOAD_MB = 2048` on a 3 GB Fly volume.

## Goal / scope / out of scope

- **Goal:** 10–20 real padel players upload swing clips from their phone browser to the hosted web app, get pose + phase scores back in a few minutes, and we receive structured feedback and crash reports.
- **Scope:** web client + server + Fly deployment + docs. Mobile only insofar as nothing breaks (`mobile:typecheck` stays green).
- **Out of scope (Beta 2):** TestFlight/Play internal builds, ball/racket overlays in hosted mode, match CV, Postgres, multi-instance queue, YouTube ingestion for testers, service worker/offline PWA, share/export of an analysis.

## Architecture decisions

- **Hosting:** stay on Fly, single machine, SQLite on the `padel_data` volume. Add `swap_size_mb = 1024` in `fly.toml` before paying for 2 GB. Keep `MAX_CONCURRENT = 1`.
- **Migrations:** run schema push at container start so a fresh volume never yields "no such table".
- **Auth:** magic-link with Resend (`EMAIL_PROVIDER=resend|console`). `userId` on analyses/jobs/comparisons/annotations. Isolation by `ctx.user.id`.
- **Pose-only hosted mode:** `BALL_TRACKING_ENABLED=false` skips TrackNet/racket stages.
- **Feedback loop:** `feedback.submit` tRPC mutation → DB + Slack. Floating Feedback button. Sentry gated on `SENTRY_DSN`.
- **Branch strategy:** land Court Flood + PR #81 + this work on `cursor/beta-launch-*`, then merge to `main`.

## Sequencing

```
Week 0: one main ──► Auth + isolation
                 ──► Deploy hardening
                 ──► Pose-only mode
                         │
                         └──► Feedback + Sentry ──► Tester docs ──► Hosted smoke ──► Invite testers
```

## Top 3 risks

1. **Fly 1 GB OOM during MediaPipe pose.** Mitigation: swap, RSS logs, hosted smoke on a 30 s clip.
2. **Conflict resolution regresses the web UI.** Mitigation: Court Flood wins; `release:gates` + `qa:browser`.
3. **Auth retrofit leaks data.** Mitigation: `protectedProcedure` + two-user isolation contract test.

## Beta exit criteria

- 10+ testers, 30+ completed hosted analyses, zero Sev-1 in upload → job → replay.
- Median pose-detection rate on real clips ≥ 80%; p95 analysis wall time < 5 min for a 30 s clip.
- 15+ feedback submissions with at least one "what felt wrong" answered per tester.
- Then decide Beta 2: mobile TestFlight vs. cleanly-licensed ball model.
