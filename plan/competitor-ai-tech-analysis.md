# Competitor AI Video Analysis Plan

## Goal

Build a repeatable, lawful workflow for analyzing an already-installed iPhone competitor app, focused on AI video-analysis features, execution flow, and inferred architecture.

## Scope

- Use `agent-device` against a physical iPhone.
- Discover the target app from the connected device app list.
- Capture visible UI evidence: app list, launch state, accessibility snapshots, screenshots, blockers, and flow notes.
- Infer technology only from observable app behavior and public evidence.
- Keep private internals out of scope: no binary extraction, private API harvesting, paywall bypassing, credential bypassing, or model extraction.

## Current Device Status

- `./scripts/check-agent-device-prereqs.sh` passed.
- Connected device: Praditya's iPhone, iPhone 17, paired and available.
- Current `agent-device apps --platform ios --all` output does not show the competitor app yet; only system apps, Padel Analyzer Mobile, and its UI test runner are visible.

## Workflow

1. Confirm phone readiness with `./scripts/check-agent-device-prereqs.sh`.
2. List visible apps with `agent-device apps --platform ios --all`.
3. Select the competitor app by exact display name or bundle ID.
4. Launch the app with a named `agent-device` session.
5. Capture initial `snapshot -i` and screenshot.
6. Explore only reachable, visible flows:
   - onboarding and permissions
   - video capture/import
   - analysis progress and latency
   - result metrics and coaching
   - history/session library
   - export/sharing
   - settings/subscription surfaces
7. Research public technical evidence: App Store metadata, privacy policy, release notes, website claims, job posts, patents, docs, SDK hints.
8. Synthesize a report with observed facts, public claims, inferred architecture, confidence levels, and Padel Analyzer implications.

## Risks And Mitigations

- App not visible to `agent-device`: install it on this same connected phone/profile, unlock the phone, and re-run the app list.
- Auth, passcode, paywall, or permission blocker: pause and ask for human action.
- Sparse accessibility in camera/video views: pair snapshots with screenshots and manual visual notes.
- Speculative architecture claims: label each claim as observed, public, or inferred with confidence.

## Deliverables

- `docs/agent-device-artifacts/apps-ios-current.txt`
- `docs/agent-device-artifacts/apps-ios-all-current.txt`
- `docs/agent-device-artifacts/competitor-tech-analysis/`
- `docs/competitor_ai_tech_analysis.md`

