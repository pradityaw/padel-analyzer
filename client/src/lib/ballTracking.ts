import type { BallTrackSample, FrameLandmarks } from "@shared/types";
import { resolveArrayIndexForFrameIndex, type FrameSyncIndex } from "@/lib/frameSync";

type Dimensions = { w: number; h: number };

/** Minimum per-frame confidence to use a ball sample for live km/h. */
export const MIN_BALL_SPEED_CONFIDENCE = 0.5;

export type PackedBallTrack = {
  positions: Float32Array;
  confidences: Float32Array;
};

function normalizeCoordinate(value: number, max: number): number {
  if (value >= 0 && value <= 1) return value;
  if (!Number.isFinite(max) || max <= 0) return Number.NaN;
  return value / max;
}

/**
 * Convert raw [frameIndex, imageX, imageY, confidence] samples into packed
 * per-frame positions and confidences for overlay and speed hooks.
 */
export function buildPackedBallTrackForFrames(
  frames: FrameLandmarks[],
  ballTracking: BallTrackSample[] | null | undefined,
  frameSync: FrameSyncIndex,
  dimensions: Dimensions
): PackedBallTrack | undefined {
  if (!ballTracking || ballTracking.length === 0 || frames.length === 0) {
    return undefined;
  }

  const positions = new Float32Array(frames.length * 2);
  const confidences = new Float32Array(frames.length);
  positions.fill(Number.NaN);
  confidences.fill(-1);

  for (const [frameIndex, x, y, confidence] of ballTracking) {
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

  if (!confidences.some((c) => c >= 0)) return undefined;
  return { positions, confidences };
}

/**
 * Positions-only view of {@link buildPackedBallTrackForFrames} for overlay packing.
 */
export function buildBallPositionsForFrames(
  frames: FrameLandmarks[],
  ballTracking: BallTrackSample[] | null | undefined,
  frameSync: FrameSyncIndex,
  dimensions: Dimensions
): Float32Array | undefined {
  return buildPackedBallTrackForFrames(
    frames,
    ballTracking,
    frameSync,
    dimensions
  )?.positions;
}
