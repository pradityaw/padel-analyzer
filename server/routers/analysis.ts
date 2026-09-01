import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, rateLimit } from "../_core/trpc.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import {
  analysisListInputSchema,
  analysisListItemSchema,
  analysisListResponseSchema,
  createAnalysisInputSchema,
  detectRalliesInputSchema,
  rallyDetectionResultSchema,
  trackingMetaSchema,
} from "../../shared/schema.js";
import {
  RallyDetectionError,
  detectRalliesForAnalysis,
  getCachedRallies,
} from "../lib/rallyDetection.js";
import { resolveCompletedJobIdForAnalysis } from "../lib/analysisJobLookup.js";
import { readAnalysisBallTracking } from "../lib/ballTracking.js";
import { readAnalysisRacketTracking } from "../lib/racketTracking.js";
import { resolveVideoPlaybackUrl } from "../lib/videoAccess.js";
import {
  sanitizeBallTrackingPayload,
  sanitizeRacketTrackingPayload,
} from "../lib/trackingPayload.js";
import { resolveLandmarksJson } from "../lib/landmarksStorage.js";
import { deleteAnalysisArtifacts } from "../lib/analysisCleanup.js";
import { ownerIdForInsert, requireOwner } from "../lib/ownership.js";
import { isBallTrackingEnabled } from "../../shared/config.js";

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
  mode: analyses.mode,
} as const;

export const analysisRouter = router({
  create: protectedProcedure
    .use(
      rateLimit({
        capacity: Number(process.env.RATE_LIMIT_ANALYSIS_CAPACITY ?? 5),
        refillPerSecond: Number(
          process.env.RATE_LIMIT_ANALYSIS_REFILL_PER_SEC ?? 0.1,
        ),
        id: "analysis.create",
      }),
    )
    .input(createAnalysisInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ownerIdForInsert(ctx.authMode, ctx.user?.id);
      const result = db
        .insert(analyses)
        .values({ ...input, userId })
        .returning()
        .get();
      return result;
    }),

  getById: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        includeLandmarks: z.boolean().optional().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.id))
        .get();
      if (!result) return null;
      requireOwner(ctx.authMode, ctx.user?.id, result.userId);

      const landmarksJson = input.includeLandmarks
        ? resolveLandmarksJson(result)
        : "[]";

      const sourceJobId = resolveCompletedJobIdForAnalysis(input.id);
      const trackingEnabled = isBallTrackingEnabled();
      const [ballRaw, racketRaw] = trackingEnabled
        ? await Promise.all([
            readAnalysisBallTracking(sourceJobId, landmarksJson),
            readAnalysisRacketTracking(sourceJobId, landmarksJson),
          ])
        : [[], []];

      const trackingMeta = trackingMetaSchema.parse({
        sourceJobId,
        ballSampleCount: ballRaw.length,
        racketSampleCount: racketRaw.length,
      });

      const playbackKey =
        result.videoStorageKey ??
        (result.videoFileName.startsWith("yt_") ? result.videoFileName : null);
      const videoPlaybackUrl = playbackKey
        ? await resolveVideoPlaybackUrl(playbackKey)
        : null;

      return {
        ...result,
        landmarksJson,
        ballTracking: input.includeLandmarks
          ? sanitizeBallTrackingPayload(ballRaw)
          : [],
        racketTracking: input.includeLandmarks
          ? sanitizeRacketTrackingPayload(racketRaw)
          : [],
        trackingMeta,
        videoPlaybackUrl,
      };
    }),

  list: protectedProcedure
    .input(analysisListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const cursor = input?.cursor;
      const includePhasesJson = input?.includePhasesJson ?? false;

      const selectShape = includePhasesJson
        ? { ...listSelectBase, phasesJson: analyses.phasesJson }
        : listSelectBase;

      const ownerFilter =
        ctx.authMode === "on" && ctx.user
          ? eq(analyses.userId, ctx.user.id)
          : undefined;
      const cursorFilter = cursor != null ? lt(analyses.id, cursor) : undefined;
      const whereClause =
        ownerFilter && cursorFilter
          ? and(ownerFilter, cursorFilter)
          : ownerFilter ?? cursorFilter;

      const base = db.select(selectShape).from(analyses);
      const rows = (whereClause != null ? base.where(whereClause) : base)
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

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.id))
        .get();
      if (!row) return { success: true };
      requireOwner(ctx.authMode, ctx.user?.id, row.userId);
      deleteAnalysisArtifacts(input.id);
      return { success: true };
    }),

  /**
   * Lazily compute (or read the cached) rally windows for an analysis.
   *
   * The detection algorithm runs in a Python subprocess and the JSON payload
   * is cached under `data/rallies/<id>.json`. First call may take several
   * seconds (audio extraction + frame scan); subsequent calls are instant.
   */
  getRallies: protectedProcedure
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
  getCachedRallies: protectedProcedure
    .input(z.object({ analysisId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const cached = await getCachedRallies(input.analysisId);
      return cached ?? null;
    }),
});
