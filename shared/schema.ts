/**
 * Zod schemas for the standard JSON contract between backend and frontend.
 *
 * These schemas validate the wire format of analysis payloads — the same
 * shapes stored in SQLite JSON columns and sent over tRPC.
 *
 * Rule: any code that serialises or deserialises analysis data must
 * reference these schemas instead of hand-rolling validators.
 */

import { z } from "zod";
import {
  QUALITY_BANDS,
  REFERENCE_SOURCE_TYPES,
  REFERENCE_TIERS,
  SHOT_TYPES,
} from "./types";
import { MAX_UPLOAD_BYTES, SAMPLE_FPS } from "./config";

// ── Landmark coordinate schema ──────────────────────────────────────────────

export const landmarkSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  visibility: z.number().min(0).max(1),
});

export const frameLandmarksSchema = z.object({
  frameIndex: z.number().int().min(0),
  timestamp: z.number().min(0),
  landmarks: z.array(landmarkSchema).min(1),
});

export const ballTrackSampleSchema = z.tuple([
  z.number().int().min(0),
  z.number().finite(),
  z.number().finite(),
  z.number().min(0).max(1),
]);

export const ballTrackingSchema = z.array(ballTrackSampleSchema);

/**
 * Racket-head tracking sample: `[frameIndex, playerId, imageX, imageY, confidence]`.
 *
 * `confidence < 0.5` marks samples that were *interpolated* via the
 * elbow→wrist extrapolation (no motion refinement); `confidence ≥ 0.5`
 * marks samples that were refined from per-frame motion cues. The
 * Python tracker emits one sample per visible player per processed
 * frame; missing frames are simply absent from the array.
 */
export const racketTrackSampleSchema = z.tuple([
  z.number().int().min(0),
  z.number().int().min(0),
  z.number().finite(),
  z.number().finite(),
  z.number().min(0).max(1),
]);

export const racketTrackingSchema = z.array(racketTrackSampleSchema);

// ── Mobile tracking sync (client queue → server debug artifact) ───────────────

export const trackingSyncPoseSchema = z.enum([
  "detected",
  "missing",
  "interpolated",
]);

/**
 * Lightweight frame-indexed tuple: `[frameIndex, imageX, imageY, poseState]`.
 *
 * The browser queue stores these tuples instead of full landmark arrays so
 * mobile devices can retry sync without retaining raw videos or large JSON.
 */
export const trackingSyncTupleSchema = z.tuple([
  z.number().int().min(0),
  z.number().finite(),
  z.number().finite(),
  trackingSyncPoseSchema,
]);

export const trackingSyncInputSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_.:-]+$/),
  source: z.enum(["client-pose", "mobile-upload-debug"]),
  sequence: z.number().int().min(0),
  tuples: z.array(trackingSyncTupleSchema).min(1).max(1_000),
  clientCreatedAt: z.string().datetime().optional(),
});

// ── Direct-to-bucket upload (presigned URL flow) ─────────────────────────────

export const initiateUploadInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128),
  contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export const presignedSingleUploadSchema = z.object({
  mode: z.literal("single"),
  storageKey: z.string().min(1),
  uploadUrl: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string()),
});

export const presignedMultipartUploadSchema = z.object({
  mode: z.literal("multipart"),
  storageKey: z.string().min(1),
  uploadId: z.string().min(1),
  partSize: z.number().int().positive(),
  parts: z.array(
    z.object({
      partNumber: z.number().int().positive(),
      uploadUrl: z.string().url(),
    })
  ).min(1),
});

export const localUploadFallbackSchema = z.object({
  mode: z.literal("local"),
  uploadUrl: z.literal("/api/upload"),
});

export const initiateUploadResponseSchema = z.discriminatedUnion("mode", [
  presignedSingleUploadSchema,
  presignedMultipartUploadSchema,
  localUploadFallbackSchema,
]);

export const completeUploadInputSchema = z.object({
  storageKey: z.string().min(1),
  contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES).optional(),
  uploadId: z.string().min(1).optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().positive(),
        etag: z.string().min(1),
      })
    )
    .optional(),
});

export const completeUploadResponseSchema = z.object({
  storageKey: z.string().min(1),
});

export const uploadCapabilitiesSchema = z.object({
  mode: z.enum(["cloud", "local"]),
});

