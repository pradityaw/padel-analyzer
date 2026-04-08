/**
 * Gap analysis engine: compares player swing metrics against pro reference.
 * Runs client-side, consistent with the existing analysis pattern.
 */

import type {
  SwingPhase,
  SwingPhaseType,
  PhaseMetrics,
  MetricStatus,
  MetricGap,
  PhaseGap,
  GapAnalysis,
  ShotType,
} from "@shared/types";
import { PHASE_LABELS, METRIC_LABELS } from "@shared/types";

// Metric weights by phase (mirrors GENERIC_RANGES from swingAnalyzer.ts)
const METRIC_WEIGHTS: Record<SwingPhaseType, Record<string, number>> = {
  ready: { kneeFlex: 0.4, spineAngle: 0.3, shoulderRotation: 0.3 },
  backswing: { shoulderRotation: 0.4, hipRotation: 0.3, elbowAngle: 0.3 },
  forwardSwing: { shoulderRotation: 0.35, hipRotation: 0.35, elbowAngle: 0.3 },
  contact: {
    elbowAngle: 0.3,
    shoulderRotation: 0.25,
    hipRotation: 0.2,
    kneeFlex: 0.15,
    spineAngle: 0.1,
  },
  followThrough: { shoulderRotation: 0.4, elbowAngle: 0.3, spineAngle: 0.3 },
};

// Typical range spans for normalization (so a 20° gap in elbow matters more
// than 20° in shoulder if elbow has tighter expected variation)
const METRIC_RANGE_SPANS: Record<string, number> = {
  shoulderRotation: 40,
  hipRotation: 30,
  elbowAngle: 50,
  kneeFlex: 30,
  spineAngle: 20,
  wristVelocity: 0.5,
};

function getStatus(normalizedDelta: number): MetricStatus {
  const absDelta = Math.abs(normalizedDelta);
  if (absDelta < 0.25) return "good";
  if (absDelta < 0.6) return "improve";
  return "issue";
}

function generateTip(
  phase: SwingPhaseType,
  metric: string,
  playerVal: number,
  proVal: number
): string {
  const label = METRIC_LABELS[metric]?.name ?? metric;
  const phaseName = PHASE_LABELS[phase].toLowerCase();
  const unit = METRIC_LABELS[metric]?.unit ?? "";
  const diff = Math.abs(Math.round(playerVal - proVal));
  const direction = playerVal < proVal ? "below" : "above";

  const tips: Record<string, Record<string, { low: string; high: string }>> = {
    ready: {
      kneeFlex: {
        low: `Bend your knees more in your ready stance — you're ${diff}${unit} less flexed than pros.`,
        high: `Don't over-bend in your ready position — straighten up ${diff}${unit} to match pro posture.`,
      },
      spineAngle: {
        low: `Good spine position! Stay upright.`,
        high: `You're leaning ${diff}${unit} more than pros in ready position — stand taller.`,
      },
      shoulderRotation: {
        low: `Good square stance!`,
        high: `Your shoulders are ${diff}${unit} too rotated in ready position — face the net more squarely.`,
      },
    },
    backswing: {
      shoulderRotation: {
        low: `Rotate your shoulders ${diff}${unit} more on the backswing — pros generate more power this way.`,
        high: `You're over-rotating ${diff}${unit} on the backswing — keep it more compact.`,
      },
      hipRotation: {
        low: `Engage your hips more — pros rotate ${diff}${unit} more in the backswing.`,
        high: `Your hip rotation is ${diff}${unit} beyond pro range — let your shoulders lead.`,
      },
      elbowAngle: {
        low: `Keep your elbow tighter — you're ${diff}${unit} more open than pros.`,
        high: `Your elbow is ${diff}${unit} too compact — give yourself room to accelerate.`,
      },
    },
    forwardSwing: {
      shoulderRotation: {
        low: `Drive your shoulders ${diff}${unit} more — this is your power source.`,
        high: `Your shoulder rotation is ${diff}${unit} past pro range — focus on control.`,
      },
      hipRotation: {
        low: `Lead with your hips more — pros rotate ${diff}${unit} more to transfer leg power.`,
        high: `Dial back hip rotation by ${diff}${unit} for better control.`,
      },
      elbowAngle: {
        low: `Extend your elbow ${diff}${unit} more through the forward swing.`,
        high: `Your arm is extending ${diff}${unit} too early — keep the extension for contact.`,
      },
    },
    contact: {
      elbowAngle: {
        low: `Extend your arm ${diff}${unit} more at contact — pros hit with a nearly straight arm.`,
        high: `Your arm is ${diff}${unit} too extended at contact — slight bend gives more control.`,
      },
      shoulderRotation: {
        low: `Rotate your shoulders ${diff}${unit} more through contact.`,
        high: `You're over-rotating by ${diff}${unit} at contact — control the finish.`,
      },
      hipRotation: {
        low: `Your hips should be ${diff}${unit} more rotated at contact.`,
        high: `Hips are ${diff}${unit} past ideal — stabilize through the hit.`,
      },
      kneeFlex: {
        low: `Maintain more knee bend at contact — you're ${diff}${unit} straighter than pros.`,
        high: `You're ${diff}${unit} too bent at contact — drive up through the ball.`,
      },
      spineAngle: {
        low: `Good spine angle!`,
        high: `You're leaning ${diff}${unit} more than pros at contact — stay centered.`,
      },
    },
    followThrough: {
      shoulderRotation: {
        low: `Let your shoulders rotate ${diff}${unit} more through the finish.`,
        high: `Over-rotating by ${diff}${unit} in follow-through — decelerate naturally.`,
      },
      elbowAngle: {
        low: `Allow your arm to extend ${diff}${unit} more in the follow-through.`,
        high: `Your arm is ${diff}${unit} too straight — let it relax after contact.`,
      },
      spineAngle: {
        low: `Good follow-through posture!`,
        high: `You're leaning ${diff}${unit} more than pros — stay balanced.`,
      },
    },
  };

  const phaseTips = tips[phase]?.[metric];
  if (!phaseTips) {
    return `Your ${label} during ${phaseName} is ${diff}${unit} ${direction} pro level.`;
  }

  return playerVal < proVal ? phaseTips.low : phaseTips.high;
}

