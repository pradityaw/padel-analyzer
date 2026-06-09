# Competitor Analysis — Multi-App Index

**Updated:** 2026-06-08 (device capture session 2)  
**Handoff:** [COMPETITOR_ANALYSIS_HANDOFF.md](COMPETITOR_ANALYSIS_HANDOFF.md)  
**Device:** Praditya's iPhone `00008150-000262891A28401C`  
**Playbook:** [COMPETITOR_ANALYSIS_ORCHESTRATOR.md](COMPETITOR_ANALYSIS_ORCHESTRATOR.md)

## Apps analyzed

| App | CV peer? | Public research | Repo synthesis | Device UI | Orchestrator report |
|-----|----------|-----------------|----------------|-----------|---------------------|
| **SwingVision** | Yes | [PUBLIC_RESEARCH](agent-device-artifacts/competitor-tech-analysis/PUBLIC_RESEARCH.md) | [REPO_SYNTHESIS](agent-device-artifacts/competitor-tech-analysis/REPO_SYNTHESIS.md) | Jun 2026 v11.9.58 [swingvision/](agent-device-artifacts/competitor-tech-analysis/swingvision/RUN_NOTES.md) — Home/Record/Me + sport picker + full setup wizard + live SETUP; + May [flow/](agent-device-artifacts/flow/FLOW_SUMMARY.md) | [competitor_ai_tech_analysis.md](competitor_ai_tech_analysis.md) |
| **sevensix** | Partial (tennis coach) | [sevensix/PUBLIC_RESEARCH](agent-device-artifacts/competitor-tech-analysis/sevensix/PUBLIC_RESEARCH.md) | [sevensix/REPO_SYNTHESIS](agent-device-artifacts/competitor-tech-analysis/sevensix/REPO_SYNTHESIS.md) | **Complete** (all 4 tabs) [FLOW_SUMMARY](agent-device-artifacts/competitor-tech-analysis/sevensix/FLOW_SUMMARY.md) | [competitor_ai_tech_analysis_sevensix.md](competitor_ai_tech_analysis_sevensix.md) |
| **Courtside.** | No (booking) | [courtside/PUBLIC_RESEARCH](agent-device-artifacts/competitor-tech-analysis/courtside/PUBLIC_RESEARCH.md) | [courtside/REPO_SYNTHESIS](agent-device-artifacts/competitor-tech-analysis/courtside/REPO_SYNTHESIS.md) | Not started | [competitor_ai_tech_analysis_courtside.md](competitor_ai_tech_analysis_courtside.md) |

## Next work

1. **SwingVision** — post-record **results** (metrics, coaching, ball trace). A real session now exists on the account (`06-resume-state.png`); open it from Me/history. Settings / subscription gating still uncaptured.
2. **sevensix** — post-analysis **swing-score** views (needs a recorded swing; camera = stop-and-ask). Settings / About sub-screens.
3. **Courtside** — optional booking UX capture.

**Done this session (2026-06-08):** sevensix AI COACH + PROFILE captured (all 4 tabs); SwingVision sport picker (no Padel), full setup wizard, and live camera SETUP captured on v11.9.58.

## Device commands

```bash
source ./scripts/agent-device-signing-env.sh
./scripts/stop-agent-device-qa.sh   # if DEVICE_IN_USE

ARTIFACTS=docs/agent-device-artifacts/competitor-tech-analysis/<app> \
AGENT_DEVICE_SESSION=competitor-<app> \
TARGET_APP="<App Name>" ./scripts/agent-device-competitor-tech-smoke.sh
```

## P0 takeaways

1. **SwingVision** — edge-first ball + line calls; padel beta = direct threat (but **not** in production v11.9.58 sport picker as of 2026-06-08 — Tennis + Pickleball only)
2. **sevensix** — biomechanics + audio contact + AI coach UX; tennis-only consumer app
3. **Courtside** — booking only; not CV peer
