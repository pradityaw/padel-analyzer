import type { BallTrackSample, RacketTrackSample } from "../../shared/schema.js";
import {
  ballTrackSampleSchema,
  racketTrackSampleSchema,
} from "../../shared/schema.js";

/**
 * Sanitize tracking arrays before API response. Invalid tuples are dropped;
 * returns [] when input is not an array so clients never see NaN coordinates.
 */
export function sanitizeBallTrackingPayload(
  samples: BallTrackSample[]
): BallTrackSample[] {
  if (!Array.isArray(samples)) return [];
  const out: BallTrackSample[] = [];
  for (const sample of samples) {
    const parsed = ballTrackSampleSchema.safeParse(sample);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function sanitizeRacketTrackingPayload(
  samples: RacketTrackSample[]
): RacketTrackSample[] {
  if (!Array.isArray(samples)) return [];
  const out: RacketTrackSample[] = [];
  for (const sample of samples) {
    const parsed = racketTrackSampleSchema.safeParse(sample);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
