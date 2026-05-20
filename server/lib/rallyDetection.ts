/**
 * Server bridge for the production rally-window detector.
 *
 * The Python module (`scripts/cv/rally_detector.py`) does the heavy lifting:
 * it streams motion + ball velocity from OpenCV, extracts audio onsets via
 * ffmpeg, and runs the multi-signal fusion / hysteresis state machine.
 *
 * This module:
 *  - Resolves an analysis row to a video file on disk.
 *  - Caches the JSON payload under `data/rallies/<analysisId>.json` so the
 *    "Only Rallies" toggle is instant after the first request.
 *  - De-duplicates concurrent requests so a hammering client cannot trigger
 *    two simultaneous Python subprocesses for the same analysis.
 *  - Maps Python's snake_case payload into the camelCase wire schema in
 *    `shared/schema.ts`.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

import type { RallyDetectionResult } from "../../shared/schema.js";
import { rallyDetectionResultSchema } from "../../shared/schema.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { getDataRoot, getUploadsDir } from "./paths.js";

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000;
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export class RallyDetectionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "ANALYSIS_NOT_FOUND"
      | "VIDEO_NOT_FOUND"
      | "TIMEOUT"
      | "PROCESS_FAILED"
      | "BAD_OUTPUT"
  ) {
    super(message);
    this.name = "RallyDetectionError";
  }
}

function rallyCacheDir(): string {
  return path.join(getDataRoot(), "rallies");
}

function rallyCachePath(analysisId: number): string {
  return path.join(rallyCacheDir(), `${analysisId}.json`);
}

function rallyDetectorScript(): string {
  return path.resolve(process.cwd(), "scripts", "cv", "rally_detector.py");
}

function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

type RawRally = {
  rally_id?: number;
  id?: number;
  start_frame?: number;
  end_frame?: number;
  start_ms?: number;
  end_ms?: number;
  start_sec?: number;
  end_sec?: number;
  duration_sec?: number;
  confidence?: number;
  signals?: Record<string, unknown>;
};

type RawPayload = {
  fps?: number;
  frame_count?: number;
  duration_ms?: number;
  total_active_ms?: number;
  total_dead_ms?: number;
  total_active_sec?: number;
  total_dead_sec?: number;
  audio_available?: boolean;
  capabilities?: Record<string, unknown>;
  rallies?: RawRally[];
};

function pickNumber(...values: unknown[]): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

function coerceCapabilities(raw: Record<string, unknown> | undefined) {
  const keys = ["motion", "velocity", "audio", "shots", "shake"] as const;
  const out: Record<(typeof keys)[number], boolean> = {
    motion: false,
    velocity: false,
    audio: false,
    shots: false,
    shake: false,
  };
  if (raw) {
    for (const key of keys) {
      out[key] = Boolean(raw[key]);
    }
  }
  return out;
}

function coerceSignals(raw: Record<string, unknown> | undefined) {
  if (!raw) return {} as Record<string, number>;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

function snakeToCamel(payload: RawPayload, analysisId: number): RallyDetectionResult {
  const fps = pickNumber(payload.fps);
  const frameCount = Math.max(0, Math.floor(pickNumber(payload.frame_count)));
  const durationMs = Math.max(0, pickNumber(payload.duration_ms));
  const totalActiveMs = Math.max(
    0,
    pickNumber(payload.total_active_ms, (payload.total_active_sec ?? 0) * 1000)
  );
  const totalDeadMs = Math.max(
    0,
    pickNumber(payload.total_dead_ms, (payload.total_dead_sec ?? 0) * 1000)
  );

  const rallies = (payload.rallies ?? []).map((rally, index) => {
    const startMs = pickNumber(rally.start_ms, (rally.start_sec ?? 0) * 1000);
    const endMs = pickNumber(rally.end_ms, (rally.end_sec ?? 0) * 1000);
    const startFrame = Math.max(0, Math.floor(pickNumber(rally.start_frame)));
    const endFrame = Math.max(startFrame, Math.floor(pickNumber(rally.end_frame)));
    return {
      id: Math.max(0, Math.floor(pickNumber(rally.id, rally.rally_id, index))),
      startFrame,
      endFrame,
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      confidence: Math.max(0, Math.min(1, pickNumber(rally.confidence))),
      signals: coerceSignals(rally.signals as Record<string, unknown> | undefined),
    };
  });

  const result = {
    analysisId,
    fps,
    frameCount,
    durationMs,
    totalActiveMs,
    totalDeadMs,
    audioAvailable: Boolean(payload.audio_available),
    capabilities: coerceCapabilities(payload.capabilities),
    rallies,
    computedAt: new Date().toISOString(),
  };

  // Validate so the wire schema is the single source of truth.
  return rallyDetectionResultSchema.parse(result);
}

function resolveAnalysisVideoPath(
  analysis: { videoStorageKey: string | null; videoFileName: string }
): string | null {
  const uploadsDir = path.resolve(getUploadsDir());
  const candidate = analysis.videoStorageKey ?? analysis.videoFileName;
  if (!candidate) return null;
  if (path.isAbsolute(candidate)) {
    // Defensive: never trust an absolute path stored in the DB row.
    return null;
  }
  const resolved = path.resolve(uploadsDir, candidate);
  if (!isInsidePath(uploadsDir, resolved)) return null;
  if (!existsSync(resolved)) return null;
  return resolved;
}

async function readCache(analysisId: number): Promise<RallyDetectionResult | null> {
  try {
    const raw = await readFile(rallyCachePath(analysisId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const validated = rallyDetectionResultSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

async function writeCache(
  analysisId: number,
  result: RallyDetectionResult
): Promise<void> {
  await mkdir(rallyCacheDir(), { recursive: true });
  const finalPath = rallyCachePath(analysisId);
  const tempPath = path.join(
    tmpdir(),
    `padel-rallies-${analysisId}-${randomBytes(4).toString("hex")}.json`
  );
  await writeFile(tempPath, JSON.stringify(result), "utf-8");
  await rename(tempPath, finalPath);
}

function spawnDetector(
  videoPath: string,
  timeoutMs: number,
  maxStdoutBytes: number
): Promise<RawPayload> {
  return new Promise<RawPayload>((resolve, reject) => {
    const pythonBin = process.env.CV_PYTHON_BIN || "python3";
    const child = spawn(
      pythonBin,
      [rallyDetectorScript(), "--video-path", videoPath],
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
      reject(new RallyDetectionError("Rally detection timed out.", "TIMEOUT"));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGTERM");
        reject(
          new RallyDetectionError(
            "Rally detection output exceeded the size limit.",
            "PROCESS_FAILED"
          )
        );
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_STDERR_BYTES) stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new RallyDetectionError(
          `Could not start rally detector: ${err.message}`,
          "PROCESS_FAILED"
        )
      );
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) {
        reject(
          new RallyDetectionError(
            `Rally detector exited ${code}: ${stderr.trim().slice(0, 280)}`,
            "PROCESS_FAILED"
          )
        );
        return;
      }

      // The script may emit non-JSON status lines on stderr; stdout is the
      // single newline-terminated JSON payload.
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      if (!stdout) {
        reject(
          new RallyDetectionError(
            "Rally detector produced no output.",
            "BAD_OUTPUT"
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as RawPayload;
        resolve(parsed);
      } catch {
        reject(
          new RallyDetectionError(
            "Rally detector returned invalid JSON.",
            "BAD_OUTPUT"
          )
        );
      }
    });
  });
}

const inFlight = new Map<number, Promise<RallyDetectionResult>>();

export async function detectRalliesForAnalysis(
  analysisId: number,
  options: { force?: boolean } = {}
): Promise<RallyDetectionResult> {
  if (!options.force) {
    const cached = await readCache(analysisId);
    if (cached) {
      // Normalise the analysisId in case the cache was written by an older build.
      return { ...cached, analysisId };
    }
  }

  const existing = inFlight.get(analysisId);
  if (existing) return existing;

  const promise = (async () => {
    const row = db
      .select({
        id: analyses.id,
        videoFileName: analyses.videoFileName,
        videoStorageKey: analyses.videoStorageKey,
      })
      .from(analyses)
      .where(eq(analyses.id, analysisId))
      .get();

    if (!row) {
      throw new RallyDetectionError(
        `Analysis ${analysisId} not found.`,
        "ANALYSIS_NOT_FOUND"
      );
    }

    const videoPath = resolveAnalysisVideoPath(row);
    if (!videoPath) {
      // Some swing-clip analyses have no associated long-form video. Return
      // an empty (but cacheable) result so the UI can render the toggle as
      // "no rallies available" instead of failing.
      const empty: RallyDetectionResult = {
        analysisId,
        fps: 0,
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
      await writeCache(analysisId, empty);
      return empty;
    }

    const timeoutMs = Number(
      process.env.RALLY_DETECTION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS
    );
    const maxStdoutBytes = Number(
      process.env.RALLY_DETECTION_MAX_STDOUT_BYTES || DEFAULT_MAX_STDOUT_BYTES
    );

    const raw = await spawnDetector(videoPath, timeoutMs, maxStdoutBytes);
    const result = snakeToCamel(raw, analysisId);
    await writeCache(analysisId, result);
    return result;
  })();

  inFlight.set(analysisId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(analysisId);
  }
}

export async function getCachedRallies(
  analysisId: number
): Promise<RallyDetectionResult | null> {
  const cached = await readCache(analysisId);
  if (!cached) return null;
  return { ...cached, analysisId };
}
