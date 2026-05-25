import type {
  AnalysisJobStageId,
  AnalysisJobStageProgress,
  AnalysisResultPayload,
} from "../../shared/schema.js";
import { MIN_FRAMES_FOR_PHASES } from "../../shared/config.js";
import {
  AnalysisRunnerError,
  runMobileAnalysis,
} from "../_core/mobileAnalysisRunner.js";
import {
  runCvAgentStage,
  type CvAgentStageOptions,
} from "./cvAgentStageRunner.js";
import { detectRalliesForVideo } from "./rallyDetection.js";
import {
  ballTrajectoryFallback,
  courtCalibrationFallback,
} from "./agentStageFallbacks.js";
import {
  activeDurationSec,
  buildRallyWindowsPayload,
  writeRallyWindowsFile,
  type RallyWindowsPayload,
} from "./rallyWindowsFile.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

type StagePatch = Partial<
  Omit<AnalysisJobStageProgress, "id" | "label" | "weight">
>;

export type StageReporter = (
  stageId: AnalysisJobStageId,
  patch: StagePatch,
  statusMessage: string
) => Promise<void>;

export type ParallelAnalysisResult = {
  swing: AnalysisResultPayload;
  agents: {
    courtCalibration: unknown;
    ballTrajectory: unknown;
    racketTracking: unknown;
  };
  rallyWindows?: RallyWindowsPayload;
};

