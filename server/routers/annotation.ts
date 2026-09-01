import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { annotations, analyses } from "../../drizzle/schema.js";
import { eq, desc, sql, and } from "drizzle-orm";
import { SHOT_TYPES } from "../../shared/types.js";
import { ownerIdForInsert, requireOwnedAnalysis, requireOwner } from "../lib/ownership.js";

const shotTypeEnum = z.enum(SHOT_TYPES as unknown as [string, ...string[]]);

function requireOwnedAnnotation(
  authMode: Parameters<typeof requireOwner>[0],
  userId: number | null | undefined,
  annotationId: number,
) {
  const row = db
    .select()
    .from(annotations)
    .where(eq(annotations.id, annotationId))
    .get();
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Annotation not found." });
  }
  if (row.userId != null) {
    requireOwner(authMode, userId, row.userId);
  } else {
    requireOwnedAnalysis(authMode, userId, row.analysisId);
  }
  return row;
}

export const annotationRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        analysisId: z.number(),
        shotType: shotTypeEnum,
        isProReference: z.boolean().default(false),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireOwnedAnalysis(ctx.authMode, ctx.user?.id, input.analysisId);
      const userId = ownerIdForInsert(ctx.authMode, ctx.user?.id);
      const result = db
        .insert(annotations)
        .values({
          analysisId: input.analysisId,
          userId,
          shotType: input.shotType,
          isProReference: input.isProReference,
          notes: input.notes ?? null,
        })
        .returning()
        .get();

      db.update(analyses)
        .set({ shotType: input.shotType })
        .where(eq(analyses.id, input.analysisId))
        .run();

      return result;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(annotations.userId, ctx.user.id)
        : undefined;
    const base = db
      .select({
        annotation: annotations,
        videoFileName: analyses.videoFileName,
        overallScore: analyses.overallScore,
      })
      .from(annotations)
      .innerJoin(analyses, eq(annotations.analysisId, analyses.id));
    return (ownerFilter ? base.where(ownerFilter) : base)
      .orderBy(desc(annotations.annotatedAt))
      .all();
  }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        shotType: shotTypeEnum.optional(),
        isProReference: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      requireOwnedAnnotation(ctx.authMode, ctx.user?.id, id);
      const result = db
        .update(annotations)
        .set(updates)
        .where(eq(annotations.id, id))
        .returning()
        .get();

      if (result && updates.shotType) {
        db.update(analyses)
          .set({ shotType: updates.shotType })
          .where(eq(analyses.id, result.analysisId))
          .run();
      }

      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      requireOwnedAnnotation(ctx.authMode, ctx.user?.id, input.id);
      db.delete(annotations).where(eq(annotations.id, input.id)).run();
      return { success: true };
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(annotations.userId, ctx.user.id)
        : undefined;
    const base = db
      .select({
        shotType: annotations.shotType,
        count: sql<number>`count(*)`,
        proCount: sql<number>`sum(case when ${annotations.isProReference} = 1 then 1 else 0 end)`,
      })
      .from(annotations);
    return (ownerFilter ? base.where(ownerFilter) : base)
      .groupBy(annotations.shotType)
      .all();
  }),

  unannotated: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(analyses.userId, ctx.user.id)
        : undefined;
    const notAnnotated = sql`${analyses.id} NOT IN (SELECT ${annotations.analysisId} FROM ${annotations})`;
    const whereClause = ownerFilter ? and(ownerFilter, notAnnotated) : notAnnotated;
    return db
      .select()
      .from(analyses)
      .where(whereClause)
      .orderBy(desc(analyses.createdAt))
      .all();
  }),

  exportTrainingData: protectedProcedure.query(async ({ ctx }) => {
    const ownerFilter =
      ctx.authMode === "on" && ctx.user
        ? eq(annotations.userId, ctx.user.id)
        : undefined;
    const base = db
      .select({
        analysisId: analyses.id,
        shotType: annotations.shotType,
        isProReference: annotations.isProReference,
        dominantSide: analyses.dominantSide,
        sampleFps: analyses.sampleFps,
        frameCount: analyses.frameCount,
        landmarksJson: analyses.landmarksJson,
        phasesJson: analyses.phasesJson,
      })
      .from(annotations)
      .innerJoin(analyses, eq(annotations.analysisId, analyses.id));
    const rows = (ownerFilter ? base.where(ownerFilter) : base).all();

    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      sampleFps: 15,
      samples: rows.map((r) => {
        let landmarks: unknown = [];
        let phases: unknown = [];
        try {
          landmarks = JSON.parse(r.landmarksJson);
        } catch {
          landmarks = [];
        }
        try {
          phases = JSON.parse(r.phasesJson);
        } catch {
          phases = [];
        }
        return {
          id: r.analysisId,
          shotType: r.shotType,
          isProReference: r.isProReference,
          dominantSide: r.dominantSide,
          frameCount: r.frameCount,
          landmarks,
          phases,
        };
      }),
    };
  }),
});
