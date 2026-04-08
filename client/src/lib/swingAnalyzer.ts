import type {
  Landmark,
  FrameLandmarks,
  SwingPhase,
  SwingPhaseType,
  PhaseMetrics,
  AnalysisResult,
  MetricStatus,
  MetricFeedback,
  ShotType,
} from "@shared/types";
import { classifyShotType, isModelAvailable } from "./shotClassifier";

// MediaPipe landmark indices
const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function vec2Angle(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax) * (180 / Math.PI);
}

function angleBetween(a: Landmark, b: Landmark, c: Landmark): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA === 0 || magBC === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

function distance(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function detectDominantSide(
  frames: FrameLandmarks[]
): "left" | "right" {
  let leftActivity = 0;
  let rightActivity = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].landmarks;
    const curr = frames[i].landmarks;
    leftActivity += distance(prev[LM.LEFT_WRIST], curr[LM.LEFT_WRIST]);
    rightActivity += distance(prev[LM.RIGHT_WRIST], curr[LM.RIGHT_WRIST]);
  }

  return rightActivity >= leftActivity ? "right" : "left";
}

export function extractMetrics(
  landmarks: Landmark[],
  dominant: "left" | "right",
  prevLandmarks?: Landmark[],
  dt?: number
): PhaseMetrics {
  const ls = landmarks[LM.LEFT_SHOULDER];
  const rs = landmarks[LM.RIGHT_SHOULDER];
  const lh = landmarks[LM.LEFT_HIP];
  const rh = landmarks[LM.RIGHT_HIP];

  const shoulderRotation = Math.abs(vec2Angle(ls.x, ls.y, rs.x, rs.y));
  const hipRotation = Math.abs(vec2Angle(lh.x, lh.y, rh.x, rh.y));

  const shoulder =
    dominant === "right"
      ? landmarks[LM.RIGHT_SHOULDER]
      : landmarks[LM.LEFT_SHOULDER];
  const elbow =
    dominant === "right"
      ? landmarks[LM.RIGHT_ELBOW]
      : landmarks[LM.LEFT_ELBOW];
  const wrist =
    dominant === "right"
      ? landmarks[LM.RIGHT_WRIST]
      : landmarks[LM.LEFT_WRIST];
  const hip =
    dominant === "right" ? landmarks[LM.RIGHT_HIP] : landmarks[LM.LEFT_HIP];
  const knee =
    dominant === "right"
      ? landmarks[LM.RIGHT_KNEE]
      : landmarks[LM.LEFT_KNEE];
  const ankle =
    dominant === "right"
      ? landmarks[LM.RIGHT_ANKLE]
      : landmarks[LM.LEFT_ANKLE];

  const elbowAngle = angleBetween(shoulder, elbow, wrist);
  const kneeFlex = angleBetween(hip, knee, ankle);

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  const spineAngle = Math.abs(
    90 - Math.abs(vec2Angle(hipMid.x, hipMid.y, shoulderMid.x, shoulderMid.y))
  );

  let wristVelocity = 0;
  if (prevLandmarks && dt && dt > 0) {
    const prevWrist =
      dominant === "right"
        ? prevLandmarks[LM.RIGHT_WRIST]
        : prevLandmarks[LM.LEFT_WRIST];
    wristVelocity = distance(wrist, prevWrist) / dt;
  }

  return {
    shoulderRotation,
    hipRotation,
    elbowAngle,
    kneeFlex,
    spineAngle,
    wristVelocity,
  };
}

