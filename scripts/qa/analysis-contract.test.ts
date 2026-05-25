/**
 * Lightweight contract checks for unified upload MVP schemas.
 * Run: npm run test:contracts
 */
import {
  analysisListResponseSchema,
  analysisListItemSchema,
  analysisJobDetailSchema,
  analysisJobGetInputSchema,
  analysisJobIdInputSchema,
  analysisJobSchema,
  analysisJobStageProgressSchema,
  ballTrackSampleSchema,
  ballTrackingSchema,
  completeUploadInputSchema,
  createMobileAnalysisJobInputSchema,
  initiateUploadInputSchema,
  initiateUploadResponseSchema,
  presignedSingleUploadSchema,
  racketTrackSampleSchema,
  racketTrackingSchema,
  trackingMetaSchema,
  uploadCapabilitiesSchema,
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

assert("analysisJob poll/detail inputs validate", () => {
  const pollInput = analysisJobIdInputSchema.parse({ id: 1 });
  if (pollInput.id !== 1) throw new Error("expected job id to round-trip");

  const defaultDetail = analysisJobGetInputSchema.parse({ id: 2 });
  if (defaultDetail.includeTracking !== false) {
    throw new Error("includeTracking should default to false");
  }

  const trackingDetail = analysisJobGetInputSchema.parse({
    id: 3,
    includeTracking: true,
  });
  if (!trackingDetail.includeTracking) {
    throw new Error("includeTracking true should round-trip");
  }
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

assert("initiateUploadResponseSchema accepts cloud single PUT plan", () => {
  initiateUploadResponseSchema.parse({
    mode: "single",
    storageKey: "uploads/abc123.mp4",
    uploadUrl: "https://bucket.example/upload",
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": "1024",
    },
  });
  uploadCapabilitiesSchema.parse({ mode: "cloud" });
  initiateUploadInputSchema.parse({
    fileName: "swing.mp4",
    contentType: "video/mp4",
    contentLength: 1024,
  });
  completeUploadInputSchema.parse({
    storageKey: "uploads/abc123.mp4",
    contentLength: 1024,
  });
  presignedSingleUploadSchema.parse({
    mode: "single",
    storageKey: "uploads/abc123.mp4",
    uploadUrl: "https://bucket.example/upload",
    method: "PUT",
    headers: {},
  });
  initiateUploadResponseSchema.parse({
    mode: "local",
    uploadUrl: "/api/upload",
  });
});

assert("ballTrackingSchema accepts frame-indexed tuples", () => {
  const sample = ballTrackSampleSchema.parse([12, 320.5, 144.25, 0.82]);
  if (sample[0] !== 12) throw new Error("expected frame index to round-trip");
  const payload = ballTrackingSchema.parse([sample]);
  if (payload.length !== 1) throw new Error("expected one ball sample");
});

assert("analysisJobDetailSchema accepts hydrated ball tracking", () => {
  const meta = trackingMetaSchema.parse({
    sourceJobId: 7,
    ballSampleCount: 2,
    racketSampleCount: 0,
  });
  const detail = analysisJobDetailSchema.parse({
    id: 7,
    videoFileName: "swing.mp4",
    videoStorageKey: "upload_7.mp4",
    status: "completed",
    progress: 100,
    statusMessage: "Done",
    errorMessage: null,
    analysisId: 42,
    stages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ballTracking: [
      [0, 100, 200, 0.9],
      [1, 110, 210, 0.85],
    ],
    racketTracking: [],
    trackingMeta: meta,
  });
  if (detail.ballTracking.length !== 2) {
    throw new Error("expected two ball samples on hydrated job");
  }
});

assert("analysisJobDetailSchema rejects invalid ball confidence", () => {
  const bad = analysisJobDetailSchema.safeParse({
    id: 8,
    videoFileName: "swing.mp4",
    videoStorageKey: "upload_8.mp4",
    status: "completed",
    progress: 100,
    analysisId: 43,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ballTracking: [[0, 100, 200, 1.5]],
    racketTracking: [],
    trackingMeta: {
      sourceJobId: 8,
      ballSampleCount: 1,
      racketSampleCount: 0,
    },
  });
  if (bad.success) {
    throw new Error("confidence above 1.0 must be rejected on job detail");
  }
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
