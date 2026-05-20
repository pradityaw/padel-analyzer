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
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

type StagePatch = Partial<
  Omit<AnalysisJobStageProgress, "id" | "label" | "weight">
>;

function isRejected<T>(
  result: PromiseSettledResult<T>
): result is PromiseRejectedResult {
  return result.status === "rejected";
}

function isFulfilled<T>(
  result: PromiseSettledResult<T>
): result is PromiseFulfilledResult<T> {
  return result.status === "fulfilled";
}

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
};

async function runReportedStage<T>(
  stageId: AnalysisJobStageId,
  messages: { running: string; completed: string },
  report: StageReporter,
  runner: () => Promise<T>
): Promise<T> {
  await report(
    stageId,
    { status: "running", progress: 5, message: messages.running, errorMessage: null },
    messages.running
  );
  try {
    const result = await runner();
    await report(
      stageId,
      { status: "completed", progress: 100, message: messages.completed, errorMessage: null },
      messages.completed
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage failure.";
    await report(
      stageId,
      { status: "failed", progress: 100, message: "Stage failed.", errorMessage: message },
      message
    );
    throw error;
  }
}

function assertSwingQuality(result: AnalysisResultPayload): void {
  if (result.frameCount < MIN_FRAMES_FOR_PHASES) {
    throw new AnalysisRunnerError(
      `Could not detect enough pose data (${result.frameCount} frames). Record from the side with the player clearly visible and try a brighter clip.`,
      "LOW_QUALITY"
    );
  }

  if (result.phases.length === 0) {
    throw new AnalysisRunnerError(
      "No swing phases could be detected. Use a side-view clip that shows one full swing.",
      "LOW_QUALITY"
    );
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
      progress: 40,
      message: "Validating uploaded video and preparing workers.",
      errorMessage: null,
    },
    "Preparing parallel analysis agents..."
  );
  await report(
    "ingestion",
    { status: "completed", progress: 100, message: "Video ready for analysis." },
    "Starting court, player, and ball agents..."
  );

  const courtPromise = runReportedStage(
    "courtCalibration",
    {
      running: "Agent A is calibrating court boundaries and homography.",
      completed: "Agent A calibrated court geometry.",
    },
    report,
    () => runCvAgentStage("court", videoPath)
  );

  const playerPromise = runReportedStage(
    "playerTracking",
    {
      running: "Agent B is extracting skeleton, racket, and swing landmarks.",
      completed: "Agent B extracted player movement landmarks.",
    },
    report,
    () => runMobileAnalysis(videoPath)
  );

  const ballPromise = runReportedStage(
    "ballTrajectory",
    {
      running: "Agent C is isolating ball trajectory and shot events.",
      completed: "Agent C isolated ball trajectory.",
    },
    report,
    () => runCvAgentStage("ball", videoPath)
  );

  const [courtSettled, playerSettled, ballSettled] = await Promise.allSettled([
    courtPromise,
    playerPromise,
    ballPromise,
  ]);

  const failures = [courtSettled, playerSettled, ballSettled].filter(isRejected);
  if (failures.length > 0) {
    const first = failures[0]?.reason;
    throw first instanceof Error ? first : new Error("Parallel analysis failed.");
  }

  if (
    !isFulfilled(courtSettled) ||
    !isFulfilled(playerSettled) ||
    !isFulfilled(ballSettled)
  ) {
    throw new Error("Parallel analysis did not produce complete results.");
  }

  const swing = playerSettled.value;
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

  // Racket-head tracking depends on per-frame pose landmarks, so it
  // cannot run in the same parallel batch as the player stage. Instead
  // we run it here as the first beat of the aggregation phase: cheap
  // (≤O(frame_count)), failure-tolerant, and recovered by the wrist
  // proxy on the client when missing.
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
      courtCalibration: courtSettled.value,
      ballTrajectory: ballSettled.value,
      racketTracking,
    },
  };
}

async function runRacketStageOrFallback(
  videoPath: string,
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
    return await runCvAgentStage("racket", videoPath, options);
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