async function runReportedStage<T>(
  stageId: AnalysisJobStageId,
  messages: { running: string; completed: string },
  report: StageReporter,
  runner: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  console.log(`[analysis-stage] ${stageId} start`);
  await report(
    stageId,
    { status: "running", progress: 5, message: messages.running, errorMessage: null },
    messages.running
  );
  try {
    const result = await runner();
    const elapsedMs = Date.now() - startedAt;
    console.log(`[analysis-stage] ${stageId} done ${elapsedMs}ms`);
    await report(
      stageId,
      { status: "completed", progress: 100, message: messages.completed, errorMessage: null },
      messages.completed
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage failure.";
    const elapsedMs = Date.now() - startedAt;
    console.warn(`[analysis-stage] ${stageId} failed ${elapsedMs}ms: ${message}`);
    await report(
      stageId,
      { status: "failed", progress: 100, message: "Stage failed.", errorMessage: message },
      message
    );
    throw error;
  }
}

async function runSoftReportedStage<T>(
  stageId: AnalysisJobStageId,
  messages: { running: string; completed: string },
  report: StageReporter,
  runner: () => Promise<T>,
  fallback: (error: unknown) => T
): Promise<T> {
  try {
    return await runReportedStage(stageId, messages, report, runner);
  } catch (error) {
    return fallback(error);
  }
}

function assertSwingQuality(result: AnalysisResultPayload): void {
  if (result.frameCount < MIN_FRAMES_FOR_PHASES) {
    throw new AnalysisRunnerError(
      `Could not detect enough pose data (${result.frameCount} frames). Record from the side with the player clearly visible during active rallies.`,
      "LOW_QUALITY"
    );
  }

  if (result.phases.length === 0) {
    throw new AnalysisRunnerError(
      "No swing phases could be detected. Use a side-view clip that shows at least one full swing in an active rally.",
      "LOW_QUALITY"
    );
  }
}

function rallyStageArgs(rallyWindowsPath: string | null): CvAgentStageOptions {
  return rallyWindowsPath
    ? { extraArgs: ["--rally-windows", rallyWindowsPath] }
    : {};
}

async function detectRalliesOrFullVideo(videoPath: string) {
  try {
    return await detectRalliesForVideo(videoPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown rally detection failure.";
    console.warn(
      `[analysis-stage] ingestion rally detection failed; processing full clip: ${message}`
    );
    return {
      fps: 30,
      frameCount: 0,
      durationMs: 0,
      totalActiveMs: 0,
      totalDeadMs: 0,
      audioAvailable: false,
      capabilities: {
        motion: false,
        velocity: false,
        audio: false,
        shots: false,
        shake: false,
      },
      rallies: [],
      computedAt: new Date().toISOString(),
    };
  }
}

export async function runParallelAnalysisOrchestration(
  videoPath: string,
  report: StageReporter
): Promise<ParallelAnalysisResult> {
  await report(
    "ingestion",
    {
      status: "running",
      progress: 10,
      message: "Preparing video for analysis.",
      errorMessage: null,
    },
    "Preparing video..."
  );

  await report(
    "ingestion",
    {
      status: "running",
      progress: 35,
      message: "Detecting active rally windows (trimming dead time).",
      errorMessage: null,
    },
    "Detecting rallies..."
  );

  const rallyDetectionPromise = detectRalliesOrFullVideo(videoPath);
  const courtPromise = runSoftReportedStage(
    "courtCalibration",
    {
      running: "Agent A is calibrating court boundaries and homography.",
      completed: "Agent A calibrated court geometry.",
    },
    report,
    () => runCvAgentStage("court", videoPath),
    courtCalibrationFallback
  );

  const rallyDetection = await rallyDetectionPromise;
  const rallyPayload = buildRallyWindowsPayload(rallyDetection);
  const rallyWindowsPath = await writeRallyWindowsFile(rallyPayload);
  const activeSec = activeDurationSec(rallyPayload);

  await report(
    "ingestion",
    {
      status: "completed",
      progress: 100,
      message: `Found ${rallyPayload.windows.length} active window(s); analyzing ~${Math.round(activeSec)}s at ${rallyPayload.sampleFps} fps.`,
    },
    "Starting agents on active rallies..."
  );

  const playerPromise = runReportedStage(
    "playerTracking",
    {
      running: `Agent B is extracting pose landmarks (${rallyPayload.sampleFps} fps, rally windows only).`,
      completed: "Agent B extracted player movement landmarks.",
    },
    report,
    () =>
      runMobileAnalysis(videoPath, {
        rallyWindowsPath,
        sampleFps: rallyPayload.sampleFps,
      })
  );

  const ballPromise = runSoftReportedStage(
    "ballTrajectory",
    {
      running: "Agent C is isolating ball trajectory inside active rallies.",
      completed: "Agent C isolated ball trajectory.",
    },
    report,
    () => runCvAgentStage("ball", videoPath, rallyStageArgs(rallyWindowsPath)),
    ballTrajectoryFallback
  );

  const [courtCalibration, swing, ballTrajectory] = await Promise.all([
    courtPromise,
    playerPromise,
    ballPromise,
  ]);
  assertSwingQuality(swing);

  await report(
    "aggregation",
    {
      status: "running",
      progress: 30,
      message: "Tracking racket head from pose landmarks.",
      errorMessage: null,
    },
    "Tracking racket head from pose landmarks..."
  );

  const racketTracking = await runRacketStageOrFallback(videoPath, swing);

  await report(
    "aggregation",
    {
      status: "running",
      progress: 60,
      message: "Merging agent outputs into analysis payload.",
      errorMessage: null,
    },
    "Merging agent outputs..."
  );

  return {
    swing,
    agents: {
      courtCalibration,
      ballTrajectory,
      racketTracking,
    },
    rallyWindows: rallyPayload,
  };
}

async function runRacketStageOrFallback(
  videoUri: string,
  swing: AnalysisResultPayload
): Promise<unknown> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "padel-racket-"));
  const landmarksPath = path.join(tempDir, "landmarks.json");
  try {
    await writeFile(
      landmarksPath,
      JSON.stringify(swing.frameLandmarks),
      "utf8"
    );
    const options: CvAgentStageOptions = {
      extraArgs: [
        "--landmarks-path",
        landmarksPath,
        "--dominant-side",
        swing.dominantSide,
        "--player-id",
        "1",
      ],
    };
    return await runCvAgentStage("racket", videoUri, options);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Racket-head tracker failed.";
    return {
      agent: "racketTracking",
      players: [],
      summary: {
        sample_count: 0,
        refined_count: 0,
        interpolated_count: 0,
        video_width: 0,
        video_height: 0,
        extrapolation_k: 1.2,
        reason: "stage_failed",
        error_message: message,
      },
    };
  } finally {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort — never throw out of cleanup.
    }
  }
}