// ── Phase metrics (angles + velocity) ───────────────────────────────────────

export const phaseMetricsSchema = z.object({
  shoulderRotation: z.number(),
  hipRotation: z.number(),
  elbowAngle: z.number(),
  kneeFlex: z.number(),
  spineAngle: z.number(),
  wristVelocity: z.number(),
});

export const swingPhaseTypeSchema = z.enum([
  "ready",
  "backswing",
  "forwardSwing",
  "contact",
  "followThrough",
]);

export const swingPhaseSchema = z.object({
  type: swingPhaseTypeSchema,
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  score: z.number().min(0).max(100),
  metrics: phaseMetricsSchema,
});

// ── Shot classification ─────────────────────────────────────────────────────

export const shotTypeSchema = z.enum(
  SHOT_TYPES as unknown as [string, ...string[]]
);

export const referenceTierSchema = z.enum(
  REFERENCE_TIERS as unknown as [string, ...string[]]
);

export const qualityBandSchema = z.enum(
  QUALITY_BANDS as unknown as [string, ...string[]]
);

export const referenceSourceTypeSchema = z.enum(
  REFERENCE_SOURCE_TYPES as unknown as [string, ...string[]]
);

// ── Full analysis result (the wire format) ──────────────────────────────────

export const analysisResultSchema = z.object({
  overallScore: z.number().min(0).max(100),
  dominantSide: z.enum(["left", "right"]),
  phases: z.array(swingPhaseSchema),
  frameLandmarks: z.array(frameLandmarksSchema),
  ballTracking: ballTrackingSchema.optional(),
  racketTracking: racketTrackingSchema.optional(),
  durationMs: z.number().min(0),
  frameCount: z.number().int().min(0),
  sampleFps: z.number().default(SAMPLE_FPS),
  shotType: shotTypeSchema.optional(),
  shotConfidence: z.number().min(0).max(1).optional(),
  skillLabel: qualityBandSchema.optional(),
  skillConfidence: z.number().min(0).max(1).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
});

export const recordModeSchema = z.enum([
  "match",
  "rally",
  "serve_practice",
  "drill",
]);

// ── Analysis list (metadata-only; no heavy JSON columns) ───────────────────

/** List view: metadata-only row (no heavy JSON columns). */
export const analysisListItemSchema = z.object({
  id: z.number().int().positive(),
  videoFileName: z.string(),
  videoStorageKey: z.string().nullable().optional(),
  thumbnailPath: z.string().nullable().optional(),
  createdAt: z.string(),
  overallScore: z.number(),
  dominantSide: z.enum(["left", "right"]),
  durationMs: z.number().int().min(0),
  frameCount: z.number().int().min(0),
  sampleFps: z.number(),
  shotType: z.string().nullable().optional(),
  shotConfidence: z.number().nullable().optional(),
  skillLabel: qualityBandSchema.nullable().optional(),
  skillConfidence: z.number().nullable().optional(),
  qualityScore: z.number().nullable().optional(),
  mode: recordModeSchema.optional(),
  /** Only present when `includePhasesJson` was requested on list. */
  phasesJson: z.string().optional(),
});

export const analysisListInputSchema = z.object({
  /** Last-seen analysis id from the previous page (exclusive). Rows are ordered by id descending. */
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  /** When true, each row includes `phasesJson` only (still no `landmarksJson`). Default false. */
  includePhasesJson: z.boolean().optional(),
});

export const analysisListResponseSchema = z.object({
  items: z.array(analysisListItemSchema),
  nextCursor: z.number().int().positive().nullable(),
  hasMore: z.boolean(),
});

// ── Mobile analysis jobs (server-side processing for native clients) ─────────

export const analysisJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const analysisJobStageIdSchema = z.enum([
  "ingestion",
  "courtCalibration",
  "playerTracking",
  "ballTrajectory",
  "aggregation",
]);

