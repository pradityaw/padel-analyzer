import { readFile } from "fs/promises";
import path from "path";
import type {
  FrameLandmarksPayload,
  RacketTrackSample,
} from "../../shared/schema.js";
import {
  frameLandmarksSchema,
  racketTrackSampleSchema,
} from "../../shared/schema.js";
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
      .filter(
        (result): result is { success: true; data: FrameLandmarksPayload } =>
          result.success
      )
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

function normalizeRacketSample(
  sample: unknown,
  defaultPlayerId: number,
  frames: FrameLandmarksPayload[]
): RacketTrackSample | null {
  if (Array.isArray(sample)) {
    const parsed = racketTrackSampleSchema.safeParse(sample);
    return parsed.success ? parsed.data : null;
  }
  if (!isRecord(sample)) return null;

  const x = finiteNumber(sample.x) ?? finiteNumber(sample.image_x);
  const y = finiteNumber(sample.y) ?? finiteNumber(sample.image_y);
  const confidence = finiteNumber(sample.confidence);
  if (x == null || y == null || confidence == null) return null;

  const playerId =
    finiteNumber(sample.player_id) ??
    finiteNumber(sample.playerId) ??
    defaultPlayerId;
  if (playerId == null || playerId < 0) return null;

  const timestampSec = finiteNumber(sample.timestamp_sec);
  const timestampMs = timestampSec == null ? null : timestampSec * 1_000;
  const timestampFrameIndex =
    timestampMs == null ? null : resolveFrameIndexByTimestamp(frames, timestampMs);

  const sourceFrameIndex =
    finiteNumber(sample.frame_idx) ??
    finiteNumber(sample.frameIndex) ??
    finiteNumber(sample.frame_index);
  const frameIndex = timestampFrameIndex ?? sourceFrameIndex;
  if (frameIndex == null || frameIndex < 0) return null;

  const clampedConfidence = Math.max(0, Math.min(1, confidence));
  return [
    Math.round(frameIndex),
    Math.round(playerId),
    x,
    y,
    clampedConfidence,
  ];
}

/**
 * Normalise the racket-tracking artifact emitted by the Python
 * tracker into the typed tuple format consumed by the client.
 *
 * Accepts both the array-of-objects shape produced by
 * `track_racket_heads_from_landmarks` and the flat tuple shape so
 * downstream tools can pre-normalise without breaking us.
 */
export function normalizeRacketTrackSamples(
  racketArtifact: unknown,
  landmarksJson: string
): RacketTrackSample[] {
  const frames = parseFrameLandmarks(landmarksJson);
  const samples: RacketTrackSample[] = [];

  if (!isRecord(racketArtifact)) return samples;

  const rawPlayers = racketArtifact.players;
  if (Array.isArray(rawPlayers) && rawPlayers.length > 0) {
    for (const playerEntry of rawPlayers) {
      if (!isRecord(playerEntry)) continue;
      const playerId =
        finiteNumber(playerEntry.player_id) ??
        finiteNumber(playerEntry.playerId) ??
        1;
      const rawSamples = playerEntry.samples;
      if (!Array.isArray(rawSamples)) continue;
      for (const sample of rawSamples) {
        const normalized = normalizeRacketSample(sample, playerId, frames);
        if (normalized) samples.push(normalized);
      }
    }
    return samples;
  }

  // Fall-through: accept a top-level `samples`/`racket_track` array.
  const rawList =
    (Array.isArray(racketArtifact.samples) && racketArtifact.samples) ||
    (Array.isArray(racketArtifact.racket_track) && racketArtifact.racket_track) ||
    null;
  if (Array.isArray(rawList)) {
    for (const sample of rawList) {
      const normalized = normalizeRacketSample(sample, 1, frames);
      if (normalized) samples.push(normalized);
    }
  }
  return samples;
}

export async function readAnalysisRacketTracking(
  jobId: number | null | undefined,
  landmarksJson: string
): Promise<RacketTrackSample[]> {
  if (jobId == null) return [];
  const artifactPath = path.join(
    getDataRoot(),
    "analysis-agents",
    `job-${jobId}.json`
  );
  try {
    const raw = await readFile(artifactPath, "utf8");
    const artifact = JSON.parse(raw) as unknown;
    const racketArtifact =
      isRecord(artifact) && isRecord(artifact.agents)
        ? artifact.agents.racketTracking
        : null;
    return normalizeRacketTrackSamples(racketArtifact, landmarksJson);
  } catch {
    return [];
  }
}
