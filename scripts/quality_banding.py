"""Deterministic heuristic quality-banding for amateur training bootstrap data."""

from __future__ import annotations

from statistics import mean


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def infer_quality_band(analysis: dict) -> dict:
    """Infer a bootstrap quality band from swing analysis outputs.

    This is not intended to replace human labeling. It gives the ingestion
    pipeline a repeatable way to bootstrap beginner/developing/solid_amateur
    labels from existing phase-level scoring.
    """

    phases = analysis.get("phases") or []
    if not phases:
        return {
            "qualityBand": "beginner",
            "qualityScore": 0.0,
            "skillConfidence": 0.35,
            "rationale": "heuristic:no-phases",
        }

    phase_scores = [float(phase.get("score", 0.0)) for phase in phases]
    overall_score = float(analysis.get("overallScore", 0.0))
    phase_floor = min(phase_scores)
    consistency = max(phase_scores) - min(phase_scores)
    phase_avg = mean(phase_scores)

    quality_score = (
        0.55 * overall_score
        + 0.25 * phase_floor
        + 0.10 * phase_avg
        + 0.10 * (100.0 - consistency)
    )
    quality_score = round(clamp(quality_score, 0.0, 100.0), 2)

    if quality_score >= 80:
        band = "solid_amateur"
        distance = quality_score - 80.0
    elif quality_score >= 60:
        band = "developing"
        distance = min(quality_score - 60.0, 80.0 - quality_score)
    else:
        band = "beginner"
        distance = 60.0 - quality_score

    skill_confidence = round(clamp(0.45 + (abs(distance) / 40.0), 0.45, 0.95), 2)
    rationale = (
        "heuristic:"
        f"overall={overall_score:.1f};"
        f"phase_avg={phase_avg:.1f};"
        f"phase_floor={phase_floor:.1f};"
        f"consistency={consistency:.1f}"
    )

    return {
        "qualityBand": band,
        "qualityScore": quality_score,
        "skillConfidence": skill_confidence,
        "rationale": rationale,
    }
