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
import { SAMPLE_FPS } from "./config";

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
  durationMs: z.number().min(0),
  frameCount: z.number().int().min(0),
  sampleFps: z.number().default(SAMPLE_FPS),
  shotType: shotTypeSchema.optional(),
  shotConfidence: z.number().min(0).max(1).optional(),
  skillLabel: qualityBandSchema.optional(),
  skillConfidence: z.number().min(0).max(1).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
});

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

// ── Mobile analysis jobs (server-side processing for native clients) ─────────

export const analysisJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const createMobileAnalysisJobInputSchema = z.object({
  videoFileName: z.string().min(1),
  videoStorageKey: z.string().min(1),
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
  createdAt: z.string(),
  updatedAt: z.string(),
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

// ── TypeScript types derived from schemas ───────────────────────────────────

export type LandmarkPayload = z.infer<typeof landmarkSchema>;
export type FrameLandmarksPayload = z.infer<typeof frameLandmarksSchema>;
export type PhaseMetricsPayload = z.infer<typeof phaseMetricsSchema>;
export type SwingPhasePayload = z.infer<typeof swingPhaseSchema>;
export type AnalysisResultPayload = z.infer<typeof analysisResultSchema>;
export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>;
export type AnalysisListItem = z.infer<typeof analysisListItemSchema>;
export type AnalysisListInput = z.infer<typeof analysisListInputSchema>;
export type AnalysisJobStatus = z.infer<typeof analysisJobStatusSchema>;
export type CreateMobileAnalysisJobInput = z.infer<
  typeof createMobileAnalysisJobInputSchema
>;
export type AnalysisJobPayload = z.infer<typeof analysisJobSchema>;
export type AnnotationCreateInput = z.infer<typeof annotationCreateInputSchema>;
export type AnnotationUpdateInput = z.infer<typeof annotationUpdateInputSchema>;
export type TrainingExport = z.infer<typeof trainingExportSchema>;
export type SkillTrainingExport = z.infer<typeof skillTrainingExportSchema>;
export type PairedTrainingExport = z.infer<typeof pairedTrainingExportSchema>;
