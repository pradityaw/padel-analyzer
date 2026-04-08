import type { Landmark } from "@shared/types";

const CONNECTIONS: [number, number][] = [
  // Torso
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // Left arm
  [11, 13],
  [13, 15],
  // Right arm
  [12, 14],
  [14, 16],
  // Left leg
  [23, 25],
  [25, 27],
  // Right leg
  [24, 26],
  [26, 28],
  // Face
  [0, 11],
  [0, 12],
];

const REGION_COLORS: Record<string, string> = {
  torso: "#ffffff",
  leftArm: "#60a5fa",
  rightArm: "#60a5fa",
  leftLeg: "#34d399",
  rightLeg: "#34d399",
  face: "#a78bfa",
};

function getRegion(a: number, b: number): string {
  if ([11, 12, 23, 24].includes(a) && [11, 12, 23, 24].includes(b))
    return "torso";
  if ([11, 13, 15].includes(a) && [11, 13, 15].includes(b)) return "leftArm";
  if ([12, 14, 16].includes(a) && [12, 14, 16].includes(b)) return "rightArm";
  if ([23, 25, 27].includes(a) && [23, 25, 27].includes(b)) return "leftLeg";
  if ([24, 26, 28].includes(a) && [24, 26, 28].includes(b)) return "rightLeg";
  return "face";
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  options?: { highlightContact?: boolean; opacity?: number }
) {
  const alpha = options?.opacity ?? 1;
  ctx.clearRect(0, 0, width, height);

  // Draw connections
  for (const [a, b] of CONNECTIONS) {
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

  // Draw keypoints
  const highlightIndices = options?.highlightContact
    ? [15, 16]
    : [];

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (lm.visibility < 0.3) continue;

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
