import { readFile } from "fs/promises";
import path from "path";
import type { BallTrackSample, FrameLandmarksPayload } from "../../shared/schema.js";
import { ballTrackSampleSchema, frameLandmarksSchema } from "../../shared/schema.js";
import { getDataRoot } from "./paths.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseFrameLandmarks(json: string): FrameLandmarksPayload[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((frame) => frameLandmarksSchema.safeParse(frame))
      .filter((result): result is { success: true; data: FrameLandmarksPayload } => result.success)
      .map((result) => result.data);
  } catch {
    return [];
  }
}

function resolveFrameIndexByTimestamp(
  frames: FrameLandmarksPayload[],
  timestampMs: number
): number | null {
  if (frames.length === 0 || !Number.isFinite(timestampMs)) return null;
  if (timestampMs <= frames[0]!.timestamp) return frames[0]!.frameIndex;
  if (timestampMs >= frames[frames.length - 1]!.timestamp) {
    return frames[frames.length - 1]!.frameIndex;
  }

  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const frame = frames[mid]!;
    if (frame.timestamp < timestampMs) lo = mid + 1;
    else if (frame.timestamp > timestampMs) hi = mid - 1;
    else return frame.frameIndex;
  }

  const after = Math.min(lo, frames.length - 1);
  const before = Math.max(after - 1, 0);
  const afterDist = Math.abs(frames[after]!.timestamp - timestampMs);
  const beforeDist = Math.abs(frames[before]!.timestamp - timestampMs);
  return beforeDist <= afterDist
    ? frames[before]!.frameIndex
    : frames[after]!.frameIndex;
}

function normalizeTrackPoint(
  point: unknown,
  frames: FrameLandmarksPayload[]
): BallTrackSample | null {
  if (Array.isArray(point)) {
    const parsed = ballTrackSampleSchema.safeParse(point);
    return parsed.success ? parsed.data : null;
  }
  if (!isRecord(point)) return null;

  const x = finiteNumber(point.image_x) ?? finiteNumber(point.x);
  const y = finiteNumber(point.image_y) ?? finiteNumber(point.y);
  const confidence = finiteNumber(point.confidence);
  if (x == null || y == null || confidence == null) return null;

  const timestampSec = finiteNumber(point.timestamp_sec);
  const timestampMs = timestampSec == null ? null : timestampSec * 1_000;
  const timestampFrameIndex =
    timestampMs == null ? null : resolveFrameIndexByTimestamp(frames, timestampMs);

  const sourceFrameIndex =
    finiteNumber(point.frame_idx) ??
    finiteNumber(point.frameIndex) ??
    finiteNumber(point.frame_index);
  const frameIndex = timestampFrameIndex ?? sourceFrameIndex;
  if (frameIndex == null || frameIndex < 0) return null;

  return [Math.round(frameIndex), x, y, confidence];
}

export function normalizeBallTrackSamples(
  ballTrajectory: unknown,
  landmarksJson: string
): BallTrackSample[] {
  if (!isRecord(ballTrajectory)) return [];
  const rawTrack = ballTrajectory.ball_track ?? ballTrajectory.ballTracking;
  if (!Array.isArray(rawTrack)) return [];

  const frames = parseFrameLandmarks(landmarksJson);
  const samples: BallTrackSample[] = [];
  for (const point of rawTrack) {
    const sample = normalizeTrackPoint(point, frames);
    if (sample) samples.push(sample);
  }
  return samples;
}

export async function readAnalysisBallTracking(
  jobId: number | null | undefined,
  landmarksJson: string
): Promise<BallTrackSample[]> {
  if (jobId == null) return [];
  const artifactPath = path.join(getDataRoot(), "analysis-agents", `job-${jobId}.json`);
  try {
    const raw = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(raw) as unknown;
    const ballTrajectory = isRecord(artifact)
      && isRecord(artifact.agents)
      ? artifact.agents.ballTrajectory
      : null;
    return normalizeBallTrackSamples(ballTrajectory, landmarksJson);
  } catch {
    return [];
  }
}
