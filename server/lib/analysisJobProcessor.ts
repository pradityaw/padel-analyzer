import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  analysisJobs,
  analyses,
  type NewAnalysis,
  type NewAnalysisJob,
} from "../../drizzle/schema.js";
import type { AnalysisJobStageId } from "../../shared/schema.js";
import { AnalysisRunnerError } from "../_core/mobileAnalysisRunner.js";
import { getDataRoot, getUploadsDir } from "./paths.js";
import { enqueueAnalysisJob } from "./analysisJobQueue.js";
import {
  calculateAggregateProgress,
  failIncompleteAnalysisJobStages,
  initializeAnalysisJobProgress,
  updateAnalysisJobStage,
} from "./analysisJobProgress.js";
import { runParallelAnalysisOrchestration } from "./parallelAnalysisOrchestrator.js";

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

    const videoPath = path.join(getUploadsDir(), job.videoStorageKey);
    if (!existsSync(videoPath)) {
      throw new AnalysisRunnerError(
        "Uploaded video could not be found on the server. Try uploading again.",
        "VIDEO_NOT_FOUND"
      );
    }

    const result = await runParallelAnalysisOrchestration(
      videoPath,
      (stageId, patch, statusMessage) =>
        updateStage(jobId, stageId, patch, statusMessage)
    );

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

    await writeAgentArtifacts(jobId, result.agents);

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
      "Analysis complete."
    );

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      statusMessage: "Analysis complete.",
      analysisId: saved.id,
      errorMessage: null,
    });
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
  }
}

export function scheduleAnalysisJob(jobId: number): void {
  enqueueAnalysisJob(jobId, processAnalysisJob);
}
