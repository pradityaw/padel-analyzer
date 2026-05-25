export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

export type FrameLandmarks = {
  frameIndex: number;
  timestamp: number;
  landmarks: Landmark[];
};

/** [frameIndex, imageX, imageY, confidence] from the server CV ball tracker. */
export type BallTrackSample = [number, number, number, number];

/**
 * [frameIndex, playerId, imageX, imageY, confidence] from the server
 * CV racket-head tracker (replaces the wrist-as-racket proxy on the
 * client when present). `confidence < 0.5` flags samples that were
 * interpolated via the elbow→wrist extrapolation; `confidence ≥ 0.5`
 * flags samples that were refined from per-frame motion cues.
 */
export type RacketTrackSample = [number, number, number, number, number];

/** Threshold above which a {@link RacketTrackSample} is considered observed (vs. interpolated). */
export const RACKET_REFINED_CONFIDENCE_THRESHOLD = 0.5;

export type SwingPhaseType =
  | "ready"
  | "backswing"
  | "forwardSwing"
  | "contact"
  | "followThrough";

export type SwingPhase = {
  type: SwingPhaseType;
  startFrame: number;
  endFrame: number;
  score: number;
  metrics: PhaseMetrics;
};

export type PhaseMetrics = {
  shoulderRotation: number;
  hipRotation: number;
  elbowAngle: number;
  kneeFlex: number;
  spineAngle: number;
  wristVelocity: number;
};

export type AnalysisResult = {
  overallScore: number;
  dominantSide: "left" | "right";
  phases: SwingPhase[];
  frameLandmarks: FrameLandmarks[];
  ballTracking?: BallTrackSample[];
  /**
   * Per-frame racket-head positions emitted by the Python racket
   * tracker. Optional because older sessions (pre-Phase-2) lack the
   * artifact — consumers must fall back to the wrist landmark when
   * this field is missing or empty.
   */
  racketTracking?: RacketTrackSample[];
  durationMs: number;
  frameCount: number;
  sampleFps: number;
  shotType?: ShotType;
  shotConfidence?: number;
  skillLabel?: QualityBand;
  skillConfidence?: number;
  qualityScore?: number;
};

export type MetricStatus = "good" | "improve" | "issue";

export type MetricFeedback = {
  name: string;
  value: number;
  unit: string;
  idealRange: [number, number];
  status: MetricStatus;
  tip: string;
};

export const PHASE_LABELS: Record<SwingPhaseType, string> = {
  ready: "Ready",
  backswing: "Backswing",
  forwardSwing: "Forward Swing",
  contact: "Contact",
  followThrough: "Follow-Through",
};

export const PHASE_COLORS: Record<SwingPhaseType, string> = {
  ready: "#8b5cf6",
  backswing: "#3b82f6",
  forwardSwing: "#f59e0b",
  contact: "#ef4444",
  followThrough: "#22c55e",
};

// Shot type classification
export const SHOT_TYPES = [
  "bandeja",
  "vibora",
  "smash",
  "volley",
  "drive",
  "lob",
  "bajada",
  "other",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  bandeja: "Bandeja",
  vibora: "Vibora",
  smash: "Smash",
  volley: "Volley",
  drive: "Drive",
  lob: "Lob",
  bajada: "Bajada",
  other: "Other",
};

export const SHOT_TYPE_COLORS: Record<ShotType, string> = {
  bandeja: "#f59e0b",
  vibora: "#ef4444",
  smash: "#dc2626",
  volley: "#3b82f6",
  drive: "#22c55e",
  lob: "#a78bfa",
  bajada: "#f97316",
  other: "#64748b",
};

// Reference / training metadata (annotations, benchmarks, skill labels)
export const REFERENCE_TIERS = ["none", "pro", "amateur_curated"] as const;
export type ReferenceTier = (typeof REFERENCE_TIERS)[number];

export const QUALITY_BANDS = [
  "pro",
  "beginner",
  "developing",
  "solid_amateur",
] as const;
export type QualityBand = (typeof QUALITY_BANDS)[number];

export const REFERENCE_SOURCE_TYPES = [
  "bulk_import",
  "youtube",
  "manual",
] as const;
export type ReferenceSourceType = (typeof REFERENCE_SOURCE_TYPES)[number];

// Pro vs Player gap analysis types
export type MetricGap = {
  metric: string;
  name: string;
  unit: string;
  playerValue: number;
  proValue: number;
  delta: number;
  percentDelta: number;
  phase: SwingPhaseType;
  importance: number;
  status: MetricStatus;
  tip: string;
};

export type PhaseGap = {
  phase: SwingPhaseType;
  playerScore: number;
  proScore: number;
  delta: number;
};

export type GapAnalysis = {
  shotType: ShotType | string;
  overallGapScore: number;
  phaseGaps: PhaseGap[];
  metricGaps: MetricGap[];
  topInsights: string[];
};

export type ProBenchmarkData = {
  shotType: ShotType;
  sampleCount: number;
  phases: Record<SwingPhaseType, PhaseMetrics>;
};

export const METRIC_LABELS: Record<string, { name: string; unit: string }> = {
  shoulderRotation: { name: "Shoulder Rotation", unit: "°" },
  hipRotation: { name: "Hip Rotation", unit: "°" },
  elbowAngle: { name: "Elbow Angle", unit: "°" },
  kneeFlex: { name: "Knee Flex", unit: "°" },
  spineAngle: { name: "Spine Lean", unit: "°" },
  wristVelocity: { name: "Wrist Speed", unit: "u/s" },
};