export function detectPhases(
  frames: FrameLandmarks[],
  dominant: "left" | "right"
): SwingPhase[] {
  if (frames.length < 10) return [];

  const metricsPerFrame: PhaseMetrics[] = [];
  for (let i = 0; i < frames.length; i++) {
    const prev = i > 0 ? frames[i - 1].landmarks : undefined;
    const dt =
      i > 0 ? (frames[i].timestamp - frames[i - 1].timestamp) / 1000 : undefined;
    metricsPerFrame.push(
      extractMetrics(frames[i].landmarks, dominant, prev, dt)
    );
  }

  // Find peak wrist velocity frame as the contact point
  let peakVelFrame = 0;
  let peakVel = 0;
  for (let i = 0; i < metricsPerFrame.length; i++) {
    if (metricsPerFrame[i].wristVelocity > peakVel) {
      peakVel = metricsPerFrame[i].wristVelocity;
      peakVelFrame = i;
    }
  }

  // Simple threshold-based phase segmentation around the contact frame
  const contactStart = Math.max(0, peakVelFrame - 3);
  const contactEnd = Math.min(frames.length - 1, peakVelFrame + 3);

  // Find backswing start: wrist velocity first exceeds threshold before contact
  const velThreshold = peakVel * 0.15;
  let backswingStart = 0;
  for (let i = contactStart - 1; i >= 0; i--) {
    if (metricsPerFrame[i].wristVelocity < velThreshold) {
      backswingStart = i;
      break;
    }
  }

  // Forward swing starts where acceleration reverses direction toward contact
  const forwardStart = Math.floor(
    backswingStart + (contactStart - backswingStart) * 0.5
  );

  // Follow-through: after contact until end or velocity drops
  let followEnd = frames.length - 1;
  for (let i = contactEnd + 1; i < frames.length; i++) {
    if (metricsPerFrame[i].wristVelocity < velThreshold) {
      followEnd = i;
      break;
    }
  }

  function avgMetrics(start: number, end: number): PhaseMetrics {
    const slice = metricsPerFrame.slice(start, end + 1);
    const n = slice.length || 1;
    return {
      shoulderRotation:
        slice.reduce((s, m) => s + m.shoulderRotation, 0) / n,
      hipRotation: slice.reduce((s, m) => s + m.hipRotation, 0) / n,
      elbowAngle: slice.reduce((s, m) => s + m.elbowAngle, 0) / n,
      kneeFlex: slice.reduce((s, m) => s + m.kneeFlex, 0) / n,
      spineAngle: slice.reduce((s, m) => s + m.spineAngle, 0) / n,
      wristVelocity: slice.reduce((s, m) => s + m.wristVelocity, 0) / n,
    };
  }

  const phases: SwingPhase[] = [
    {
      type: "ready",
      startFrame: 0,
      endFrame: backswingStart,
      score: 0,
      metrics: avgMetrics(0, backswingStart),
    },
    {
      type: "backswing",
      startFrame: backswingStart,
      endFrame: forwardStart,
      score: 0,
      metrics: avgMetrics(backswingStart, forwardStart),
    },
    {
      type: "forwardSwing",
      startFrame: forwardStart,
      endFrame: contactStart,
      score: 0,
      metrics: avgMetrics(forwardStart, contactStart),
    },
    {
      type: "contact",
      startFrame: contactStart,
      endFrame: contactEnd,
      score: 0,
      metrics: avgMetrics(contactStart, contactEnd),
    },
    {
      type: "followThrough",
      startFrame: contactEnd,
      endFrame: followEnd,
      score: 0,
      metrics: avgMetrics(contactEnd, followEnd),
    },
  ];

  for (const phase of phases) {
    phase.score = scorePhase(phase.type, phase.metrics);
  }

  return phases;
}

// Default generic ranges (used when no trained model/ranges available)
const GENERIC_RANGES: Record<
  SwingPhaseType,
  Record<string, { range: [number, number]; weight: number }>
> = {
  ready: {
    kneeFlex: { range: [150, 170], weight: 0.4 },
    spineAngle: { range: [0, 15], weight: 0.3 },
    shoulderRotation: { range: [0, 20], weight: 0.3 },
  },
  backswing: {
    shoulderRotation: { range: [30, 60], weight: 0.4 },
    hipRotation: { range: [15, 35], weight: 0.3 },
    elbowAngle: { range: [70, 110], weight: 0.3 },
  },
  forwardSwing: {
    shoulderRotation: { range: [20, 50], weight: 0.35 },
    hipRotation: { range: [25, 50], weight: 0.35 },
    elbowAngle: { range: [90, 140], weight: 0.3 },
  },
  contact: {
    elbowAngle: { range: [140, 165], weight: 0.3 },
    shoulderRotation: { range: [40, 60], weight: 0.25 },
    hipRotation: { range: [35, 55], weight: 0.2 },
    kneeFlex: { range: [150, 170], weight: 0.15 },
    spineAngle: { range: [0, 15], weight: 0.1 },
  },
  followThrough: {
    shoulderRotation: { range: [50, 80], weight: 0.4 },
    elbowAngle: { range: [100, 160], weight: 0.3 },
    spineAngle: { range: [0, 20], weight: 0.3 },
  },
};

// Dynamic shot-type-specific ranges loaded from trained model data
type RangesMap = Record<
  string,
  Record<string, Record<string, { range: [number, number]; weight: number }>>
>;
let loadedRanges: RangesMap | null = null;

async function loadShotTypeRanges(): Promise<RangesMap> {
  if (loadedRanges) return loadedRanges;
  try {
    const resp = await fetch("/models/shot_type_ranges.json");
    if (resp.ok) {
      loadedRanges = await resp.json();
      return loadedRanges!;
    }
  } catch {
    // No trained ranges available yet
  }
  return {};
}

function getRangesForShot(
  shotType: ShotType | undefined,
  phase: SwingPhaseType,
  rangesMap: RangesMap
): Record<string, { range: [number, number]; weight: number }> {
  // Try shot-type-specific ranges first
  if (shotType && rangesMap[shotType]?.[phase]) {
    return rangesMap[shotType][phase];
  }
  // Fall back to generic
  return rangesMap["generic"]?.[phase] ?? GENERIC_RANGES[phase];
}

function rangeScore(value: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (value >= lo && value <= hi) return 100;
  const dist = value < lo ? lo - value : value - hi;
  const span = hi - lo || 1;
  return Math.max(0, 100 - (dist / span) * 100);
}

