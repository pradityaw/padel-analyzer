import { PHASE_ORDER } from "../../shared/config.js";
import type {
  PrHighlightsV1,
  SwingPhase,
  SwingPhaseType,
} from "../../shared/types.js";

function safeParsePhases(json: string): SwingPhase[] | null {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return null;
    return v as SwingPhase[];
  } catch {
    return null;
  }
}

function phaseByType(phases: SwingPhase[]): Map<SwingPhaseType, SwingPhase> {
  const m = new Map<SwingPhaseType, SwingPhase>();
  for (const p of phases) {
    m.set(p.type, p);
  }
  return m;
}

/**
 * Compare the new swing against all rows already in `analyses` (caller must query before insert).
 * Strict PR: new value must be strictly greater than historical max (ties are not PRs).
 */
export function computePrHighlights(
  priorRows: { overallScore: number; phasesJson: string }[],
  newOverallScore: number,
  newPhasesJson: string
): PrHighlightsV1 {
  const newPhases = safeParsePhases(newPhasesJson);
  const empty: PrHighlightsV1 = {
    version: 1,
    overallScorePr: false,
    overallPreviousBest: null,
    phasePr: {},
    phasePreviousBest: {},
    wristVelocityPr: {},
    wristVelocityPreviousBest: {},
  };

  if (!newPhases) return empty;

  const newMap = phaseByType(newPhases);

  if (priorRows.length === 0) {
    return {
      ...empty,
      overallPreviousBest: null,
    };
  }

  let maxOverall = -Infinity;
  const maxPhaseScore = new Map<SwingPhaseType, number>();
  const maxWrist = new Map<SwingPhaseType, number>();

  for (const t of PHASE_ORDER) {
    maxPhaseScore.set(t, -Infinity);
    maxWrist.set(t, -Infinity);
  }

  for (const row of priorRows) {
    if (row.overallScore > maxOverall) maxOverall = row.overallScore;
    const parsed = safeParsePhases(row.phasesJson);
    if (!parsed) continue;
    const pm = phaseByType(parsed);
    for (const t of PHASE_ORDER) {
      const p = pm.get(t);
      if (!p) continue;
      const curS = maxPhaseScore.get(t) ?? -Infinity;
      if (p.score > curS) maxPhaseScore.set(t, p.score);
      const curW = maxWrist.get(t) ?? -Infinity;
      if (p.metrics.wristVelocity > curW) maxWrist.set(t, p.metrics.wristVelocity);
    }
  }

  const overallPreviousBest = Number.isFinite(maxOverall) ? maxOverall : null;
  const overallScorePr =
    overallPreviousBest !== null && newOverallScore > overallPreviousBest;

  const phasePr: Partial<Record<SwingPhaseType, boolean>> = {};
  const phasePreviousBest: Partial<Record<SwingPhaseType, number | null>> = {};
  const wristVelocityPr: Partial<Record<SwingPhaseType, boolean>> = {};
  const wristVelocityPreviousBest: Partial<
    Record<SwingPhaseType, number | null>
  > = {};

  for (const t of PHASE_ORDER) {
    const p = newMap.get(t);
    const prevS = maxPhaseScore.get(t);
    const prevBest =
      prevS !== undefined && Number.isFinite(prevS) && prevS > -Infinity
        ? prevS
        : null;
    phasePreviousBest[t] = prevBest;
    if (p && prevBest !== null) {
      phasePr[t] = p.score > prevBest;
    } else if (p && prevBest === null) {
      phasePr[t] = false;
    }

    const prevW = maxWrist.get(t);
    const prevWBest =
      prevW !== undefined && Number.isFinite(prevW) && prevW > -Infinity
        ? prevW
        : null;
    wristVelocityPreviousBest[t] = prevWBest;
    if (p && prevWBest !== null) {
      wristVelocityPr[t] = p.metrics.wristVelocity > prevWBest;
    } else if (p && prevWBest === null) {
      wristVelocityPr[t] = false;
    }
  }

  return {
    version: 1,
    overallScorePr,
    overallPreviousBest,
    phasePr,
    phasePreviousBest,
    wristVelocityPr,
    wristVelocityPreviousBest,
  };
}
