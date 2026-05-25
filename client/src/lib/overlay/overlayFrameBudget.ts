/** Target overlay paint budget (60fps frame interval). */
export const OVERLAY_FRAME_BUDGET_MS = 16;

export type OverlaySkipLevel = 0 | 1 | 2 | 3;

export type OverlayDegradeFlags = {
  skipBallTrail?: boolean;
  skipSkeleton?: boolean;
  skipAllLayers?: boolean;
};

const SAMPLE_WINDOW = 60;
const ESCALATE_CONSECUTIVE_SLOW = 3;
const ESCALATE_P95_FACTOR = 1.25;
const RECOVER_P95_FACTOR = 0.75;

export function computePercentile(samples: number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
  );
  return sorted[rank]!;
}

export function overlayTimingStats(samples: number[]): {
  p50: number;
  p95: number;
  max: number;
  count: number;
} {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, max: 0, count: 0 };
  }
  return {
    p50: computePercentile(samples, 50),
    p95: computePercentile(samples, 95),
    max: Math.max(...samples),
    count: samples.length,
  };
}

export function degradeFlagsFromSkipLevel(
  level: OverlaySkipLevel,
  frameSerial: number
): OverlayDegradeFlags {
  switch (level) {
    case 0:
      return {};
    case 1:
      return { skipBallTrail: true };
    case 2:
      return { skipSkeleton: frameSerial % 2 === 1 };
    case 3:
      return { skipAllLayers: frameSerial % 2 === 1 };
    default:
      return {};
  }
}

/**
 * Rolling overlay paint budget tracker. Escalates degrade levels when p95 or
 * consecutive paints exceed the 16ms budget; recovers when load drops.
 */
export class OverlayFrameBudget {
  private samples: number[] = [];
  private skipLevel: OverlaySkipLevel = 0;
  private consecutiveSlow = 0;
  private frameSerial = 0;

  reset(): void {
    this.samples = [];
    this.skipLevel = 0;
    this.consecutiveSlow = 0;
    this.frameSerial = 0;
  }

  get skipLevelSnapshot(): OverlaySkipLevel {
    return this.skipLevel;
  }

  degradeForFrame(): OverlayDegradeFlags {
    this.frameSerial += 1;
    return degradeFlagsFromSkipLevel(this.skipLevel, this.frameSerial);
  }

  record(durationMs: number): void {
    this.samples.push(durationMs);
    if (this.samples.length > SAMPLE_WINDOW) {
      this.samples.shift();
    }

    if (durationMs > OVERLAY_FRAME_BUDGET_MS) {
      this.consecutiveSlow += 1;
    } else if (this.consecutiveSlow > 0) {
      this.consecutiveSlow -= 1;
    }

    const p95 = computePercentile(this.samples, 95);

    if (
      this.consecutiveSlow >= ESCALATE_CONSECUTIVE_SLOW ||
      p95 > OVERLAY_FRAME_BUDGET_MS * ESCALATE_P95_FACTOR
    ) {
      this.skipLevel = Math.min(3, this.skipLevel + 1) as OverlaySkipLevel;
      this.consecutiveSlow = 0;
      return;
    }

    if (
      this.skipLevel > 0 &&
      p95 < OVERLAY_FRAME_BUDGET_MS * RECOVER_P95_FACTOR &&
      this.consecutiveSlow === 0
    ) {
      this.skipLevel = Math.max(0, this.skipLevel - 1) as OverlaySkipLevel;
    }
  }

  getTimingStats(): ReturnType<typeof overlayTimingStats> {
    return overlayTimingStats(this.samples);
  }
}
