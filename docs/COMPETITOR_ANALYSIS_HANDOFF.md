# Competitor Analysis — Session Handoff

**Saved:** 2026-06-08 (updated end of device capture session 2)  
**Index:** [COMPETITOR_ANALYSIS_INDEX.md](COMPETITOR_ANALYSIS_INDEX.md)  
**Goal:** AI video-analysis competitive positioning for Padel Analyzer (SwingVision, sevensix, Courtside.)

---

## What's done

| App | Public research | Repo synthesis | Device UI | Report |
|-----|-----------------|----------------|-----------|--------|
| **SwingVision** | `competitor-tech-analysis/PUBLIC_RESEARCH.md` | `REPO_SYNTHESIS.md` | **Done** — Jun 2026 v11.9.58 `swingvision/` (Home/Record/Me + sport picker + full setup wizard `09`–`12` + live SETUP `13`) + May 2026 `flow/` (42+ screens) | `competitor_ai_tech_analysis.md` |
| **sevensix** | `sevensix/PUBLIC_RESEARCH.md` | `sevensix/REPO_SYNTHESIS.md` | **Done** — all 4 tabs: TRAINING, VIDEOS, record setup, AI COACH (`05`), PROFILE (`06`) | `competitor_ai_tech_analysis_sevensix.md` |
| **Courtside.** | `courtside/PUBLIC_RESEARCH.md` | `courtside/REPO_SYNTHESIS.md` | Not started (booking-only; low CV priority) | `competitor_ai_tech_analysis_courtside.md` |

**Tooling:** `scripts/agent-device-competitor-tech-smoke.sh`, `scripts/agent-device-signing-env.sh` (now sets `AGENT_DEVICE_SESSION_LOCK=strip`), `scripts/stop-agent-device-qa.sh`

**Device:** Developer Mode on, cert trusted, physical UDID works. **Only one agent-device session at a time** — parallel captures cause `DEVICE_IN_USE`.

---

## Done in session 2 (2026-06-08)

- **sevensix** — AI COACH (`05-ai-coach.png`) + PROFILE (`06-profile.png`) captured; all 4 tabs done. Merged into `competitor_ai_tech_analysis_sevensix.md` + `FLOW_SUMMARY.md`.
- **SwingVision** (v11.9.58) — sport picker (`08`, **no Padel** — Tennis + Pickleball only), full setup wizard (Swing Stick `09`, Height `10`, Zoom `11`, Reminders `12`), live camera SETUP (`13` — Audio-Guided/Manual, HD, 1.0x, FLIP, pink alignment). Home now shows a real recorded session (`06-resume-state.png`). Merged into `competitor_ai_tech_analysis.md`.

## Resume here (next session)

### P1 — SwingVision results (a real session now exists on the account)

- [ ] Open the recorded session (8 Jun 2026, Point by Point, 303 shots — see `06-resume-state.png`) from **Me**/history → capture metrics, coaching, ball trace, latency
- [ ] Rewards / Compete tabs; Settings / subscription gating

### P1 — sevensix post-analysis

- [ ] Swing-score / progression views after a recorded+analysed swing (camera = stop-and-ask)
- [ ] Settings / About sub-screens

```bash
cd /Users/dubski/padel-analyzer
source ./scripts/agent-device-signing-env.sh
./scripts/stop-agent-device-qa.sh
ARTIFACTS=docs/agent-device-artifacts/competitor-tech-analysis/swingvision \
AGENT_DEVICE_SESSION=competitor-swingvision \
TARGET_APP=SwingVision ./scripts/agent-device-competitor-tech-smoke.sh
# then: snapshot -i, press @eN, screenshot. NB: work from Record (Home wedges the runner).
```

Coordinate fallback `(67,812)` Home, `(201,812)` Record, `(354,812)` Me.

### P2 — Optional

- Courtside device (booking UX only)
- New competitor (Playtomic, Liquid, etc.) — same playbook per app folder

---

## Device constants

| Constant | Value |
|----------|-------|
| Physical UDID | `00008150-000262891A28401C` |
| Team ID | `A4756XP2SB` |
| Runner bundle | `com.praditya.agentdevice.runner` |
| Signing env | `source ./scripts/agent-device-signing-env.sh` |

