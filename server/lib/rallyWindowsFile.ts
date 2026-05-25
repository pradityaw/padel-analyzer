import { writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import type { RallyDetectionResult, RallyWindow } from "../../shared/schema.js";
import { SAMPLE_FPS } from "../../shared/config.js";

export type RallyWindowsPayload = {
  fps: number;
  paddingSec: number;
  sampleFps: number;
  windows: Array<{ startSec: number; endSec: number }>;
};

const DEFAULT_PADDING_SEC = 1.5;

/** Long match clips: lower pose sampling to keep wall time bounded. */
export function chooseSampleFpsForDuration(durationSec: number): number {
  if (durationSec > 20 * 60) return 8;
  if (durationSec > 10 * 60) return 10;
  return SAMPLE_FPS;
}

export function buildRallyWindowsPayload(
  detection: RallyDetectionResult,
  options: { paddingSec?: number; sampleFps?: number } = {}
): RallyWindowsPayload {
  const paddingSec = options.paddingSec ?? DEFAULT_PADDING_SEC;
  const durationSec = detection.durationMs > 0 ? detection.durationMs / 1000 : 0;
  const sampleFps = options.sampleFps ?? chooseSampleFpsForDuration(durationSec);

  const windows =
    detection.rallies.length > 0
      ? detection.rallies.map((rally) => windowWithPadding(rally, paddingSec, durationSec))
      : durationSec > 0
        ? [{ startSec: 0, endSec: durationSec }]
        : [];

  return {
    fps: detection.fps > 0 ? detection.fps : 30,
    paddingSec,
    sampleFps,
    windows: mergeWindows(windows),
  };
}

function windowWithPadding(
  rally: RallyWindow,
  paddingSec: number,
  durationSec: number
): { startSec: number; endSec: number } {
  const startSec = Math.max(0, rally.startMs / 1000 - paddingSec);
  const endSec =
    durationSec > 0
      ? Math.min(durationSec, rally.endMs / 1000 + paddingSec)
      : rally.endMs / 1000 + paddingSec;
  return { startSec, endSec: Math.max(startSec, endSec) };
}

function mergeWindows(
  windows: Array<{ startSec: number; endSec: number }>
): Array<{ startSec: number; endSec: number }> {
  if (windows.length === 0) return windows;
  const sorted = [...windows].sort((a, b) => a.startSec - b.startSec);
  const merged: Array<{ startSec: number; endSec: number }> = [];
  let current = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    if (next.startSec <= current.endSec) {
      current.endSec = Math.max(current.endSec, next.endSec);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

export async function writeRallyWindowsFile(
  payload: RallyWindowsPayload
): Promise<string> {
  const filePath = path.join(
    tmpdir(),
    `padel-rally-windows-${Date.now()}-${randomBytes(4).toString("hex")}.json`
  );
  await writeFile(filePath, JSON.stringify(payload), "utf8");
  return filePath;
}

export function activeDurationSec(payload: RallyWindowsPayload): number {
  return payload.windows.reduce(
    (sum, window) => sum + Math.max(0, window.endSec - window.startSec),
    0
  );
}
