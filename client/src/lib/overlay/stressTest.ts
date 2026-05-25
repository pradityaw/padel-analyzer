import { drawOverlayFrame } from "./drawOverlay";
import { overlayTimingStats } from "./overlayFrameBudget";
import type { PackedOverlayPayload } from "@shared/overlayTypes";

export const OVERLAY_STRESS_VIEWPORT = { w: 3840, h: 2160 } as const;
export const OVERLAY_STRESS_FPS = 60;

const LANDMARK_COUNT = 33;
const DEFAULT_STRESS_FRAMES = 300;

function isLocalDevHost(): boolean {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/** Dev-only: `?overlayStress=1` on localhost with VideoPlayer mounted. */
export function isOverlayStressMode(): boolean {
  if (typeof window === "undefined" || !isLocalDevHost()) return false;
  return new URLSearchParams(window.location.search).get("overlayStress") === "1";
}

/**
 * Packed 4K-scale coordinate stream with sinusoidal ball motion and animated skeleton.
 */
export function buildMockStressPayload(
  frameCount = DEFAULT_STRESS_FRAMES
): PackedOverlayPayload {
  const positions = new Float32Array(frameCount * LANDMARK_COUNT * 3);
  const ballPositions = new Float32Array(frameCount * 2);
  const frameIndices = new Int32Array(frameCount);
  const timestampsMs = new Float32Array(frameCount);

  for (let fi = 0; fi < frameCount; fi++) {
    frameIndices[fi] = fi;
    timestampsMs[fi] = (fi / OVERLAY_STRESS_FPS) * 1000;

    const phase = (fi / frameCount) * Math.PI * 4;
    const cx = 0.5 + Math.sin(phase) * 0.35;
    const cy = 0.5 + Math.cos(phase * 0.7) * 0.28;
    ballPositions[fi * 2] = cx;
    ballPositions[fi * 2 + 1] = cy;

    for (let li = 0; li < LANDMARK_COUNT; li++) {
      const offset = fi * LANDMARK_COUNT * 3 + li * 3;
      const jitter = Math.sin(phase + li * 0.4) * 0.02;
      positions[offset] = 0.5 + (li % 7) * 0.03 + jitter;
      positions[offset + 1] = 0.35 + (li % 5) * 0.04 + jitter * 0.5;
      positions[offset + 2] = 0.85;
    }
  }

  return {
    frameCount,
    landmarkCount: LANDMARK_COUNT,
    positions,
    frameIndices,
    timestampsMs,
    ballPositions,
  };
}

export type OverlayStressResult = {
  framesPainted: number;
  durationMs: number;
  timing: ReturnType<typeof overlayTimingStats>;
};

/**
 * Runs a 60fps main-thread overlay paint loop at 3840×2160 to stress the canvas path.
 * Returns a cancel function; logs p50/p95/max to the console when complete.
 */
export function startOverlayStressTest(options: {
  canvas: HTMLCanvasElement;
  durationSec?: number;
  onComplete?: (result: OverlayStressResult) => void;
}): () => void {
  const { w, h } = OVERLAY_STRESS_VIEWPORT;
  const durationSec = options.durationSec ?? 5;
  const payload = buildMockStressPayload();
  const canvas = options.canvas;

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.warn("[overlay-stress] 2d context unavailable");
    return () => {};
  }

  const samples: number[] = [];
  let frameIdx = 0;
  let cancelled = false;
  let rafId = 0;
  const startedAt = performance.now();
  const frameIntervalMs = 1000 / OVERLAY_STRESS_FPS;
  let nextFrameAt = startedAt;

  const tick = (now: number) => {
    if (cancelled) return;

    if (now < nextFrameAt) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    nextFrameAt += frameIntervalMs;

    const t0 = performance.now();
    drawOverlayFrame(ctx, payload, frameIdx % payload.frameCount, w, h, {
      layers: { skeleton: true, ball: true },
      highlightContact: frameIdx % 47 === 0,
    });
    samples.push(performance.now() - t0);
    frameIdx += 1;

    const elapsed = performance.now() - startedAt;
    if (elapsed < durationSec * 1000) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    const timing = overlayTimingStats(samples);
    const result: OverlayStressResult = {
      framesPainted: frameIdx,
      durationMs: elapsed,
      timing,
    };

    console.info("[overlay-stress] 4K @ 60fps complete", {
      viewport: `${w}×${h}`,
      frames: result.framesPainted,
      durationSec: (result.durationMs / 1000).toFixed(2),
      p50Ms: timing.p50.toFixed(2),
      p95Ms: timing.p95.toFixed(2),
      maxMs: timing.max.toFixed(2),
    });

    options.onComplete?.(result);
  };

  console.info(
    `[overlay-stress] starting ${w}×${h} @ ${OVERLAY_STRESS_FPS}fps for ${durationSec}s (main-thread drawOverlay)`
  );
  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}