/**
 * Compute full gap analysis between player and pro swing phases.
 */
export function computeGapAnalysis(
  playerPhases: SwingPhase[],
  proPhases: SwingPhase[],
  shotType: ShotType | string
): GapAnalysis {
  const metricGaps: MetricGap[] = [];
  const phaseGaps: PhaseGap[] = [];

  for (const playerPhase of playerPhases) {
    const proPhase = proPhases.find((p) => p.type === playerPhase.type);
    if (!proPhase) continue;

    phaseGaps.push({
      phase: playerPhase.type,
      playerScore: playerPhase.score,
      proScore: proPhase.score,
      delta: playerPhase.score - proPhase.score,
    });

    const weights = METRIC_WEIGHTS[playerPhase.type] ?? {};

    for (const [metric, weight] of Object.entries(weights)) {
      const playerVal = playerPhase.metrics[metric as keyof PhaseMetrics];
      const proVal = proPhase.metrics[metric as keyof PhaseMetrics];
      if (playerVal == null || proVal == null) continue;

      const delta = playerVal - proVal;
      const span = METRIC_RANGE_SPANS[metric] ?? 30;
      const normalizedDelta = delta / span;
      const importance = weight * Math.abs(normalizedDelta);
      const percentDelta =
        proVal !== 0 ? ((playerVal - proVal) / proVal) * 100 : 0;

      const label = METRIC_LABELS[metric] ?? { name: metric, unit: "" };

      metricGaps.push({
        metric,
        name: label.name,
        unit: label.unit,
        playerValue: Math.round(playerVal * 10) / 10,
        proValue: Math.round(proVal * 10) / 10,
        delta: Math.round(delta * 10) / 10,
        percentDelta: Math.round(percentDelta),
        phase: playerPhase.type,
        importance: Math.round(importance * 1000) / 1000,
        status: getStatus(normalizedDelta),
        tip: generateTip(playerPhase.type, metric, playerVal, proVal),
      });
    }
  }

  // Sort by importance descending
  metricGaps.sort((a, b) => b.importance - a.importance);

  // Overall gap score: average of phase score similarities
  const overallGapScore =
    phaseGaps.length > 0
      ? Math.round(
          phaseGaps.reduce((sum, pg) => {
            // Score similarity: 100 minus absolute difference, clamped 0-100
            return sum + Math.max(0, 100 - Math.abs(pg.delta));
          }, 0) / phaseGaps.length
        )
      : 0;

  // Top 3 insights from highest importance gaps
  const topInsights = metricGaps
    .filter((g) => g.status !== "good")
    .slice(0, 3)
    .map((g) => g.tip);

  return {
    shotType,
    overallGapScore,
    phaseGaps,
    metricGaps,
    topInsights,
  };
}

/**
 * Compute aggregated pro benchmark from multiple pro analyses' phases.
 */
export function computeProBenchmarkFromPhases(
  allProPhases: SwingPhase[][]
): Record<SwingPhaseType, PhaseMetrics> {
  const phaseTypes: SwingPhaseType[] = [
    "ready",
    "backswing",
    "forwardSwing",
    "contact",
    "followThrough",
  ];
  const metricKeys: (keyof PhaseMetrics)[] = [
    "shoulderRotation",
    "hipRotation",
    "elbowAngle",
    "kneeFlex",
    "spineAngle",
    "wristVelocity",
  ];

  const result = {} as Record<SwingPhaseType, PhaseMetrics>;

  for (const phaseType of phaseTypes) {
    const matching = allProPhases
      .map((phases) => phases.find((p) => p.type === phaseType))
      .filter(Boolean) as SwingPhase[];

    if (matching.length === 0) {
      result[phaseType] = {
        shoulderRotation: 0,
        hipRotation: 0,
        elbowAngle: 0,
        kneeFlex: 0,
        spineAngle: 0,
        wristVelocity: 0,
      };
      continue;
    }

    const avgMetrics = {} as PhaseMetrics;
    for (const key of metricKeys) {
      const values = matching.map((p) => p.metrics[key]);
      avgMetrics[key] = values.reduce((a, b) => a + b, 0) / values.length;
    }
    result[phaseType] = avgMetrics;
  }

  return result;
}
