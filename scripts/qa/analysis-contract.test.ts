/**
 * Lightweight contract checks for unified upload MVP schemas.
 * Run: npm run test:contracts
 */
import {
  analysisListResponseSchema,
  analysisListItemSchema,
  analysisJobSchema,
  analysisJobStageProgressSchema,
  ballTrackSampleSchema,
  ballTrackingSchema,
  createMobileAnalysisJobInputSchema,
  racketTrackSampleSchema,
  racketTrackingSchema,
} from "../../shared/schema.js";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

assert("analysisListResponseSchema accepts paginated shape", () => {
  const payload = analysisListResponseSchema.parse({
    items: [
      analysisListItemSchema.parse({
        id: 1,
        videoFileName: "test.mp4",
        createdAt: new Date().toISOString(),
        overallScore: 70,
        dominantSide: "right",
        durationMs: 1000,
        frameCount: 30,
        sampleFps: 15,
      }),
    ],
    nextCursor: null,
    hasMore: false,
  });
  if (payload.items.length !== 1) throw new Error("expected one item");
});

assert("analysisJobSchema accepts job status", () => {
  analysisJobSchema.parse({
    id: 1,
    videoFileName: "swing.mp4",
    videoStorageKey: "upload_1.mp4",
    status: "queued",
    progress: 0,
    statusMessage: "Queued",
    errorMessage: null,
    analysisId: null,
    stages: [
      analysisJobStageProgressSchema.parse({
        id: "courtCalibration",
        label: "Agent A: court calibration",
        status: "running",
        progress: 25,
        weight: 20,
        message: "Calibrating court boundaries.",
        startedAt: new Date().toISOString(),
        completedAt: null,
        errorMessage: null,
      }),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

assert("createMobileAnalysisJobInputSchema requires storage key", () => {
  const ok = createMobileAnalysisJobInputSchema.safeParse({
    videoFileName: "a.mp4",
    videoStorageKey: "upload_x.mp4",
  });
  if (!ok.success) throw new Error("expected valid input");
  const bad = createMobileAnalysisJobInputSchema.safeParse({
    videoFileName: "a.mp4",
    videoStorageKey: "",
  });
  if (bad.success) throw new Error("expected empty key to fail");
});

assert("ballTrackingSchema accepts frame-indexed tuples", () => {
  const sample = ballTrackSampleSchema.parse([12, 320.5, 144.25, 0.82]);
  if (sample[0] !== 12) throw new Error("expected frame index to round-trip");
  const payload = ballTrackingSchema.parse([sample]);
  if (payload.length !== 1) throw new Error("expected one ball sample");
});

assert("racketTrackingSchema accepts frame+player tuples and rejects bad shapes", () => {
  const refined = racketTrackSampleSchema.parse([
    18,
    1,
    412.5,
    188.75,
    0.72,
  ]);
  if (refined[0] !== 18) throw new Error("expected frame index to round-trip");
  if (refined[1] !== 1) throw new Error("expected player id to round-trip");
  if (!(refined[4] >= 0.5)) {
    throw new Error("refined sample must report confidence >= 0.5 in this fixture");
  }

  const interpolated = racketTrackSampleSchema.parse([
    19,
    1,
    420.0,
    190.0,
    0.4,
  ]);
  if (!(interpolated[4] < 0.5)) {
    throw new Error("interpolated band must report confidence < 0.5");
  }

  const payload = racketTrackingSchema.parse([refined, interpolated]);
  if (payload.length !== 2) {
    throw new Error("expected two racket samples in the payload");
  }

  const badConfidence = racketTrackSampleSchema.safeParse([
    20,
    1,
    420.0,
    190.0,
    1.4,
  ]);
  if (badConfidence.success) {
    throw new Error("confidence above 1.0 must be rejected");
  }

  const badPlayer = racketTrackSampleSchema.safeParse([
    21,
    -1,
    420.0,
    190.0,
    0.5,
  ]);
  if (badPlayer.success) {
    throw new Error("negative player id must be rejected");
  }
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All contract checks passed.");
