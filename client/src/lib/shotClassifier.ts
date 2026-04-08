/**
 * Client-side shot type classifier using ONNX Runtime Web.
 *
 * Preprocessing MUST match training/dataset.py exactly:
 * 1. Center landmarks on hip midpoint
 * 2. Scale by torso length
 * 3. Mirror left-dominant to right
 * 4. Compute velocity features
 * 5. Pad/truncate to 64 frames centered on contact
 */

import type { FrameLandmarks, Landmark, ShotType } from "@shared/types";
import { SHOT_TYPES } from "@shared/types";

const MAX_FRAMES = 64;
const NUM_LANDMARKS = 33;
const LANDMARK_DIMS = 4;
const FEATURES_PER_FRAME = NUM_LANDMARKS * LANDMARK_DIMS; // 132
const TOTAL_FEATURES = FEATURES_PER_FRAME * 2; // 264

let sessionPromise: Promise<any> | null = null;

async function getSession() {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const ort = await import("onnxruntime-web");
    // Use wasm backend (works everywhere)
    ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
    const session = await ort.InferenceSession.create("/models/shot_classifier.onnx");
    return { ort, session };
  })();

  return sessionPromise;
}

function distance(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function normalizeLandmarks(
  frames: FrameLandmarks[]
): { x: number; y: number; z: number; visibility: number }[][] {
  return frames.map((frame) => {
    const lms = frame.landmarks;
    // Hip midpoint
    const hipMidX = (lms[23].x + lms[24].x) / 2;
    const hipMidY = (lms[23].y + lms[24].y) / 2;
    const hipMidZ = (lms[23].z + lms[24].z) / 2;

    // Center on hip midpoint
    const centered = lms.map((lm) => ({
      x: lm.x - hipMidX,
      y: lm.y - hipMidY,
      z: lm.z - hipMidZ,
      visibility: lm.visibility,
    }));

    // Torso length: shoulder midpoint to hip midpoint (hip is now origin)
    const shoulderMidX = (centered[11].x + centered[12].x) / 2;
    const shoulderMidY = (centered[11].y + centered[12].y) / 2;
    const shoulderMidZ = (centered[11].z + centered[12].z) / 2;
    const torsoLen = Math.sqrt(
      shoulderMidX ** 2 + shoulderMidY ** 2 + shoulderMidZ ** 2
    );

    if (torsoLen > 1e-6) {
      for (const lm of centered) {
        lm.x /= torsoLen;
        lm.y /= torsoLen;
        lm.z /= torsoLen;
      }
    }

    return centered;
  });
}

function mirrorIfLeft(
  frames: { x: number; y: number; z: number; visibility: number }[][],
  dominantSide: "left" | "right"
): typeof frames {
  if (dominantSide === "left") {
    return frames.map((lms) =>
      lms.map((lm) => ({ ...lm, x: -lm.x }))
    );
  }
  return frames;
}

function computeVelocities(
  frames: { x: number; y: number; z: number; visibility: number }[][]
): Float32Array {
  const numFrames = frames.length;
  const result = new Float32Array(numFrames * TOTAL_FEATURES);

  for (let i = 0; i < numFrames; i++) {
    const lms = frames[i];
    const offset = i * TOTAL_FEATURES;

    // Position features (first 132)
    for (let j = 0; j < NUM_LANDMARKS; j++) {
      const lm = lms[j];
      result[offset + j * 4] = lm.x;
      result[offset + j * 4 + 1] = lm.y;
      result[offset + j * 4 + 2] = lm.z;
      result[offset + j * 4 + 3] = lm.visibility;
    }

    // Velocity features (next 132)
    if (i > 0) {
      const prevLms = frames[i - 1];
      for (let j = 0; j < NUM_LANDMARKS; j++) {
        result[offset + FEATURES_PER_FRAME + j * 4] = lms[j].x - prevLms[j].x;
        result[offset + FEATURES_PER_FRAME + j * 4 + 1] = lms[j].y - prevLms[j].y;
        result[offset + FEATURES_PER_FRAME + j * 4 + 2] = lms[j].z - prevLms[j].z;
        result[offset + FEATURES_PER_FRAME + j * 4 + 3] =
          lms[j].visibility - prevLms[j].visibility;
      }
    }
    // Frame 0 velocities are already 0 (Float32Array default)
  }

  return result;
}

function findContactFrame(frames: FrameLandmarks[]): number {
  if (frames.length < 3) return Math.floor(frames.length / 2);

  let peakVel = 0;
  let peakIdx = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].landmarks[16]; // right wrist
    const curr = frames[i].landmarks[16];
    const vel = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
    if (vel > peakVel) {
      peakVel = vel;
      peakIdx = i;
    }
  }

  return peakIdx;
}

