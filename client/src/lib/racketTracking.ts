import type { FrameLandmarks, RacketTrackSample } from "@shared/types";
import { resolveArrayIndexForFrameIndex, type FrameSyncIndex } from "@/lib/frameSync";

type Dimensions = { w: number; h: number };

function normalizeCoordinate(value: number, max: number): number {
  if (value >= 0 && value <= 1) return value;
  if (!Number.isFinite(max) || max <= 0) return Number.NaN;
  return value / max;
}

/**
 * Convert raw `[frameIndex, playerId, imageX, imageY, confidence]` samples
 * into a packed per-frame `[x, y]` Float32Array for the dominant player.
 *
 * This mirrors {@link buildBallPositionsForFrames}: NaN entries flag
 * missing frames, the array is positioned by the frame-sync index, and
 * higher-confidence samples overwrite lower-confidence ones. The
 * `interpolated` flag is recovered from the confidence band
 * (`confidence < 0.5`).
 *
 * @param targetPlayerId Restrict samples to a specific player id (most
 *   sessions only have one swing player so the default of `1` matches
 *   the Python tracker's default emit).
 */
export function buildRacketPositionsForFrames(
  frames: FrameLandmarks[],
  racketTracking: RacketTrackSample[] | null | undefined,
  frameSync: FrameSyncIndex,
  dimensions: Dimensions,
  targetPlayerId: number = 1
): Float32Array | undefined {
  if (!racketTracking || racketTracking.length === 0 || frames.length === 0) {
    return undefined;
  }

  const positions = new Float32Array(frames.length * 2);
  const confidences = new Float32Array(frames.length);
  positions.fill(Number.NaN);
  confidences.fill(-1);

  for (const [frameIndex, playerId, x, y, confidence] of racketTracking) {
    if (playerId !== targetPlayerId) continue;
    if (
      !Number.isFinite(frameIndex) ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(confidence)
    ) {
      continue;
    }

    const arrayIdx = resolveArrayIndexForFrameIndex(frameSync, frameIndex);
    if (arrayIdx < 0 || arrayIdx >= frames.length) continue;
    if (confidence < confidences[arrayIdx]!) continue;

    const nx = normalizeCoordinate(x, dimensions.w);
    const ny = normalizeCoordinate(y, dimensions.h);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;

    positions[arrayIdx * 2] = nx;
    positions[arrayIdx * 2 + 1] = ny;
    confidences[arrayIdx] = confidence;
  }

  return confidences.some((confidence) => confidence >= 0)
    ? positions
    : undefined;
}
