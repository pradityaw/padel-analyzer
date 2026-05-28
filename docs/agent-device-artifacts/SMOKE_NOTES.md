# Swing Vision smoke notes

Append one block per run.

## Environment (initial setup)

- **Date:** 2026-05-27
- **Blockers:** Xcode license not accepted (`sudo xcodebuild -license accept` required). Until then, `agent-device devices` and smoke script fail with `COMMAND_FAILED`.
- **agent-device version:** 0.15.2 (installed globally)
- **Node:** v25.9.0
- **Xcode:** 26.4.1 at `/Applications/Xcode.app` (DEVELOPER_DIR set in scripts)
- **Failed smoke log:** `smoke-run-failed.log` (license error captured)

## Run 2026-05-27T15:24:00Z — PASS

- **Device:** Praditya's iPhone (iPhone 17, iOS 26.5)
- **App:** com.Mangolytics.Swing (SwingVision)
- **Session:** swing-smoke-run
- **Screen:** Record tab — Tennis / Rally / Singles mode picker, streak CTA, Continue button, bottom tab bar (Home, Rewards, Record, Compete, Me)
- **Artifacts:** `snapshot-initial.txt`, `01-launch.png`
- **Blockers:** None (developer cert trusted)

## Run 2026-05-27T13:21:04Z (automated attempt)

- **App:** Swing Vision (not launched — blocked by Xcode license)
- **Session:** swing-smoke
- **Artifacts:** smoke-run-failed.log only
- **Next:** After license accept, run `./scripts/check-agent-device-prereqs.sh` then `./scripts/agent-device-swing-vision-smoke.sh`; update this file with device name, iOS version, and snapshot summary

## Template (per run)

- **Date:**
- **Device:**
- **iOS version:**
- **Swing Vision version:**
- **Account / blockers:** (login, subscription, camera, ATT, passcode)
- **Screenshots:** paths under `docs/agent-device-artifacts/`
- **Summary:** one paragraph — initial screen, reachable flows, defects vs manual blockers
