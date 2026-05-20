import type {
  AnalysisJobStageId,
  AnalysisJobStageProgress,
} from "../../shared/schema.js";

type StageDefinition = {
  id: AnalysisJobStageId;
  label: string;
  weight: number;
};

const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: "ingestion", label: "Video ingestion", weight: 5 },
  { id: "courtCalibration", label: "Agent A: court calibration", weight: 20 },
  { id: "playerTracking", label: "Agent B: skeleton and racket tracking", weight: 35 },
  { id: "ballTrajectory", label: "Agent C: ball trajectory", weight: 25 },
  { id: "aggregation", label: "Result aggregation", weight: 15 },
];

const progressByJob = new Map<number, AnalysisJobStageProgress[]>();

function initialStages(): AnalysisJobStageProgress[] {
  return STAGE_DEFINITIONS.map((stage) => ({
    ...stage,
    status: "queued",
    progress: 0,
    message: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
  }));
}

function cloneStages(stages: AnalysisJobStageProgress[]): AnalysisJobStageProgress[] {
  return stages.map((stage) => ({ ...stage }));
}

export function initializeAnalysisJobProgress(jobId: number): AnalysisJobStageProgress[] {
  const stages = initialStages();
  progressByJob.set(jobId, stages);
  return cloneStages(stages);
}

export function getAnalysisJobProgress(jobId: number): AnalysisJobStageProgress[] {
  const stages = progressByJob.get(jobId);
  if (stages) return cloneStages(stages);
  return initializeAnalysisJobProgress(jobId);
}

export function updateAnalysisJobStage(
  jobId: number,
  stageId: AnalysisJobStageId,
  updates: Partial<Omit<AnalysisJobStageProgress, "id" | "label" | "weight">>
): AnalysisJobStageProgress[] {
  const stages = progressByJob.get(jobId) ?? initialStages();
  const now = new Date().toISOString();
  const next = stages.map((stage) => {
    if (stage.id !== stageId) return stage;
    const status = updates.status ?? stage.status;
    return {
      ...stage,
      ...updates,
      status,
      startedAt:
        updates.startedAt ??
        (status === "running" && !stage.startedAt ? now : stage.startedAt),
      completedAt:
        updates.completedAt ??
        (status === "completed" || status === "failed" || status === "skipped"
          ? now
          : stage.completedAt),
      progress:
        updates.progress ??
        (status === "completed" || status === "failed" || status === "skipped"
          ? 100
          : stage.progress),
    };
  });
  progressByJob.set(jobId, next);
  return cloneStages(next);
}

export function failIncompleteAnalysisJobStages(
  jobId: number,
  message: string
): AnalysisJobStageProgress[] {
  const stages = progressByJob.get(jobId) ?? initialStages();
  const now = new Date().toISOString();
  const next = stages.map((stage) => {
    if (
      stage.status === "completed" ||
      stage.status === "failed" ||
      stage.status === "skipped"
    ) {
      return stage;
    }
    return {
      ...stage,
      status: "failed" as const,
      progress: 100,
      completedAt: now,
      errorMessage: message,
    };
  });
  progressByJob.set(jobId, next);
  return cloneStages(next);
}

export function calculateAggregateProgress(stages: AnalysisJobStageProgress[]): number {
  const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = stages.reduce(
    (sum, stage) => sum + (stage.progress / 100) * stage.weight,
    0
  );
  return Math.max(0, Math.min(100, Math.round((weighted / totalWeight) * 100)));
}