export const analysisJobStageStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const analysisJobStageProgressSchema = z.object({
  id: analysisJobStageIdSchema,
  label: z.string().min(1),
  status: analysisJobStageStatusSchema,
  progress: z.number().int().min(0).max(100),
  weight: z.number().int().min(1).max(100),
  message: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

const courtCornerNormalizedSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** Four corners: top-left, top-right, bottom-right, bottom-left (normalized 0–1). */
export const courtCornersInputSchema = z.object({
  corners: z.tuple([
    courtCornerNormalizedSchema,
    courtCornerNormalizedSchema,
    courtCornerNormalizedSchema,
    courtCornerNormalizedSchema,
  ]),
  previewWidth: z.number().int().positive().optional(),
  previewHeight: z.number().int().positive().optional(),
});

export const createMobileAnalysisJobInputSchema = z.object({
  videoFileName: z.string().min(1),
  videoStorageKey: z.string().min(1),
  courtCorners: courtCornersInputSchema.optional(),
  mode: recordModeSchema.optional().default("match"),
});

export const analysisJobSchema = z.object({
  id: z.number().int().positive(),
  videoFileName: z.string(),
  videoStorageKey: z.string(),
  status: analysisJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  statusMessage: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  analysisId: z.number().int().positive().nullable().optional(),
  courtCornersJson: z.string().nullable().optional(),
  mode: recordModeSchema.default("match"),
  stages: z.array(analysisJobStageProgressSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const analysisJobIdInputSchema = analysisJobSchema.pick({ id: true });

export const analysisJobGetInputSchema = analysisJobIdInputSchema.extend({
  includeTracking: z.boolean().optional().default(false),
});

/** Metadata for CV tracking arrays hydrated from on-disk agent artifacts. */
export const trackingMetaSchema = z.object({
  sourceJobId: z.number().int().positive().nullable(),
  ballSampleCount: z.number().int().min(0),
  racketSampleCount: z.number().int().min(0),
});

/**
 * Completed mobile job poll with ball/racket tracks merged from
 * `data/analysis-agents/job-{id}.json` when `analysisId` is set.
 */
export const analysisJobDetailSchema = analysisJobSchema.extend({
  ballTracking: ballTrackingSchema.default([]),
  racketTracking: racketTrackingSchema.default([]),
  trackingMeta: trackingMetaSchema,
});

// ── tRPC create-analysis input (what the client sends to the server) ────────

export const createAnalysisInputSchema = z.object({
  videoFileName: z.string().min(1),
  videoStorageKey: z.string().optional(),
  thumbnailPath: z.string().optional(),
  overallScore: z.number(),
  dominantSide: z.enum(["left", "right"]),
  durationMs: z.number(),
  frameCount: z.number(),
  sampleFps: z.number(),
  phasesJson: z.string().max(10_000_000).refine(
    (s) => {
      try {
        z.array(swingPhaseSchema).parse(JSON.parse(s));
        return true;
      } catch {
        return false;
      }
    },
    { message: "phasesJson must contain a valid SwingPhase[] array" }
  ),
  landmarksJson: z.string().max(10_000_000).refine(
    (s) => {
      try {
        z.array(frameLandmarksSchema).parse(JSON.parse(s));
        return true;
      } catch {
        return false;
      }
    },
    { message: "landmarksJson must contain a valid FrameLandmarks[] array" }
  ),
  shotType: z.string().optional(),
  shotConfidence: z.number().optional(),
  skillLabel: qualityBandSchema.optional(),
  skillConfidence: z.number().min(0).max(1).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
});

// ── Annotation inputs ────────────────────────────────────────────────────────

export const annotationCreateInputSchema = z.object({
  analysisId: z.number().int().positive(),
  shotType: shotTypeSchema,
  referenceTier: referenceTierSchema.default("none"),
  qualityBand: qualityBandSchema.optional(),
  sourceType: referenceSourceTypeSchema.optional(),
  sourceUrl: z.string().url().optional(),
  notes: z.string().max(2_000).optional(),
});

export const annotationUpdateInputSchema = z.object({
  id: z.number().int().positive(),
  shotType: shotTypeSchema.optional(),
  referenceTier: referenceTierSchema.optional(),
  qualityBand: qualityBandSchema.optional().nullable(),
  sourceType: referenceSourceTypeSchema.optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  notes: z.string().max(2_000).optional().nullable(),
});

// ── Reference benchmark inputs ──────────────────────────────────────────────

export const referenceBenchmarkInputSchema = z.object({
  shotType: shotTypeSchema,
  referenceTier: z.enum(["pro", "amateur_curated"]).default("pro"),
});

export const referenceAnalysisListInputSchema = z.object({
  referenceTier: z.enum(["pro", "amateur_curated"]).default("pro"),
});

// ── Training-data export envelope ───────────────────────────────────────────

export const trainingExportSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  /** Present when every sample uses the same FPS; omit when samples mix multiple values (use per-sample `sampleFps`). */
  sampleFps: z.number().optional(),
  samples: z.array(
    z.object({
      id: z.number(),
      videoFileName: z.string().optional(),
      shotType: shotTypeSchema,
      isProReference: z.boolean(),
      referenceTier: referenceTierSchema.default("none"),
      qualityBand: qualityBandSchema.optional(),
      sourceType: referenceSourceTypeSchema.optional(),
      sourceUrl: z.string().url().optional(),
      dominantSide: z.enum(["left", "right"]),
      overallScore: z.number().optional(),
      frameCount: z.number(),
      sampleFps: z.number().default(SAMPLE_FPS),
      landmarks: z.array(frameLandmarksSchema),
      phases: z.array(swingPhaseSchema),
    })
  ),
});

export const skillTrainingExportSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  sampleFps: z.number().optional(),
  samples: z.array(
    z.object({
      id: z.number(),
      videoFileName: z.string().optional(),
      shotType: shotTypeSchema,
      referenceTier: z.enum(["pro", "amateur_curated"]),
      qualityBand: qualityBandSchema,
      sourceType: referenceSourceTypeSchema.optional(),
      sourceUrl: z.string().url().optional(),
      dominantSide: z.enum(["left", "right"]),
      overallScore: z.number(),
      frameCount: z.number(),
      sampleFps: z.number().default(SAMPLE_FPS),
      landmarks: z.array(frameLandmarksSchema),
      phases: z.array(swingPhaseSchema),
    })
  ),
});

export const pairedTrainingExportSchema = z.object({
  version: z.string(),
  exportedAt: z.string().datetime(),
  sampleFps: z.number().optional(),
  pairs: z.array(
    z.object({
      id: z.number(),
      shotType: shotTypeSchema,
      referenceTier: z.enum(["pro", "amateur_curated"]),
      player: z.object({
        analysisId: z.number(),
        dominantSide: z.enum(["left", "right"]),
        frameCount: z.number(),
        sampleFps: z.number(),
        landmarks: z.array(frameLandmarksSchema),
        phases: z.array(swingPhaseSchema),
      }),
      reference: z
        .object({
          analysisId: z.number(),
          dominantSide: z.enum(["left", "right"]),
          frameCount: z.number(),
          sampleFps: z.number(),
          landmarks: z.array(frameLandmarksSchema),
          phases: z.array(swingPhaseSchema),
        })
        .nullable(),
      gapAnalysis: z.unknown(),
    })
  ),
  benchmarks: z.record(
    z.string(),
    z.record(
      z.enum(["pro", "amateur_curated"]),
      z.object({
        sampleCount: z.number(),
        phases: z.record(z.string(), z.record(z.string(), z.number())),
      })
    )
  ),
});

// ── Match CV pipeline (optional; used by server/lib/cvPipeline.ts) ───────────

export const cvStatusSchema = z.enum(["pending", "running", "done", "failed"]);

export const cvPipelineInputSchema = z.object({
  videoStorageKey: z.string().optional(),
  videoPath: z.string().optional(),
  skipExport: z.boolean().optional(),
});

export const cvPipelineResultSchema = z.object({
  trimmed_video_url: z.string().nullable().optional(),
  rallies: z.array(z.unknown()).optional(),
  summary: z.unknown().optional(),
  raw: z.unknown().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
});

// ── Rally window detection (audio + motion + velocity + shots fusion) ───────

/** Aggregated cue evidence for a single rally — keep loose so we can extend safely. */
export const rallySignalsSchema = z.record(z.string(), z.number());

export const rallyWindowSchema = z.object({
  id: z.number().int().min(0),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  durationMs: z.number().min(0),
  confidence: z.number().min(0).max(1),
  signals: rallySignalsSchema,
});

export const rallyDetectionCapabilitiesSchema = z.object({
  motion: z.boolean().default(false),
  velocity: z.boolean().default(false),
  audio: z.boolean().default(false),
  shots: z.boolean().default(false),
  shake: z.boolean().default(false),
});

export const rallyDetectionResultSchema = z.object({
  analysisId: z.number().int().positive().optional(),
  fps: z.number().min(0),
  frameCount: z.number().int().min(0),
  durationMs: z.number().min(0),
  totalActiveMs: z.number().min(0),
  totalDeadMs: z.number().min(0),
  audioAvailable: z.boolean(),
  capabilities: rallyDetectionCapabilitiesSchema,
  rallies: z.array(rallyWindowSchema),
  /** ISO timestamp of when this detection result was cached. */
  computedAt: z.string().optional(),
});

export const detectRalliesInputSchema = z.object({
  analysisId: z.number().int().positive(),
  /** Force a recompute even if a cached result exists. */
  force: z.boolean().optional(),
});

// ── TypeScript types derived from schemas ───────────────────────────────────

export type LandmarkPayload = z.infer<typeof landmarkSchema>;
export type FrameLandmarksPayload = z.infer<typeof frameLandmarksSchema>;
export type BallTrackSample = z.infer<typeof ballTrackSampleSchema>;
export type BallTrackingPayload = z.infer<typeof ballTrackingSchema>;
export type RacketTrackSample = z.infer<typeof racketTrackSampleSchema>;
export type RacketTrackingPayload = z.infer<typeof racketTrackingSchema>;
export type TrackingSyncPose = z.infer<typeof trackingSyncPoseSchema>;
export type TrackingSyncTuple = z.infer<typeof trackingSyncTupleSchema>;
export type TrackingSyncInput = z.infer<typeof trackingSyncInputSchema>;
export type InitiateUploadInput = z.infer<typeof initiateUploadInputSchema>;
export type InitiateUploadResponse = z.infer<typeof initiateUploadResponseSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadInputSchema>;
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;
export type UploadCapabilities = z.infer<typeof uploadCapabilitiesSchema>;
export type PhaseMetricsPayload = z.infer<typeof phaseMetricsSchema>;
export type SwingPhasePayload = z.infer<typeof swingPhaseSchema>;
export type AnalysisResultPayload = z.infer<typeof analysisResultSchema>;
export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>;
export type AnalysisListItem = z.infer<typeof analysisListItemSchema>;
export type AnalysisListInput = z.infer<typeof analysisListInputSchema>;
export type AnalysisListResponse = z.infer<typeof analysisListResponseSchema>;
export type CvStatus = z.infer<typeof cvStatusSchema>;
export type CvPipelineInput = z.infer<typeof cvPipelineInputSchema>;
export type CvPipelineResult = z.infer<typeof cvPipelineResultSchema>;
export type AnalysisJobStatus = z.infer<typeof analysisJobStatusSchema>;
export type AnalysisJobStageId = z.infer<typeof analysisJobStageIdSchema>;
export type AnalysisJobStageStatus = z.infer<typeof analysisJobStageStatusSchema>;
export type AnalysisJobStageProgress = z.infer<typeof analysisJobStageProgressSchema>;
export type AnalysisJobIdInput = z.infer<typeof analysisJobIdInputSchema>;
export type AnalysisJobGetInput = z.infer<typeof analysisJobGetInputSchema>;
export type CreateMobileAnalysisJobInput = z.infer<
  typeof createMobileAnalysisJobInputSchema
>;
export type AnalysisJobPayload = z.infer<typeof analysisJobSchema>;
export type TrackingMeta = z.infer<typeof trackingMetaSchema>;
export type AnalysisJobDetailPayload = z.infer<typeof analysisJobDetailSchema>;
export type AnnotationCreateInput = z.infer<typeof annotationCreateInputSchema>;
export type AnnotationUpdateInput = z.infer<typeof annotationUpdateInputSchema>;
export type RallySignals = z.infer<typeof rallySignalsSchema>;
export type RallyWindow = z.infer<typeof rallyWindowSchema>;
export type RallyDetectionCapabilities = z.infer<
  typeof rallyDetectionCapabilitiesSchema
>;
export type RallyDetectionResult = z.infer<typeof rallyDetectionResultSchema>;
export type DetectRalliesInput = z.infer<typeof detectRalliesInputSchema>;
export type TrainingExport = z.infer<typeof trainingExportSchema>;
export type SkillTrainingExport = z.infer<typeof skillTrainingExportSchema>;
export type PairedTrainingExport = z.infer<typeof pairedTrainingExportSchema>;
