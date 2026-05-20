import { spawn } from "child_process";
import path from "path";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
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

function truncateStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= 2_000) return trimmed;
  return `${trimmed.slice(0, 2_000)}...`;
}

export async function runCvAgentStage(
  stage: CvAgentStage,
  videoPath: string,
  options: CvAgentStageOptions = {}
): Promise<unknown> {
  const pythonBin = process.env.CV_PYTHON_BIN || process.env.MOBILE_ANALYSIS_PYTHON || "python3";
  const timeoutMs = Number(process.env.CV_PIPELINE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
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
        videoPath,
        ...extraArgs,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
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
      child.kill("SIGTERM");
      reject(new CvAgentStageError(`CV ${stage} agent timed out.`, stage));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
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

