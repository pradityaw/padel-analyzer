import { spawn } from "child_process";
import { access } from "fs/promises";
import path from "path";
import type { CvPipelineInput, CvPipelineResult } from "../../shared/schema.js";
import { cvPipelineResultSchema } from "../../shared/schema.js";
import { getDataRoot, getUploadsDir } from "./paths.js";
import {
  CV_PIPELINE_DEFAULT_TIMEOUT_MS,
} from "../../shared/config.js";
import { terminateChildWithEscalation } from "./managedSubprocess.js";

const DEFAULT_MAX_STDOUT_BYTES = 25 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export class CvPipelineError extends Error {
  constructor(
    message: string,
    readonly causeCode: "INVALID_INPUT" | "NOT_FOUND" | "PROCESS_FAILED" | "BAD_OUTPUT"
  ) {
    super(message);
    this.name = "CvPipelineError";
  }
}

function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveCvVideoPath(input: CvPipelineInput): string {
  const uploadsDir = path.resolve(getUploadsDir());
  const dataRoot = path.resolve(getDataRoot());

  if (input.videoStorageKey) {
    if (path.isAbsolute(input.videoStorageKey)) {
      throw new CvPipelineError("videoStorageKey must be a relative upload key.", "INVALID_INPUT");
    }
    const resolved = path.resolve(uploadsDir, input.videoStorageKey);
    if (!isInsidePath(uploadsDir, resolved)) {
      throw new CvPipelineError("videoStorageKey must stay inside uploads.", "INVALID_INPUT");
    }
    return resolved;
  }

  if (!input.videoPath) {
    throw new CvPipelineError("Provide videoStorageKey or videoPath.", "INVALID_INPUT");
  }

  const resolved = path.resolve(input.videoPath);
  if (!isInsidePath(uploadsDir, resolved) && !isInsidePath(dataRoot, resolved)) {
    throw new CvPipelineError("videoPath must stay inside the configured data directory.", "INVALID_INPUT");
  }
  return resolved;
}

function cvScriptPath(): string {
  return path.resolve(process.cwd(), "scripts", "cv", "run_pipeline.py");
}

function truncateStderr(stderr: string): string {
  const trimmed = stderr.trim();
  if (trimmed.length <= 2_000) return trimmed;
  return `${trimmed.slice(0, 2_000)}...`;
}

async function ensureReadable(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new CvPipelineError("Uploaded video could not be found on the server.", "NOT_FOUND");
  }
}

export async function runCvPipeline(input: CvPipelineInput): Promise<CvPipelineResult> {
  const videoPath = resolveCvVideoPath(input);
  await ensureReadable(videoPath);

  const pythonBin = process.env.CV_PYTHON_BIN || "python3";
  const outputDir = path.join(getUploadsDir(), "cv");
  const args = [
    cvScriptPath(),
    "--video-path",
    videoPath,
    "--output-dir",
    outputDir,
    "--public-prefix",
    "/uploads/cv",
  ];
  if (input.skipExport) {
    args.push("--skip-export");
  }

  const timeoutMs = Number(
    process.env.CV_PIPELINE_TIMEOUT_MS || CV_PIPELINE_DEFAULT_TIMEOUT_MS
  );
  const maxStdoutBytes = Number(process.env.CV_PIPELINE_MAX_STDOUT_BYTES || DEFAULT_MAX_STDOUT_BYTES);

  return new Promise<CvPipelineResult>((resolve, reject) => {
    const child = spawn(pythonBin, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateChildWithEscalation(child);
      reject(new CvPipelineError("CV pipeline timed out.", "PROCESS_FAILED"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        terminateChildWithEscalation(child);
        reject(new CvPipelineError("CV pipeline output exceeded the size limit.", "PROCESS_FAILED"));
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
      reject(new CvPipelineError(`Failed to start CV pipeline: ${error.message}`, "PROCESS_FAILED"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new CvPipelineError(
            `CV pipeline failed${stderr ? `: ${truncateStderr(stderr)}` : "."}`,
            "PROCESS_FAILED"
          )
        );
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new CvPipelineError("CV pipeline returned invalid JSON.", "BAD_OUTPUT"));
        return;
      }

      const result = cvPipelineResultSchema.safeParse(parsed);
      if (!result.success) {
        reject(new CvPipelineError("CV pipeline returned an unexpected payload shape.", "BAD_OUTPUT"));
        return;
      }

      resolve(result.data);
    });
  });
}