function scorePhase(
  phase: SwingPhaseType,
  metrics: PhaseMetrics,
  ranges?: Record<string, { range: [number, number]; weight: number }>
): number {
  ranges = ranges ?? GENERIC_RANGES[phase];
  let total = 0;
  let totalWeight = 0;

  for (const [key, { range, weight }] of Object.entries(ranges)) {
    const val = metrics[key as keyof PhaseMetrics];
    total += rangeScore(val, range) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(total / totalWeight) : 50;
}

export async function analyzeSwing(frames: FrameLandmarks[]): Promise<AnalysisResult> {
  const dominantSide = detectDominantSide(frames);

  // Classify shot type if model is available
  let shotType: ShotType | undefined;
  let shotConfidence: number | undefined;

  const modelReady = await isModelAvailable();
  if (modelReady) {
    const classification = await classifyShotType(frames, dominantSide);
    if (classification && classification.confidence >= 0.3) {
      shotType = classification.shotType;
      shotConfidence = classification.confidence;
    }
  }

  // Load shot-type-specific ranges
  const rangesMap = await loadShotTypeRanges();

  const phases = detectPhases(frames, dominantSide);

  // Re-score phases with shot-type-specific ranges
  for (const phase of phases) {
    const ranges = getRangesForShot(shotType, phase.type, rangesMap);
    phase.score = scorePhase(phase.type, phase.metrics, ranges);
  }

  const overallScore =
    phases.length > 0
      ? Math.round(phases.reduce((s, p) => s + p.score, 0) / phases.length)
      : 0;

  const lastFrame = frames[frames.length - 1];
  const durationMs = lastFrame ? lastFrame.timestamp : 0;

  return {
    overallScore,
    dominantSide,
    phases,
    frameLandmarks: frames,
    durationMs,
    frameCount: frames.length,
    sampleFps: 15,
    shotType,
    shotConfidence,
  };
}

export function getMetricFeedback(
  phase: SwingPhaseType,
  metrics: PhaseMetrics,
  shotType?: ShotType
): MetricFeedback[] {
  // Use shot-type-specific ranges if available, otherwise generic
  const ranges =
    shotType && loadedRanges?.[shotType]?.[phase]
      ? loadedRanges[shotType][phase]
      : GENERIC_RANGES[phase];
  const feedback: MetricFeedback[] = [];

  const labels: Record<string, { name: string; unit: string }> = {
    shoulderRotation: { name: "Shoulder Rotation", unit: "°" },
    hipRotation: { name: "Hip Rotation", unit: "°" },
    elbowAngle: { name: "Elbow Angle", unit: "°" },
    kneeFlex: { name: "Knee Flex", unit: "°" },
    spineAngle: { name: "Spine Lean", unit: "°" },
    wristVelocity: { name: "Wrist Speed", unit: "u/s" },
  };

  for (const [key, { range }] of Object.entries(ranges)) {
    const value = metrics[key as keyof PhaseMetrics];
    const score = rangeScore(value, range);
    let status: MetricStatus = "good";
    if (score < 50) status = "issue";
    else if (score < 80) status = "improve";

    const label = labels[key] || { name: key, unit: "" };
    feedback.push({
      name: label.name,
      value: Math.round(value * 10) / 10,
      unit: label.unit,
      idealRange: range,
      status,
      tip: getTip(phase, key, status),
    });
  }

  return feedback;
}

function getTip(
  phase: SwingPhaseType,
  metric: string,
  status: MetricStatus
): string {
  if (status === "good") return "Looking great! Keep it up.";

  const tips: Record<string, Record<string, string>> = {
    ready: {
      kneeFlex: "Bend your knees more — a lower stance gives more power.",
      spineAngle: "Keep your torso upright during the ready position.",
      shoulderRotation: "Face the net squarely in your ready stance.",
    },
    backswing: {
      shoulderRotation:
        "Rotate your shoulders more on the backswing for power.",
      hipRotation: "Engage your hips — let them turn with the shoulders.",
      elbowAngle: "Keep your elbow compact on the backswing.",
    },
    forwardSwing: {
      shoulderRotation:
        "Drive your shoulder rotation forward — this is your power source.",
      hipRotation: "Lead with your hips to transfer energy from legs to arm.",
      elbowAngle: "Extend your elbow progressively through the swing.",
    },
    contact: {
      elbowAngle:
        "At contact, your arm should be nearly extended (140–165°).",
      shoulderRotation:
        "Aim for 40–60° shoulder rotation at the contact point.",
      hipRotation: "Your hips should be roughly 35–55° rotated at contact.",
      kneeFlex: "Maintain a slight bend — don't lock your knees.",
      spineAngle: "Keep your spine relatively straight through contact.",
    },
    followThrough: {
      shoulderRotation: "Let your shoulders fully rotate through the ball.",
      elbowAngle: "Allow your arm to naturally decelerate after contact.",
      spineAngle: "Avoid excessive lean in the follow-through.",
    },
  };

  return tips[phase]?.[metric] || "Focus on this area for improvement.";
}
