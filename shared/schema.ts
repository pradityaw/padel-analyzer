import { z } from "zod";

export const processingStateSchema = z.enum([
  "pending",
  "processing",
  "complete",
  "failed",
]);

export type ProcessingState = z.infer<typeof processingStateSchema>;

export const createAnalysisInputSchema = z.object({
  videoFileName: z.string(),
  videoStorageKey: z.string().optional(),
  thumbnailPath: z.string().optional(),
  overallScore: z.number(),
  dominantSide: z.enum(["left", "right"]),
  durationMs: z.number(),
  frameCount: z.number(),
  sampleFps: z.number(),
  phasesJson: z.string(),
  landmarksJson: z.string(),
  shotType: z.string().optional(),
  shotConfidence: z.number().optional(),
  processingState: processingStateSchema.optional().default("complete"),
  qualityWarnings: z.string().optional(),
});

export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>;

export const updateAnalysisResultsSchema = z.object({
  id: z.number(),
  videoStorageKey: z.string().optional(),
  overallScore: z.number(),
  dominantSide: z.enum(["left", "right"]),
  durationMs: z.number(),
  frameCount: z.number(),
  sampleFps: z.number(),
  phasesJson: z.string(),
  landmarksJson: z.string(),
  shotType: z.string().optional(),
  shotConfidence: z.number().optional(),
  processingState: processingStateSchema.default("complete"),
  qualityWarnings: z.string().optional(),
});

export const updateAnalysisStateSchema = z.object({
  id: z.number(),
  processingState: processingStateSchema,
  qualityWarnings: z.string().optional(),
});
