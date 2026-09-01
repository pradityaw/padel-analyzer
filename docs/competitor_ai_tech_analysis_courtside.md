# Competitor Analysis — Courtside. (Padel Marketplace)

**Orchestrator report** · 2026-06-08  
**Target:** Courtside. - Padel App (`com.startive.courtside` / `com.startive.courtside.app`)  
**Artifacts:** [PUBLIC_RESEARCH](agent-device-artifacts/competitor-tech-analysis/courtside/PUBLIC_RESEARCH.md) · [REPO_SYNTHESIS](agent-device-artifacts/competitor-tech-analysis/courtside/REPO_SYNTHESIS.md)

## Run status

| Workstream | Status |
|------------|--------|
| Public tech research | **Complete** |
| Repo synthesis | **Complete** |
| Device capture | **Not started** — booking app; low priority for CV peer analysis |
| Observed device UI | **None** |

## Verdict

**Courtside is not an AI video-analysis competitor.** It is Indonesia's padel-only **booking, events, coaching, and club-ops marketplace** (~400+ clubs). Overlap with Padel Analyzer is **padel match lifecycle** (find court → play), not perception pipelines.

## Key public findings

1. **Book-pay-play in ~3 minutes** — court discovery, local payment gateways, events, coach booking.
2. **Manual match scores** — private matches with RSVP; no video upload or CV in store/T&C.
3. **B2B Club Manager panel** — scheduling, finances, occupancy analytics for venues.
4. **~47 MB app** — consistent with booking shell, not bundled ML models.
5. **Geography: Indonesia only** — relevant for SEA distribution strategy, not CV architecture.

## Padel Analyzer implications

| P | Recommendation | Rationale |
|---|----------------|-----------|
| 1 | **Do not chase booking features** in core analyzer roadmap | Different category (Playtomic-like) |
| 2 | Optional future: **export/share session link** after analysis | Courtside wins on social/booking loop |
| 3 | Partner/integration path for ID market post-MVP | Complementary, not competitive |

## Device capture (optional)

Only needed if validating booking UX patterns — not required for CV competitive positioning.

```bash
ARTIFACTS=docs/agent-device-artifacts/competitor-tech-analysis/courtside \
AGENT_DEVICE_SESSION=competitor-courtside \
TARGET_APP="Courtside." ./scripts/agent-device-competitor-tech-smoke.sh
```
