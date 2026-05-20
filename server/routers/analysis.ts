import { z } from "zod";
import { desc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import {
  analysisListInputSchema,
  analysisListItemSchema,
  analysisListResponseSchema,
  createAnalysisInputSchema,
  detectRalliesInputSchema,
  rallyDetectionResultSchema,
} from "../../shared/schema.js";
import {
  RallyDetectionError,
  detectRalliesForAnalysis,
  getCachedRallies,
} from "../lib/rallyDetection.js";
import { resolveCompletedJobIdForAnalysis } from "../lib/analysisJobLookup.js";
import { readAnalysisBallTracking } from "../lib/ballTracking.js";
import { readAnalysisRacketTracking } from "../lib/racketTracking.js";
import {
  sanitizeBallTrackingPayload,
  sanitizeRacketTrackingPayload,
} from "../lib/trackingPayload.js";

const listSelectBase = {
  id: analyses.id,
  videoFileName: analyses.videoFileName,
  videoStorageKey: analyses.videoStorageKey,
  thumbnailPath: analyses.thumbnailPath,
  createdAt: analyses.createdAt,
  overallScore: analyses.overallScore,
  dominantSide: analyses.dominantSide,
  durationMs: analyses.durationMs,
  frameCount: analyses.frameCount,
  sampleFps: analyses.sampleFps,
  shotType: analyses.shotType,
  shotConfidence: analyses.shotConfidence,
  skillLabel: analyses.skillLabel,
  skillConfidence: analyses.skillConfidence,
  qualityScore: analyses.qualityScore,
} as const;

export const analysisRouter = router({
  create: publicProcedure
    .input(createAnalysisInputSchema)
    .mutation(async ({ input }) => {
      const result = db.insert(analyses).values(input).returning().get();
      return result;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const result = db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.id))
        .get();
      if (!result) return null;

      const sourceJobId = resolveCompletedJobIdForAnalysis(input.id);
      const [ballRaw, racketRaw] = await Promise.all([
        readAnalysisBallTracking(sourceJobId, result.landmarksJson),
        readAnalysisRacketTracking(sourceJobId, result.landmarksJson),
      ]);

      return {
        ...result,
        ballTracking: sanitizeBallTrackingPayload(ballRaw),
        racketTracking: sanitizeRacketTrackingPayload(racketRaw),
        trackingMeta: {
          sourceJobId,
          ballSampleCount: ballRaw.length,
          racketSampleCount: racketRaw.length,
        },
      };
    }),

  list: publicProcedure
    .input(analysisListInputSchema.optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const cursor = input?.cursor;
      const includePhasesJson = input?.includePhasesJson ?? false;

      const selectShape = includePhasesJson
        ? { ...listSelectBase, phasesJson: analyses.phasesJson }
        : listSelectBase;

      const base = db.select(selectShape).from(analyses);
      const rows = (cursor != null
        ? base.where(lt(analyses.id, cursor))
        : base
      )
        .orderBy(desc(analyses.id))
        .limit(limit + 1)
        .all();
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const items = page.map((row) => analysisListItemSchema.parse(row));
      const nextCursor =
        hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

      return analysisListResponseSchema.parse({
        items,
        nextCursor,
        hasMore,
      });
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      db.delete(analyses).where(eq(analyses.id, input.id)).run();
      return { success: true };
    }),

  /**
   * Lazily compute (or read the cached) rally windows for an analysis.
   *
   * The detection algorithm runs in a Python subprocess and the JSON payload
   * is cached under `data/rallies/<id>.json`. First call may take several
   * seconds (audio extraction + frame scan); subsequent calls are instant.
   */
  getRallies: publicProcedure
    .input(detectRalliesInputSchema)
    .query(async ({ input }) => {
      try {
        const result = await detectRalliesForAnalysis(input.analysisId, {
          force: input.force ?? false,
        });
        return rallyDetectionResultSchema.parse(result);
      } catch (err) {
        if (err instanceof RallyDetectionError) {
          const code =
            err.code === "ANALYSIS_NOT_FOUND"
              ? "NOT_FOUND"
              : err.code === "VIDEO_NOT_FOUND"
                ? "NOT_FOUND"
                : err.code === "TIMEOUT"
                  ? "TIMEOUT"
                  : "INTERNAL_SERVER_ERROR";
          throw new TRPCError({ code, message: err.message });
        }
        throw err;
      }
    }),

  /** Read-only fast path: return cached rallies or null without spawning Python. */
  getCachedRallies: publicProcedure
    .input(z.object({ analysisId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const cached = await getCachedRallies(input.analysisId);
      return cached ?? null;
    }),
});
