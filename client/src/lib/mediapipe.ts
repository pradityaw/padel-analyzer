import {
  PoseLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { FrameLandmarks, Landmark } from "@shared/types";

let landmarker: PoseLandmarker | null = null;

async function initLandmarker(): Promise<PoseLandmarker> {
  if (landmarker) return landmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return landmarker;
}

function convertLandmarks(
  result: PoseLandmarkerResult
): Landmark[] | null {
  if (!result.landmarks || result.landmarks.length === 0) return null;

  return result.landmarks[0].map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));
}

export async function processVideo(
  videoFile: File,
  onProgress: (percent: number, currentFrame?: FrameLandmarks) => void
): Promise<FrameLandmarks[]> {
  const pose = await initLandmarker();

  const videoUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const duration = video.duration;
  const sampleFps = 15;
  const interval = 1 / sampleFps;
  const totalFrames = Math.floor(duration * sampleFps);
  const frames: FrameLandmarks[] = [];

  // Use requestVideoFrameCallback if available, otherwise seek-based approach
  for (let i = 0; i < totalFrames; i++) {
    const targetTime = i * interval;
    video.currentTime = targetTime;

    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    const timestampMs = targetTime * 1000;
    const result = pose.detectForVideo(video, timestampMs);
    const landmarks = convertLandmarks(result);

    if (landmarks) {
      const frame: FrameLandmarks = {
        frameIndex: i,
        timestamp: timestampMs,
        landmarks,
      };
      frames.push(frame);
      onProgress(Math.round(((i + 1) / totalFrames) * 100), frame);
    } else {
      onProgress(Math.round(((i + 1) / totalFrames) * 100));
    }
  }

  URL.revokeObjectURL(videoUrl);
  return frames;
}
