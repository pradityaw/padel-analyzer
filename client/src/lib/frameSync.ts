import type { FrameLandmarks, SwingPhase } from "@shared/types";

/** Pre-built lookup tables for O(1) / O(log n) frame resolution during video scrub. */
export type FrameSyncIndex = {
  frames: FrameLandmarks[];
  /** Logical frameIndex → array index */
  byFrameIndex: Map<number, number>;
  /** Monotonic timestamps in seconds (parallel to frames[]) */
  timestampsSec: number[];
  sampleFps: number;
};

export function buildFrameSyncIndex(
  frames: FrameLandmarks[],
  sampleFps: number
): FrameSyncIndex {
  const byFrameIndex = new Map<number, number>();
  const timestampsSec: number[] = new Array(frames.length);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    byFrameIndex.set(frame.frameIndex, i);
    timestampsSec[i] = frame.timestamp / 1000;
  }

  return {
    frames,
    byFrameIndex,
    timestampsSec,
    sampleFps: Math.max(sampleFps, 1),
  };
}

/** Resolve the landmarks array index closest to a video timestamp (seconds). */
export function resolveFrameAtTime(
  index: FrameSyncIndex,
  timeSec: number
): number {
  const times = index.timestampsSec;
  const n = times.length;
  if (n === 0) return 0;
  if (n === 1) return 0;

  if (timeSec <= times[0]!) return 0;
  if (timeSec >= times[n - 1]!) return n - 1;

  let lo = 0;
  let hi = n - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = times[mid]!;
    if (t < timeSec) lo = mid + 1;
    else if (t > timeSec) hi = mid - 1;
    else return mid;
  }

  const after = Math.min(lo, n - 1);
  const before = Math.max(after - 1, 0);
  const distAfter = Math.abs(times[after]! - timeSec);
  const distBefore = Math.abs(times[before]! - timeSec);
  return distBefore <= distAfter ? before : after;
}

/** Resolve array index for a logical frame number (handles sparse sampling). */
export function resolveArrayIndexForFrameIndex(
  index: FrameSyncIndex,
  frameIndex: number
): number {
  const exact = index.byFrameIndex.get(frameIndex);
  if (exact !== undefined) return exact;

  const { frames } = index;
  if (frames.length === 0) return 0;

  let lo = 0;
  let hi = frames.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.frameIndex < frameIndex) lo = mid + 1;
    else hi = mid;
  }

  if (lo > 0) {
    const distLo = Math.abs(frames[lo]!.frameIndex - frameIndex);
    const distPrev = Math.abs(frames[lo - 1]!.frameIndex - frameIndex);
    if (distPrev <= distLo) return lo - 1;
  }
  return lo;
}

/** Map logical frameIndex → video seek time in seconds. */
export function frameIndexToTimeSec(
  index: FrameSyncIndex,
  frameIndex: number
): number {
  const arrayIdx = resolveArrayIndexForFrameIndex(index, frameIndex);
  const frame = index.frames[arrayIdx];
  if (frame) return frame.timestamp / 1000;
  return frameIndex / index.sampleFps;
}

export function getPhaseAtFrameIndex(
  phases: SwingPhase[],
  frameIndex: number
): SwingPhase | undefined {
  return phases.find(
    (p) => frameIndex >= p.startFrame && frameIndex <= p.endFrame
  );
}
