import { SKELETON_CONNECTIONS } from "@shared/skeletonConnections";
import type { Landmark } from "@shared/types";
import type { OverlayLayerFlags, PackedOverlayPayload } from "@shared/overlayTypes";

const REGION_COLORS: Record<string, string> = {
  torso: "#ffffff",
  leftArm: "#60a5fa",
  rightArm: "#60a5fa",
  leftLeg: "#34d399",
  rightLeg: "#34d399",
  face: "#a78bfa",
};

const BALL_COLOR = "#facc15";
const BALL_TRAIL_COLOR = "rgba(250, 204, 21, 0.35)";
const BALL_TRAIL_LENGTH = 8;

function getRegion(a: number, b: number): string {
  if ([11, 12, 23, 24].includes(a) && [11, 12, 23, 24].includes(b))
    return "torso";
  if ([11, 13, 15].includes(a) && [11, 13, 15].includes(b)) return "leftArm";
  if ([12, 14, 16].includes(a) && [12, 14, 16].includes(b)) return "rightArm";
  if ([23, 25, 27].includes(a) && [23, 25, 27].includes(b)) return "leftLeg";
  if ([24, 26, 28].includes(a) && [24, 26, 28].includes(b)) return "rightLeg";
  return "face";
}

function readPackedLandmark(
  payload: PackedOverlayPayload,
  frameIdx: number,
  landmarkIdx: number
): { x: number; y: number; visibility: number } {
  const stride = payload.landmarkCount * 3;
  const offset = frameIdx * stride + landmarkIdx * 3;
  return {
    x: payload.positions[offset]!,
    y: payload.positions[offset + 1]!,
    visibility: payload.positions[offset + 2]!,
  };
}

export function unpackLandmarks(
  payload: PackedOverlayPayload,
  frameIdx: number
): Landmark[] {
  const landmarks: Landmark[] = new Array(payload.landmarkCount);
  for (let i = 0; i < payload.landmarkCount; i++) {
    const lm = readPackedLandmark(payload, frameIdx, i);
    landmarks[i] = { x: lm.x, y: lm.y, z: 0, visibility: lm.visibility };
  }
  return landmarks;
}

export function drawSkeletonFromLandmarks(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  options?: { highlightContact?: boolean; opacity?: number }
): void {
  const alpha = options?.opacity ?? 1;

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if (la.visibility < 0.3 || lb.visibility < 0.3) continue;

    const region = getRegion(a, b);
    ctx.strokeStyle = REGION_COLORS[region] || "#ffffff";
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(la.x * width, la.y * height);
    ctx.lineTo(lb.x * width, lb.y * height);
    ctx.stroke();
  }

  const highlightIndices = options?.highlightContact ? [15, 16] : [];

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (!lm || lm.visibility < 0.3) continue;

    const isHighlight = highlightIndices.includes(i);
    const radius = isHighlight ? 7 : 4;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = isHighlight ? "#f59e0b" : "#ffffff";
    ctx.beginPath();
    ctx.arc(lm.x * width, lm.y * height, radius, 0, 2 * Math.PI);
    ctx.fill();

    if (isHighlight) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha * 0.4;
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 12, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
}

export function drawSkeletonFromPacked(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  payload: PackedOverlayPayload,
  arrayIdx: number,
  width: number,
  height: number,
  options?: { highlightContact?: boolean; opacity?: number }
): void {
  if (arrayIdx < 0 || arrayIdx >= payload.frameCount) return;
  const landmarks = unpackLandmarks(payload, arrayIdx);
  drawSkeletonFromLandmarks(ctx, landmarks, width, height, options);
}

export function drawBallFromPacked(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  payload: PackedOverlayPayload,
  arrayIdx: number,
  width: number,
  height: number
): void {
  const ball = payload.ballPositions;
  if (!ball || arrayIdx < 0 || arrayIdx >= payload.frameCount) return;

  const trailStart = Math.max(0, arrayIdx - BALL_TRAIL_LENGTH);
  ctx.lineWidth = 2;
  ctx.strokeStyle = BALL_TRAIL_COLOR;
  ctx.beginPath();
  let started = false;

  for (let i = trailStart; i <= arrayIdx; i++) {
    const x = ball[i * 2]!;
    const y = ball[i * 2 + 1]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      started = false;
      continue;
    }
    const px = x * width;
    const py = y * height;
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  if (started) ctx.stroke();

  const cx = ball[arrayIdx * 2]!;
  const cy = ball[arrayIdx * 2 + 1]!;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

  ctx.globalAlpha = 1;
  ctx.fillStyle = BALL_COLOR;
  ctx.beginPath();
  ctx.arc(cx * width, cy * height, 6, 0, 2 * Math.PI);
  ctx.fill();
}

export type DrawOverlayOptions = {
  layers: OverlayLayerFlags;
  highlightContact?: boolean;
  opacity?: number;
};

/** Clear canvas and draw all enabled overlay layers for the given frame index. */
export function drawOverlayFrame(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  payload: PackedOverlayPayload,
  arrayIdx: number,
  width: number,
  height: number,
  options: DrawOverlayOptions
): void {
  ctx.clearRect(0, 0, width, height);

  if (arrayIdx < 0 || arrayIdx >= payload.frameCount) return;

  if (options.layers.skeleton) {
    drawSkeletonFromPacked(ctx, payload, arrayIdx, width, height, {
      highlightContact: options.highlightContact,
      opacity: options.opacity,
    });
  }

  if (options.layers.ball) {
    drawBallFromPacked(ctx, payload, arrayIdx, width, height);
  }
}
