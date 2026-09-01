# Competitor Analysis — Orchestrator Playbook

Multi-agent workflow for SwingVision (or any installed competitor) tech analysis. One orchestrator chat binds subagent outputs into a single report.

## Roles

| Agent | Responsibility | Output |
|-------|----------------|--------|
| **Orchestrator** (main chat) | Scope, launch subagents, resolve blockers, merge findings | `docs/competitor_ai_tech_analysis.md` |
| **Device Capture** | Physical iPhone via `agent-device` + UDID | `docs/agent-device-artifacts/competitor-tech-analysis/*` |
| **Public Research** | App Store, website, patents, job posts, privacy policy | `PUBLIC_RESEARCH.md` |
| **Repo Synthesis** | Compare competitor vs Padel Analyzer codebase | `REPO_SYNTHESIS.md` |

## Prerequisites

- iPhone: Developer Mode ON, UI Automation enabled, unlocked, USB trusted
- Mac: `DEVELOPER_DIR`, Xcode license, `agent-device` on PATH
- Physical UDID: `00008150-000262891A28401C` (set `AGENT_DEVICE_UDID` if different)
- Signing: `source ./scripts/agent-device-signing-env.sh` (team `A4756XP2SB`)
- Handoff doc: `docs/COMPETITOR_ANALYSIS_HANDOFF.md`

## Orchestrator launch prompt

```
Orchestrate competitor tech analysis for SwingVision on my physical iPhone.

1. Device subagent: TARGET_APP=SwingVision AGENT_DEVICE_UDID=00008150-000262891A28401C ./scripts/agent-device-competitor-tech-smoke.sh then explore Record/Home/Me tabs.
2. Research subagent: public SwingVision AI/video architecture → PUBLIC_RESEARCH.md
3. Synthesis subagent: competitor_qa + our pipeline → REPO_SYNTHESIS.md
4. Bind all into docs/competitor_ai_tech_analysis.md with Observed/Public/Inferred labels.
```

## Device commands (always pass UDID when sim is booted)

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export AGENT_DEVICE_UDID=00008150-000262891A28401C
TARGET_APP=SwingVision ./scripts/agent-device-competitor-tech-smoke.sh
```

Exploration loop:

```bash
agent-device snapshot -i --platform ios --udid $AGENT_DEVICE_UDID --session competitor-tech-analysis
agent-device press @eN --platform ios --udid $AGENT_DEVICE_UDID --session competitor-tech-analysis
agent-device screenshot docs/agent-device-artifacts/competitor-tech-analysis/NN-screen.png --platform ios --udid $AGENT_DEVICE_UDID --session competitor-tech-analysis
agent-device close --platform ios --udid $AGENT_DEVICE_UDID --session competitor-tech-analysis
```

## Merge rules (orchestrator)

1. **Observed** — only from device artifacts (snapshots, screenshots, timings).
2. **Public** — only from `PUBLIC_RESEARCH.md` with cited URLs.
3. **Inferred** — architecture hypotheses; must state confidence (high/medium/low).
4. **Conflicts** — if device vs public disagree, note both and defer.
5. **Padel implications** — pull from `REPO_SYNTHESIS.md` recommendations table.

## Stop conditions

- Human needed: passcode, 2FA, paywall, camera permission, subscription gate.
- Device subagent fails: check Developer Mode, UDID, phone unlocked.
- Do not bypass protections or extract proprietary binaries/models.

## Artifacts layout

```
docs/agent-device-artifacts/competitor-tech-analysis/
  devices.txt
  apps-ios-all.txt
  snapshot-initial.txt
  01-launch.png
  PUBLIC_RESEARCH.md      ← research subagent
  REPO_SYNTHESIS.md       ← synthesis subagent
  RUN_NOTES.md
docs/competitor_ai_tech_analysis.md   ← orchestrator final report
```
