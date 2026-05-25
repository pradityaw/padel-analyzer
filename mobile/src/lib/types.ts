export type AnalysisJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type AnalysisJobStageStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AnalysisJobStageProgress = {
  id:
    | "ingestion"
    | "courtCalibration"
    | "playerTracking"
    | "ballTrajectory"
    | "aggregation";
  label: string;
  status: AnalysisJobStageStatus;
  progress: number;
  weight: number;
  message?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
};

export type MetricMap = {
  shoulderRotation: number;
  hipRotation: number;
  elbowAngle: number;
  kneeFlex: number;
  spineAngle: number;
  wristVelocity: number;
};

export type AnalysisPhase = {
  type: "ready" | "backswing" | "forwardSwing" | "contact" | "followThrough";
  startFrame: number;
  endFrame: number;
  score: number;
  metrics: MetricMap;
};

/** [frameIndex, imageX, imageY, confidence] from server CV ball tracker. */
export type BallTrackSample = [number, number, number, number];

export type AnalysisJob = {
  id: number;
  videoFileName: string;
  videoStorageKey: string;
  status: AnalysisJobStatus;
  progress: number;
  statusMessage?: string | null;
  errorMessage?: string | null;
  analysisId?: number | null;
  stages?: AnalysisJobStageProgress[];
  createdAt: string;
  updatedAt: string;
};

export type AnalysisListResponse = {
  items: AnalysisSummary[];
  nextCursor: number | null;
  hasMore: boolean;
};

export type AnalysisSummary = {
  id: number;
  videoFileName: string;
  videoStorageKey?: string | null;
  createdAt: string;
  overallScore: number;
  dominantSide: "left" | "right";
  durationMs: number;
  frameCount: number;
  sampleFps: number;
  shotType?: string | null;
  shotConfidence?: number | null;
  skillLabel?: string | null;
  skillConfidence?: number | null;
  qualityScore?: number | null;
  phasesJson?: string;
  poseDetectionRate?: number | null;
  cameraAngle?: string | null;
  captureMetadataJson?: string | null;
};

export type CvStatus = "pending" | "running" | "done" | "failed";

export type HeatmapPlayer = {
  player_id: number;
  color_hint?: string;
  distance_m?: number;
  heatmap?: number[][];
  trajectory?: [number, number, number][];
};

export type RallyResult = {
  rally_id: number;
  start: number;
  end: number;
  duration_sec: number;
  max_speed: number;
  shot_positions: Record<string, unknown>[];
  player_heatmaps: HeatmapPlayer[];
};

export type CvMatchSummary = {
  rally_count: number;
  total_active_sec: number;
  total_dead_sec: number;
  trim_ratio: number;
  shot_count: number;
};

export type CvGameScore = {
  side_a_points: number;
  side_b_points: number;
  side_a_games: number;
  side_b_games: number;
  display: { side_a: string; side_b: string };
};

export type CvScoringResult = {
  points: Array<{
    point_id: number;
    timestamp_sec: number;
    winning_side: "side_a" | "side_b";
    rally_id: number;
  }>;
  score: CvGameScore;
};

export type CvMatchResult = {
  trimmed_video_url: string | null;
  rallies: RallyResult[];
  summary: CvMatchSummary;
  raw: {
    trimming: unknown;
    ball_tracking: unknown | null;
    player_tracking: unknown | null;
    scoring?: CvScoringResult | null;
  };
  capabilities: {
    dead_time_trimming: boolean;
    court_mapping: boolean;
    player_tracking: boolean;
    player_tracking_available: boolean;
    scoring?: boolean;
  };
};

export type AnalysisDetail = AnalysisSummary & {
  thumbnailPath?: string | null;
  landmarksJson: string;
  phasesJson: string;
  /** Frame-indexed ball samples from `analysis.getById` (optional on older sessions). */
  ballTracking?: BallTrackSample[];
  cvStatus?: CvStatus | null;
  cvResult?: CvMatchResult | null;
};

export type AuthSession = {
  authMode: "off" | "on";
  user: { id: number; email: string } | null;
};

export type ProComparison = {
  id: number;
  playerAnalysisId: number;
  proAnalysisId: number | null;
  shotType: string;
  gapAnalysisJson: string;
  notes: string | null;
  createdAt: string;
  playerFileName: string;
  playerScore: number;
  proFileName: string | null;
  proScore: number | null;
};
