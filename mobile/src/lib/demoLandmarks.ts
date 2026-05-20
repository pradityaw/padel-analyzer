type Landmark = { x: number; y: number; z: number; visibility: number };
export type FrameLandmarks = {
  frameIndex: number;
  timestamp: number;
  landmarks: Landmark[];
};

const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

function basePose(t: number): Landmark[] {
  const swing = Math.sin(t * Math.PI * 2);
  const backswing = Math.max(0, Math.sin(t * Math.PI * 2 - Math.PI / 2));
  const contact = Math.exp(-Math.pow((t - 0.55) * 8, 2));

  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));

  const set = (idx: number, x: number, y: number, vis = 1) => {
    landmarks[idx] = { x, y, z: 0, visibility: vis };
  };

  const cx = 0.5;
  const shoulderY = 0.32 + backswing * 0.02;
  const hipY = 0.52;
  const kneeY = 0.68;
  const ankleY = 0.82;

  set(LM.NOSE, cx, 0.18);
  set(LM.LEFT_SHOULDER, cx - 0.08, shoulderY);
  set(LM.RIGHT_SHOULDER, cx + 0.08, shoulderY);
  set(LM.LEFT_ELBOW, cx - 0.12 - backswing * 0.06, shoulderY + 0.1);
  set(LM.RIGHT_ELBOW, cx + 0.1 + swing * 0.12, shoulderY + 0.08 - contact * 0.05);
  set(LM.LEFT_WRIST, cx - 0.14 - backswing * 0.08, shoulderY + 0.2);
  set(
    LM.RIGHT_WRIST,
    cx + 0.12 + swing * 0.18 + contact * 0.04,
    shoulderY + 0.14 - contact * 0.08
  );
  set(LM.LEFT_HIP, cx - 0.07, hipY);
  set(LM.RIGHT_HIP, cx + 0.07, hipY);
  set(LM.LEFT_KNEE, cx - 0.08, kneeY);
  set(LM.RIGHT_KNEE, cx + 0.08, kneeY - contact * 0.03);
  set(LM.LEFT_ANKLE, cx - 0.08, ankleY);
  set(LM.RIGHT_ANKLE, cx + 0.08, ankleY);

  return landmarks;
}

export function generateDemoSwingFrames(frameCount = 48): FrameLandmarks[] {
  const frames: FrameLandmarks[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = i / Math.max(1, frameCount - 1);
    frames.push({
      frameIndex: i,
      timestamp: (i / 15) * 1000,
      landmarks: basePose(t),
    });
  }
  return frames;
}