**Guardrails:** Do not bypass login, paywall, or camera permission. Stop and ask user.

**Known issues:**
- iPhone must be **unlocked** during runner launch (~90s first time)
- Text `press Record|Home|Me` can error (`Invalid selector term "NaN"`) — use `@eN` or coordinate taps
- Run `./scripts/stop-agent-device-qa.sh` if `DEVICE_IN_USE`
- **SwingVision Home tab wedges the XCUITest runner** (`main thread execution timed out`) — its media-rich feed never reports idle. Work from the **Record** tab (last-used tab on relaunch); avoid `snapshot`/`press` on Home. Screenshots still work there.
- After a daemon timeout the runner app can foreground and routing can fall back to a **booted simulator** — re-`open` on physical device with explicit `--udid` + `--session-lock strip`, or `stop-agent-device-qa.sh` then relaunch.
- Focusing a text field opens the keyboard and **churns `@eN` refs** every action; tap a neutral content area to dismiss the keyboard before using tab-bar refs (iOS `keyboard dismiss` is unsupported here).

---

## Key conclusions (cross-competitor)

1. **SwingVision** — edge-first CV peer; padel beta is direct threat but **not yet in production** (v11.9.58 sport picker = Tennis + Pickleball only, Observed 2026-06-08); we trail live inference, lead on padel-specific pipeline design.
2. **sevensix** — tennis biomechanics + audio contact + AI coach UX benchmark; not padel consumer app (SportAI B2B for padel).
3. **Courtside** — Indonesia booking only; not a CV competitor.
4. **Our P0 product gaps:** audio contact fusion, subscore UX, unified web/server orchestrator, TrackNet eval, live feedback.

---

## Copy-paste prompt for a new agent window

```
Workstream: tooling / competitive research (not app code unless implications doc)
Branch: stay on current branch; no commits unless I ask

Continue multi-app competitor tech analysis from the saved handoff.

Read first:
- docs/COMPETITOR_ANALYSIS_HANDOFF.md
- docs/COMPETITOR_ANALYSIS_INDEX.md
- docs/COMPETITOR_ANALYSIS_ORCHESTRATOR.md

Context:
- Physical iPhone UDID 00008150-000262891A28401C, Developer Mode on, cert trusted
- source ./scripts/agent-device-signing-env.sh (sets AGENT_DEVICE_SESSION_LOCK=strip)
- ONLY ONE agent-device session at a time — run ./scripts/stop-agent-device-qa.sh before capture

Done:
- SwingVision: public + synthesis + Jun 2026 v11.9.58 device (Home/Record/Me, sport picker [no Padel], full setup wizard, live SETUP) + May flow/
- sevensix: public + synthesis + device all 4 tabs (TRAINING, VIDEOS, record setup, AI COACH, PROFILE)
- Courtside: public research + synthesis only (booking app, not CV peer)

Resume priorities:
1. SwingVision results: open the existing recorded session (06-resume-state.png) from Me/history → metrics, coaching, ball trace
2. sevensix: post-analysis swing-score views (needs a recorded swing — camera = stop-and-ask); Settings/About
3. Merge new Observed evidence into competitor_ai_tech_analysis*.md

Device loop: open → snapshot -i → press @eN or coordinate tap → screenshot → re-snapshot
NB: work from SwingVision's Record tab — the Home feed wedges the XCUITest runner.
Do NOT bypass login, paywall, or camera permission.

Out of scope: binary extraction, paywall bypass, unrelated refactors.
```

---

## Related docs

- `docs/AGENT_DEVICE_SETUP.md`
- `docs/agent-device-artifacts/competitor-tech-analysis/sevensix/FLOW_SUMMARY.md`
- `docs/agent-device-artifacts/competitor-tech-analysis/swingvision/RUN_NOTES.md`
- `docs/agent-device-artifacts/flow/FLOW_SUMMARY.md` (SwingVision May 2026 deep flow)
- `.cursor/rules/agent-device.mdc`
