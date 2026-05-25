# Mobile Swing Replay Beta — scope

Product label for the current milestone: **Mobile Swing Replay Beta** (internal / closed testers).

## In scope

| Surface | Capability |
|---------|------------|
| **Mobile** | Upload video, poll job progress, skeleton overlay on replay, ball marker when `ballTracking` is present, relative ball speed badge |
| **Web** | Full analysis replay with skeleton, ball overlay, racket-head speed (with wrist fallback), Safari overlay worker fallback |
| **Server** | Pose phases, scores, `analysis.getById` enriched with `ballTracking` and `racketTracking` from latest completed job artifacts |

## Out of scope (this beta)

- Mobile racket-head overlay or speed (web-only until a follow-up)
- Match CV: rallies, heatmaps, condensed rally video, scoring (`MATCH_CV_ENABLED` is off on mobile)
- Guaranteed ball track on glass reflections or heavy occlusion
- Public App Store / Play Store release (see `mobile/STORE_READINESS.md`)
- Metric km/h ball speed on mobile without court calibration payload

## Tester expectations

1. **Pose + phases** are the primary deliverable; ball overlay is **best-effort** when the server CV ball stage succeeds.
2. Empty `ballTracking` is normal for older analyses, failed ball stage, or missing `data/analysis-agents/` artifacts after redeploy.
3. Racket-head tracking and live km/h speed badges are **web** features for this beta.
4. Demo analysis (`analysisId: -1` in the app) shows skeleton + synthetic ball without a server.

## Follow-up (post-beta)

- Mobile `racketTracking` parity
- Persist tracking tuples in DB or object storage (not only ephemeral job JSON)
- Integration e2e: upload → job → non-empty tracking on device
- Match CV API on mobile or remove dead UI paths
