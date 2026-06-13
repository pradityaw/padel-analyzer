/** Gap before rally start where we still allow natural playback (keyframe snap). */
export const ONLY_RALLIES_TOLERANCE_SEC = 0.05;

export type OnlyRalliesSeekPlan = {
  /** When set, assign to `video.currentTime` once. */
  seekToSec: number | null;
  /** Updated pending target; pass back on the next tick. */
  pendingSeekTargetSec: number | null;
};

/**
 * Decide whether Only Rallies playback should seek toward the next rally.
 * Seeks at most once per rally target so keyframe snap can let playback advance.
 */
export function planOnlyRalliesSeek(args: {
  currentTimeSec: number;
  nextRallyStartMs: number | null;
  pendingSeekTargetSec: number | null;
}): OnlyRalliesSeekPlan {
  if (args.nextRallyStartMs == null) {
    return { seekToSec: null, pendingSeekTargetSec: null };
  }

  const target = Math.max(0, args.nextRallyStartMs / 1000);
  if (target - args.currentTimeSec <= ONLY_RALLIES_TOLERANCE_SEC) {
    return { seekToSec: null, pendingSeekTargetSec: null };
  }

  if (args.pendingSeekTargetSec === target) {
    return { seekToSec: null, pendingSeekTargetSec: target };
  }

  return { seekToSec: target + 0.001, pendingSeekTargetSec: target };
}
