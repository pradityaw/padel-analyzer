import type { BallTrackSample } from "./types";

/** Minimum confidence to render overlay or speed (matches server schema upper bound). */
export const MIN_BALL_TRACK_CONFIDENCE = 0.15;

export type NormalizedBallPoint = {
  x: number;
  y: number;
  confidence: number;
};

export type BallFrameMap = Map<number, NormalizedBallPoint>;

function isFiniteTuple(value: unknown): value is BallTrackSample {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [frameIndex, x, y, confidence] = value;
  return (
    typeof frameIndex === "number" &&
    Number.isFinite(frameIndex) &&
    frameIndex >= 0 &&
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}

/**
 * Normalize image-space coordinates to 0–1 for SVG viewBox overlay.
 * Values already in [0, 1] are kept; pixel coords are divided by dimensions.
 */
export function normalizeBallCoordinate(
  value: number,
  axisMax: number
): number | null {
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (!Number.isFinite(axisMax) || axisMax <= 0) return null;
  const normalized = value / axisMax;
  if (!Number.isFinite(normalized)) return null;
  return normalized;
}

/** Validate and coerce unknown API payloads into typed samples. */
export function parseBallTrackingSamples(
  raw: unknown
): BallTrackSample[] {
  if (!Array.isArray(raw)) return [];
  const out: BallTrackSample[] = [];
  for (const item of raw) {
    if (!isFiniteTuple(item)) continue;
    const [frameIndex, x, y, confidence] = item;
    if (confidence < MIN_BALL_TRACK_CONFIDENCE) continue;
    out.push([
      Math.round(frameIndex),
      x,
      y,
      confidence,
    ]);
  }
  return out;
}

/**
 * Build a per-frameIndex map, keeping the highest-confidence sample per frame.
 */
export function buildBallFrameMap(
  samples: BallTrackSample[] | null | undefined,
  dimensions: { w: number; h: number } = { w: 1, h: 1 }
): BallFrameMap {
  const map: BallFrameMap = new Map();
  if (!samples?.length) return map;

  for (const [frameIndex, rawX, rawY, confidence] of samples) {
    if (confidence < MIN_BALL_TRACK_CONFIDENCE) continue;

    const nx = normalizeBallCoordinate(rawX, dimensions.w);
    const ny = normalizeBallCoordinate(rawY, dimensions.h);
    if (nx == null || ny == null) continue;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;

    const existing = map.get(frameIndex);
    if (existing && existing.confidence >= confidence) continue;

    map.set(frameIndex, { x: nx, y: ny, confidence });
  }

  return map;
}

export function getBallForFrameIndex(
  map: BallFrameMap,
  frameIndex: number | null | undefined
): NormalizedBallPoint | null {
  if (frameIndex == null || !Number.isFinite(frameIndex)) return null;
  return map.get(Math.round(frameIndex)) ?? null;
}

/**
 * Pixel-normalized speed between two consecutive tracked frames (honest label: px/frame).
 * Returns null when frame delta is zero or points are invalid.
 */
export function computeBallSpeedPxPerFrame(
  prev: NormalizedBallPoint | null,
  curr: NormalizedBallPoint | null,
  frameDelta: number
): number | null {
  if (
    !prev ||
    !curr ||
    !Number.isFinite(frameDelta) ||
    frameDelta <= 0
  ) {
    return null;
  }

  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist)) return null;

  const speed = dist / frameDelta;
  return Number.isFinite(speed) && speed >= 0 ? speed : null;
}

/**
 * Convert normalized px/frame speed to km/h when meters-per-normalized-unit is known.
 * Mobile typically lacks court calibration; omit unless caller supplies scale.
 */
export function normalizedPxPerFrameToKmh(
  pxPerFrame: number,
  fps: number,
  metersPerNormalizedUnit: number
): number | null {
  if (
    !Number.isFinite(pxPerFrame) ||
    !Number.isFinite(fps) ||
    !Number.isFinite(metersPerNormalizedUnit) ||
    fps <= 0 ||
    metersPerNormalizedUnit <= 0 ||
    pxPerFrame < 0
  ) {
    return null;
  }
  const mps = pxPerFrame * metersPerNormalizedUnit * fps;
  const kmh = mps * 3.6;
  return Number.isFinite(kmh) && kmh >= 0 ? kmh : null;
}

/** Find the best prior sample within `maxGap` frames for speed estimation. */
export function findPriorBallSample(
  map: BallFrameMap,
  frameIndex: number,
  maxGap = 5
): { point: NormalizedBallPoint; frameIndex: number } | null {
  for (let delta = 1; delta <= maxGap; delta++) {
    const prior = map.get(frameIndex - delta);
    if (prior) return { point: prior, frameIndex: frameIndex - delta };
  }
  return null;
}

export function formatBallSpeedLabel(
  pxPerFrame: number | null,
  fps: number,
  kmh: number | null
): string | null {
  if (kmh != null && Number.isFinite(kmh)) {
    return `${Math.round(kmh)} km/h`;
  }
  if (pxPerFrame != null && Number.isFinite(pxPerFrame) && fps > 0) {
    const rel = pxPerFrame * fps * 100;
    return `~${rel.toFixed(0)} rel speed`;
  }
  return null;
}
