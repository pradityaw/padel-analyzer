import path from "path";
import { existsSync } from "fs";
import { resolveProjectRoot } from "../lib/projectRoot.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analysisResultSchema } from "../../shared/schema.js";
import { MAX_UPLOAD_BYTES, MOBILE_ANALYSIS_TIMEOUT_MS } from "../../shared/config.js";

const execFileAsync = promisify(execFile);

const rootDir = resolveProjectRoot(import.meta.url);
const analyzeScript = path.join(rootDir, "scripts/analyze_video.py");
const venvPython = path.join(rootDir, ".venv/bin/python3");

export type AnalysisRunnerErrorCode =
  | "SETUP"
  | "VIDEO_NOT_FOUND"
  | "LOW_QUALITY"
  | "TIMEOUT"
  | "BAD_OUTPUT"
  | "PROCESS_FAILED";

export class AnalysisRunnerError extends Error {
  constructor(
    message: string,
    readonly code: AnalysisRunnerErrorCode
  ) {
    super(message);
    this.name = "AnalysisRunnerError";
  }
}

function resolvePython(): string {
  const fromEnv = process.env.MOBILE_ANALYSIS_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(venvPython)) return venvPython;
  return "python3";
}

function friendlyExecError(err: unknown): AnalysisRunnerError {
  const e = err as { code?: string; killed?: boolean; stderr?: string; message?: string };
  if (e?.killed || e?.code === "ETIMEDOUT") {
    return new AnalysisRunnerError(
      "Analysis timed out. Try a shorter clip or increase MOBILE_ANALYSIS_TIMEOUT_MS.",
      "TIMEOUT"
    );
  }
  const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : "";
  const msg = stderr || e?.message || "Analysis process failed.";
  if (/No module named|ImportError|mediapipe|opencv/i.test(msg)) {
    return new AnalysisRunnerError(
      "Server analysis runtime is missing Python dependencies (MediaPipe/OpenCV). Run: pip install -r scripts/cv/requirements.txt or use the project .venv.",
      "SETUP"
    );
  }
  if (/Cannot open video|Failed to load video/i.test(msg)) {
    return new AnalysisRunnerError(
      "Could not read the video file. Try re-exporting as MP4.",
      "PROCESS_FAILED"
    );
  }
  return new AnalysisRunnerError(
    msg.length > 280 ? `${msg.slice(0, 280)}...` : msg,
    "PROCESS_FAILED"
  );
}

export type MobileAnalysisOptions = {
  rallyWindowsPath?: string;
  sampleFps?: number;
};

export async function runMobileAnalysis(
  videoUri: string,
  options: MobileAnalysisOptions = {}
) {
  if (!existsSync(analyzeScript)) {
    throw new AnalysisRunnerError(
      "Analysis script is missing on the server (scripts/analyze_video.py).",
      "SETUP"
    );
  }

  const pythonBin = resolvePython();
  const args = [analyzeScript, videoUri];
  if (options.rallyWindowsPath) {
    args.push("--rally-windows", options.rallyWindowsPath);
  }
  if (options.sampleFps != null && options.sampleFps > 0) {
    args.push("--sample-fps", String(Math.floor(options.sampleFps)));
  }

  let stdout: string;
  let stderr: string;
  try {
    const result = await execFileAsync(pythonBin, args, {
      cwd: rootDir,
      timeout: Number(
        process.env.MOBILE_ANALYSIS_TIMEOUT_MS ||
          process.env.CV_PIPELINE_TIMEOUT_MS ||
          MOBILE_ANALYSIS_TIMEOUT_MS
      ),
      maxBuffer: 80 * 1024 * 1024,
      env: {
        ...process.env,
        PADEL_VIDEO_MAX_BYTES: String(MAX_UPLOAD_BYTES),
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err) {
    throw friendlyExecError(err);
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    const hint = stderr.trim();
    throw new AnalysisRunnerError(
      hint
        ? `Analysis produced no output: ${hint.slice(0, 200)}`
        : "Analysis produced no output.",
      "BAD_OUTPUT"
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new AnalysisRunnerError(
      "Analysis returned invalid JSON.",
      "BAD_OUTPUT"
    );
  }

  const validated = analysisResultSchema.safeParse(parsed);
  if (!validated.success) {
    throw new AnalysisRunnerError(
      "Analysis returned an unexpected result shape.",
      "BAD_OUTPUT"
    );
  }

  return validated.data;
}
