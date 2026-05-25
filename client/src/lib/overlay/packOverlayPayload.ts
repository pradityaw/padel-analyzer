import type { FrameLandmarks } from "@shared/types";
import type { PackedOverlayPayload } from "@shared/overlayTypes";

const DEFAULT_LANDMARK_COUNT = 33;

/**
 * Pack frame landmarks into typed arrays suitable for structured-clone /
 * transferable postMessage to the overlay worker.
 */
export function packOverlayPayload(
  frames: FrameLandmarks[],
  ballPositions?: Float32Array
): PackedOverlayPayload {
  const frameCount = frames.length;
  const landmarkCount =
    frameCount > 0
      ? Math.max(...frames.map((f) => f.landmarks.length))
      : DEFAULT_LANDMARK_COUNT;

  const positions = new Float32Array(frameCount * landmarkCount * 3);
  const frameIndices = new Int32Array(frameCount);
  const timestampsMs = new Float32Array(frameCount);

  for (let fi = 0; fi < frameCount; fi++) {
    const frame = frames[fi]!;
    frameIndices[fi] = frame.frameIndex;
    timestampsMs[fi] = frame.timestamp;

    for (let li = 0; li < landmarkCount; li++) {
      const lm = frame.landmarks[li];
      const offset = fi * landmarkCount * 3 + li * 3;
      if (lm) {
        positions[offset] = lm.x;
        positions[offset + 1] = lm.y;
        positions[offset + 2] = lm.visibility;
      } else {
        positions[offset] = 0;
        positions[offset + 1] = 0;
        positions[offset + 2] = 0;
      }
    }
  }

  const payload: PackedOverlayPayload = {
    frameCount,
    landmarkCount,
    positions,
    frameIndices,
    timestampsMs,
  };

  if (ballPositions && ballPositions.length >= frameCount * 2) {
    payload.ballPositions = ballPositions;
  }

  return payload;
}

/** Collect transferable ArrayBuffers from a packed payload for postMessage. */
export function getOverlayPayloadTransferables(
  payload: PackedOverlayPayload
): Transferable[] {
  const buffers: Transferable[] = [payload.positions.buffer];
  if (payload.ballPositions) {
    buffers.push(payload.ballPositions.buffer);
  }
  buffers.push(payload.frameIndices.buffer, payload.timestampsMs.buffer);
  return buffers;
}
