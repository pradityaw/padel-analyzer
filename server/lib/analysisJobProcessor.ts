import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db.js";
import {
  analysisJobs,
  analyses,
  type NewAnalysis,
  type NewAnalysisJob,
} from "../../drizzle/schema.js";
import type { AnalysisJobStageId } from "../../shared/schema.js";
import { AnalysisRunnerError } from "../_core/mobileAnalysisRunner.js";
import { getDataRoot } from "./paths.js";
import { resolveVideoUriForProcessing } from "./videoAccess.js";
import { enqueueAnalysisJob } from "./analysisJobQueue.js";
import {
  calculateAggregateProgress,
  failIncompleteAnalysisJobStages,
  initializeAnalysisJobProgress,
  updateAnalysisJobStage,
} from "./analysisJobProgress.js";
import { runParallelAnalysisOrchestration } from "./parallelAnalysisOrchestrator.js";
import {
  createPipelineTimer,
  writePipelineTimingArtifact,
} from "./pipelineTiming.js";
import { isAgentStageSoftFailure } from "./agentStageFallbacks.js";

async function updateJob(
  jobId: number,
  updates: Partial<NewAnalysisJob>
): Promise<void> {
  db.update(analysisJobs)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(analysisJobs.id, jobId))
    .run();
}

async function updateStage(
  jobId: number,
  stageId: AnalysisJobStageId,
  patch: Parameters<typeof updateAnalysisJobStage>[2],
  statusMessage: string
): Promise<void> {
  const stages = updateAnalysisJobStage(jobId, stageId, patch);
  await updateJob(jobId, {
    progress: calculateAggregateProgress(stages),
    statusMessage,
  });
}

async function writeAgentArtifacts(
  jobId: number,
  artifacts: {
    courtCalibration: unknown;
    ballTrajectory: unknown;
    racketTracking: unknown;
    rallyWindows?: unknown;
  }
): Promise<void> {
  const dir = path.join(getDataRoot(), "analysis-agents");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `job-${jobId}.json`),
    JSON.stringify(
      {
        jobId,
        generatedAt: new Date().toISOString(),
        agents: artifacts,
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function processAnalysisJob(jobId: number): Promise<void> {
  const timer = createPipelineTimer(`analysis-job-${jobId}`);
  initializeAnalysisJobProgress(jobId);
  try {
    const job = db
      .select()
      .from(analysisJobs)
      .where(eq(analysisJobs.id, jobId))
      .get();

    if (!job) return;

    await updateJob(jobId, {
      status: "processing",
      progress: 0,
      statusMessage: "Preparing parallel analysis agents...",
      errorMessage: null,
    });

    let videoPath: string;
    try {
      timer.mark("resolve-video-start");
      videoPath = await resolveVideoUriForProcessing(job.videoStorageKey);
      timer.mark("resolve-video-done", { videoPath });
    } catch (error) {
      throw new AnalysisRunnerError(
        error instanceof Error
          ? error.message
          : "Uploaded video could not be found on the server. Try uploading again.",
        "VIDEO_NOT_FOUND"
      );
    }

    timer.mark("orchestration-start");
    const result = await runParallelAnalysisOrchestration(
      videoPath,
      (stageId, patch, statusMessage) =>
        updateStage(jobId, stageId, patch, statusMessage)
    );
    timer.mark("orchestration-done", {
      rallyWindows: result.rallyWindows?.windows.length ?? 0,
      sampleFps: result.rallyWindows?.sampleFps,
    });

    await updateStage(
      jobId,
      "aggregation",
      {
        status: "running",
        progress: 75,
        message: "Saving analysis and agent artifacts.",
        errorMessage: null,
      },
      "Saving analysis..."
    );

    await writeAgentArtifacts(jobId, {
      ...result.agents,
      rallyWindows: result.rallyWindows ?? null,
    });

    const warnings: string[] = [];
    if (isAgentStageSoftFailure(result.agents.courtCalibration)) {
      warnings.push("court calibration skipped");
    }
    if (isAgentStageSoftFailure(result.agents.ballTrajectory)) {
      warnings.push("ball tracking skipped");
    }
    if (isAgentStageSoftFailure(result.agents.racketTracking)) {
      warnings.push("racket tracking skipped");
    }
    const completionMessage =
      warnings.length > 0
        ? `Analysis complete (${warnings.join("; ")}).`
        : "Analysis complete.";

    const newAnalysis: NewAnalysis = {
      videoFileName: job.videoFileName,
      videoStorageKey: job.videoStorageKey,
      overallScore: result.swing.overallScore,
      dominantSide: result.swing.dominantSide,
      durationMs: result.swing.durationMs,
      frameCount: result.swing.frameCount,
      sampleFps: result.swing.sampleFps,
      phasesJson: JSON.stringify(result.swing.phases),
      landmarksJson: JSON.stringify(result.swing.frameLandmarks),
      shotType: result.swing.shotType as NewAnalysis["shotType"],
      shotConfidence: result.swing.shotConfidence,
      skillLabel: result.swing.skillLabel as NewAnalysis["skillLabel"],
      skillConfidence: result.swing.skillConfidence,
      qualityScore: result.swing.qualityScore,
    };

    const saved = db.insert(analyses).values(newAnalysis).returning().get();

    await updateStage(
      jobId,
      "aggregation",
      {
        status: "completed",
        progress: 100,
        message: "Analysis payload saved.",
        errorMessage: null,
      },
      completionMessage
    );

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      statusMessage: completionMessage,
      analysisId: saved.id,
      errorMessage: null,
    });
    timer.finish({ analysisId: saved.id });
    try {
      await writePipelineTimingArtifact(jobId, timer.snapshot());
    } catch (artifactError) {
      console.warn(
        `[pipeline] analysis-job-${jobId} could not write timing artifact:`,
        artifactError
      );
    }
  } catch (error) {
    const message =
      error instanceof AnalysisRunnerError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown analysis failure.";

    failIncompleteAnalysisJobStages(jobId, message);
    await updateJob(jobId, {
      status: "failed",
      progress: 100,
      statusMessage: "Analysis failed.",
      errorMessage: message,
    });
    timer.finish({ failed: true, message });
    try {
      await writePipelineTimingArtifact(jobId, timer.snapshot());
    } catch (artifactError) {
      console.warn(
        `[pipeline] analysis-job-${jobId} could not write timing artifact:`,
        artifactError
      );
    }
  }
}

