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
  durationMs: number;
  frameCount: number;
  sampleFps: number;
  shotType?: ShotType;
  shotConfidence?: number;
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

export const PHASE_ORDER: SwingPhaseType[] = [
  "ready",
  "backswing",
  "forwardSwing",
  "contact",
  "followThrough",
];

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