function padOrTruncate(
  features: Float32Array,
  numFrames: number,
  contactFrame: number
): { padded: Float32Array; mask: Float32Array } {
  const padded = new Float32Array(MAX_FRAMES * TOTAL_FEATURES);
  const mask = new Float32Array(MAX_FRAMES);

  if (numFrames <= MAX_FRAMES) {
    const offset = Math.floor((MAX_FRAMES - numFrames) / 2);
    padded.set(features, offset * TOTAL_FEATURES);
    mask.fill(1, offset, offset + numFrames);
  } else {
    const half = Math.floor(MAX_FRAMES / 2);
    let start = Math.max(0, contactFrame - half);
    start = Math.min(start, numFrames - MAX_FRAMES);
    padded.set(
      features.subarray(start * TOTAL_FEATURES, (start + MAX_FRAMES) * TOTAL_FEATURES)
    );
    mask.fill(1);
  }

  return { padded, mask };
}

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum) as Float32Array;
}

export type ClassificationResult = {
  shotType: ShotType;
  confidence: number;
  allProbabilities: Record<ShotType, number>;
};

/**
 * Classify the shot type from landmark frames.
 * Returns null if the model is not available yet.
 */
export async function classifyShotType(
  frames: FrameLandmarks[],
  dominantSide: "left" | "right"
): Promise<ClassificationResult | null> {
  try {
    const { ort, session } = await getSession();

    // Preprocess (matching Python pipeline exactly)
    const normalized = normalizeLandmarks(frames);
    const mirrored = mirrorIfLeft(normalized, dominantSide);
    const features = computeVelocities(mirrored);
    const contactFrame = findContactFrame(frames);
    const { padded, mask } = padOrTruncate(features, frames.length, contactFrame);

    // Create tensors: (1, MAX_FRAMES, TOTAL_FEATURES) and (1, MAX_FRAMES)
    const featuresTensor = new ort.Tensor("float32", padded, [1, MAX_FRAMES, TOTAL_FEATURES]);
    const maskTensor = new ort.Tensor("float32", mask, [1, MAX_FRAMES]);

    // Run inference
    const results = await session.run({
      features: featuresTensor,
      mask: maskTensor,
    });

    const logits = results.logits.data as Float32Array;
    const probs = softmax(logits);

    // Find best class
    let bestIdx = 0;
    let bestProb = probs[0];
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > bestProb) {
        bestProb = probs[i];
        bestIdx = i;
      }
    }

    const allProbabilities = {} as Record<ShotType, number>;
    for (let i = 0; i < SHOT_TYPES.length; i++) {
      allProbabilities[SHOT_TYPES[i]] = Math.round(probs[i] * 1000) / 1000;
    }

    return {
      shotType: SHOT_TYPES[bestIdx],
      confidence: Math.round(bestProb * 1000) / 1000,
      allProbabilities,
    };
  } catch (err) {
    console.warn("Shot classification unavailable:", err);
    return null;
  }
}

/**
 * Check if the ONNX model is available.
 */
export async function isModelAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/models/shot_classifier.onnx", {
      method: "HEAD",
    });
    return response.ok;
  } catch {
    return false;
  }
}
