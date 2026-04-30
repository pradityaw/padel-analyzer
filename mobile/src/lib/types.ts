export type AnalysisJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

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

export type AnalysisJob = {
  id: number;
  videoFileName: string;
  videoStorageKey: string;
  status: AnalysisJobStatus;
  progress: number;
  statusMessage?: string | null;
  errorMessage?: string | null;
  analysisId?: number | null;
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
};

export type AnalysisDetail = AnalysisSummary & {
  thumbnailPath?: string | null;
  landmarksJson: string;
  phasesJson: string;
};
