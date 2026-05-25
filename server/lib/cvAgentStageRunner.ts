import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import {
  CV_BALL_STAGE_TIMEOUT_MS,
  CV_BALL_TRACKNET_TIMEOUT_MS,
  CV_COURT_STAGE_TIMEOUT_MS,
  CV_PIPELINE_DEFAULT_TIMEOUT_MS,
  CV_RACKET_STAGE_TIMEOUT_MS,
  DEFAULT_PADEL_BALL_BACKEND,
  MAX_UPLOAD_BYTES,
  PADEL_BALL_BACKENDS,
} from "../../shared/config.js";
import { terminateChildWithEscalation } from "./managedSubprocess.js";

const DEFAULT_STAGE_TIMEOUT_MS: Record<CvAgentStage, number> = {
  court: CV_COURT_STAGE_TIMEOUT_MS,
  ball: CV_BALL_STAGE_TIMEOUT_MS,
  racket: CV_RACKET_STAGE_TIMEOUT_MS,
};
const DEFAULT_MAX_STDOUT_BYTES = 25 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export type CvAgentStage = "court" | "ball" | "racket";

export type CvAgentStageOptions = {
  /** Additional CLI arguments appended after the canonical `--stage ...
   *  --video-path ...` arguments. Useful for stages that take auxiliary
   *  inputs such as a landmarks file. */
  extraArgs?: string[];
};

export class CvAgentStageError extends Error {
  constructor(
    message: string,
    readonly stage: CvAgentStage
  ) {
    super(message);
    this.name = "CvAgentStageError";
  }
}

function stageScriptPath(): string {
  return path.resolve(process.cwd(), "scripts", "cv", "run_agent_stage.py");
}

function trackNetModelPath(): string {
  return path.resolve(process.cwd(), "scripts", "cv", "models", "tracknet-v2.onnx");
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeoutForStage(stage: CvAgentStage): number {
  const envName = `CV_${stage.toUpperCase()}_TIMEOUT_MS`;
  const requestedBackend = (process.env.PADEL_BALL_BACKEND || DEFAULT_PADEL_BALL_BACKEND)
    .trim()
    .toLowerCase();
  const stageDefault =
    stage === "ball" && requestedBackend === "tracknet"
      ? CV_BALL_TRACKNET_TIMEOUT_MS
      : DEFAULT_STAGE_TIMEOUT_MS[stage];
  return numberFromEnv(
    envName,
    numberFromEnv("CV_PIPELINE_TIMEOUT_MS", stageDefault ?? CV_PIPELINE_DEFAULT_TIMEOUT_MS)
  );
}

function truncateStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= 2_000) return trimmed;
  return `${trimmed.slice(0, 2_000)}...`;
}

let warnedMissingTrackNetModel = false;

function envForStage(stage: CvAgentStage): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PADEL_VIDEO_MAX_BYTES: String(MAX_UPLOAD_BYTES),
  };
  const requestedBackend = (env.PADEL_BALL_BACKEND || DEFAULT_PADEL_BALL_BACKEND)
    .trim()
    .toLowerCase();
  if (
    stage === "ball" &&
    requestedBackend &&
    !PADEL_BALL_BACKENDS.includes(requestedBackend as (typeof PADEL_BALL_BACKENDS)[number])
  ) {
    env.PADEL_BALL_BACKEND = DEFAULT_PADEL_BALL_BACKEND;
  }
  if (stage === "ball" && requestedBackend === "tracknet" && !existsSync(trackNetModelPath())) {
    if (!warnedMissingTrackNetModel) {
      warnedMissingTrackNetModel = true;
      console.warn(
        `[cv-agent:ball] PADEL_BALL_BACKEND=tracknet requested but ${trackNetModelPath()} is missing; using OpenCV fallback.`
      );
    }
    env.PADEL_BALL_BACKEND = "opencv";
  }
  return env;
}

export async function runCvAgentStage(
  stage: CvAgentStage,
  videoUri: string,
  options: CvAgentStageOptions = {}
): Promise<unknown> {
  const pythonBin = process.env.CV_PYTHON_BIN || process.env.MOBILE_ANALYSIS_PYTHON || "python3";
  const timeoutMs = timeoutForStage(stage);
  const maxStdoutBytes = Number(process.env.CV_PIPELINE_MAX_STDOUT_BYTES || DEFAULT_MAX_STDOUT_BYTES);
  const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];

  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(
      pythonBin,
      [
        stageScriptPath(),
        "--stage",
        stage,
        "--video-path",
        videoUri,
        ...extraArgs,
      ],
      {
        cwd: process.cwd(),
        env: envForStage(stage),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateChildWithEscalation(child);
      reject(new CvAgentStageError(`CV ${stage} agent timed out.`, stage));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        terminateChildWithEscalation(child);
        reject(new CvAgentStageError(`CV ${stage} agent output exceeded the size limit.`, stage));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) {
        stderrChunks.push(chunk);
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CvAgentStageError(`Failed to start CV ${stage} agent: ${error.message}`, stage));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new CvAgentStageError(
            `CV ${stage} agent failed${stderr ? `: ${truncateStderr(stderr)}` : "."}`,
            stage
          )
        );
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      try {
        resolve(JSON.parse(stdout) as unknown);
      } catch {
        reject(new CvAgentStageError(`CV ${stage} agent returned invalid JSON.`, stage));
      }
    });
  });
}

