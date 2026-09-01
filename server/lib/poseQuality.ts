import type { FrameLandmarks } from "../../shared/types.js";

const MIN_LANDMARK_VISIBILITY = 0.4;

/** Share of frames with enough visible landmarks for pose center. */
export function computePoseDetectionRate(frames: FrameLandmarks[]): number {
  if (!frames.length) return 0;
  let detected = 0;
  for (const frame of frames) {
    const visible = frame.landmarks.filter(
      (lm) => lm.visibility >= MIN_LANDMARK_VISIBILITY
    );
    if (visible.length > 0) detected += 1;
  }
  return detected / frames.length;
}

export function qualityWarningForPoseRate(
  rate: number
): "low_detection" | null {
  return rate < 0.5 ? "low_detection" : null;
}
