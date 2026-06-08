import { LOW_POSE_DETECTION_RATE } from "./config";

export type QualityWarning = "low_detection";

type IndexedFrame = { frameIndex: number };

/**
 * Pose detection rate from sampled frame landmarks.
 * Uses max frameIndex + 1 as the number of sampling attempts (matches server
 * and client pipelines that only append rows when pose is found).
 */
export function detectionRateFromFrameLandmarks(
  frameLandmarks: IndexedFrame[],
  totalSamples?: number
): number {
  if (totalSamples != null && totalSamples > 0) {
    return frameLandmarks.length / totalSamples;
  }
  if (frameLandmarks.length === 0) return 0;
  const maxIndex = frameLandmarks.reduce(
    (max, frame) => Math.max(max, frame.frameIndex),
    0
  );
  return frameLandmarks.length / (maxIndex + 1);
}

export function inferQualityWarning(
  frameLandmarks: IndexedFrame[],
  totalSamples?: number
): QualityWarning | undefined {
  return detectionRateFromFrameLandmarks(frameLandmarks, totalSamples) <
    LOW_POSE_DETECTION_RATE
    ? "low_detection"
    : undefined;
}
