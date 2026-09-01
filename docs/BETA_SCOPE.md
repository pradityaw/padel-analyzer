# Web Swing Replay Beta — scope

Product label for the current milestone: **Web Swing Replay Beta, pose-only** (internal / closed testers).

Testers use the **hosted web app** from a phone browser. They upload a 20–30 second clip, wait for analysis, and review pose + swing phases. See [plan/BETA_LAUNCH_2026-09.md](../plan/BETA_LAUNCH_2026-09.md) for the launch plan.

## In scope

| Surface | Capability |
|---------|------------|
| **Web** | Magic-link sign-in, upload a swing clip (20–30 s, up to 300 MB), poll job progress, skeleton overlay on replay, phase scores and coaching copy, history, delete-my-data, in-app feedback |
| **Server** | Pose extraction + phase scoring on a single Fly machine; per-user data isolation; boot-time job recovery; structured logging and rate limits |
| **Feedback** | Rating + free-text on Analysis and History; Slack webhook for the operator; Sentry when `SENTRY_DSN` is set |

## Out of scope (this beta)

- Ball overlay, TrackNet, racket-head speed (license-unclear model; Docker image has no onnxruntime)
- Match CV: rallies, heatmaps, condensed rally video, scoring
- YouTube ingestion for testers
- Mobile TestFlight / Play internal track (Beta 2)
- Public App Store / Play Store release (see `mobile/STORE_READINESS.md`)
- Multi-instance queue, Postgres, object storage required for scale
- Offline PWA / service worker
- Share / export of an analysis

## Tester expectations

1. **Pose + swing phases** are the only scoring deliverable. The Analysis page is labelled "Pose + swing phases (beta)".
2. Empty `ballTracking` / `racketTracking` is expected. Those stages are skipped when `BALL_TRACKING_ENABLED=false`.
3. Record from the side, 20–30 seconds, good lighting. Longer clips are slow (about 90 s overhead + ~1.4× video length).
4. Each tester only sees their own uploads. Sign-in is a magic link emailed to them.
5. Demo analysis still works without a server (web `id=demo`, mobile `analysisId: -1`).

## Follow-up (Beta 2)

- EAS preview / TestFlight against the hosted API
- Cleanly-licensed ball model, or an explicit commercial license for TrackNetV2
- Mobile `racketTracking` parity
- Persist tracking tuples in DB or object storage
- Match CV on mobile or remove dead UI paths