export function scheduleAnalysisJob(jobId: number): void {
  enqueueAnalysisJob(jobId, processAnalysisJob);
}

export type JobRecoveryAction =
  | { type: "schedule"; jobId: number }
  | { type: "markCompleted"; jobId: number }
  | {
      type: "markFailed";
      jobId: number;
      message: string;
    }
  | { type: "requeue"; jobId: number };

type RecoverableJob = {
  id: number;
  status: string;
  analysisId: number | null | undefined;
};

/** Pure planner for startup recovery — unit-tested to lock behavior. */
export function planJobRecoveryActions(jobs: RecoverableJob[]): JobRecoveryAction[] {
  const actions: JobRecoveryAction[] = [];

  for (const job of jobs) {
    if (job.status === "queued") {
      actions.push({ type: "schedule", jobId: job.id });
      continue;
    }

    if (job.status === "processing") {
      if (job.analysisId != null) {
        actions.push({ type: "markCompleted", jobId: job.id });
      } else {
        actions.push({ type: "requeue", jobId: job.id });
        actions.push({ type: "schedule", jobId: job.id });
      }
      continue;
    }

    if (job.status === "completed" && job.analysisId == null) {
      actions.push({
        type: "markFailed",
        jobId: job.id,
        message:
          "Analysis finished without saved results after an interrupted run. Please retry.",
      });
    }
  }

  return actions;
}

/**
 * Re-enqueue analysis jobs that were lost when the in-memory queue was cleared
 * (deploy, crash, pm2 restart). Also reconciles stale `processing` rows.
 */
export async function recoverPendingAnalysisJobs(): Promise<number> {
  const jobs = db
    .select({
      id: analysisJobs.id,
      status: analysisJobs.status,
      analysisId: analysisJobs.analysisId,
    })
    .from(analysisJobs)
    .where(
      or(
        inArray(analysisJobs.status, ["queued", "processing"]),
        and(eq(analysisJobs.status, "completed"), isNull(analysisJobs.analysisId))
      )
    )
    .all();

  const actions = planJobRecoveryActions(jobs);
  let scheduled = 0;

  for (const action of actions) {
    switch (action.type) {
      case "schedule":
        scheduleAnalysisJob(action.jobId);
        scheduled += 1;
        break;
      case "markCompleted":
        await updateJob(action.jobId, {
          status: "completed",
          progress: 100,
          statusMessage: "Analysis complete.",
          errorMessage: null,
        });
        break;
      case "markFailed":
        failIncompleteAnalysisJobStages(action.jobId, action.message);
        await updateJob(action.jobId, {
          status: "failed",
          progress: 100,
          statusMessage: "Analysis failed.",
          errorMessage: action.message,
        });
        break;
      case "requeue":
        initializeAnalysisJobProgress(action.jobId);
        await updateJob(action.jobId, {
          status: "queued",
          progress: 0,
          statusMessage: "Re-queued after server restart.",
          errorMessage: null,
        });
        break;
      default: {
        const _exhaustive: never = action;
        throw new Error(`Unhandled recovery action: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  if (scheduled > 0) {
    console.log(`[analysis-job] Recovered ${scheduled} queued job(s) after startup.`);
  }

  return scheduled;
}
