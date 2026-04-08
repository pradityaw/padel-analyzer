import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { annotations, analyses } from "../../drizzle/schema.js";
import { eq, desc, sql, isNull } from "drizzle-orm";
import { SHOT_TYPES } from "../../shared/types.js";

const shotTypeEnum = z.enum(SHOT_TYPES as unknown as [string, ...string[]]);

export const annotationRouter = router({
  create: publicProcedure
    .input(
      z.object({
        analysisId: z.number(),
        shotType: shotTypeEnum,
        isProReference: z.boolean().default(false),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = db
        .insert(annotations)
        .values({
          analysisId: input.analysisId,
          shotType: input.shotType,
          isProReference: input.isProReference,
          notes: input.notes ?? null,
        })
        .returning()
        .get();

      // Also update the analysis shotType for quick access
      db.update(analyses)
        .set({ shotType: input.shotType })
        .where(eq(analyses.id, input.analysisId))
        .run();

      return result;
    }),

  list: publicProcedure.query(async () => {
    return db
      .select({
        annotation: annotations,
        videoFileName: analyses.videoFileName,
        overallScore: analyses.overallScore,
      })
      .from(annotations)
      .innerJoin(analyses, eq(annotations.analysisId, analyses.id))
      .orderBy(desc(annotations.annotatedAt))
      .all();
  }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        shotType: shotTypeEnum.optional(),
        isProReference: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const result = db
        .update(annotations)
        .set(updates)
        .where(eq(annotations.id, id))
        .returning()
        .get();

      // Sync shotType to analysis if changed
      if (result && updates.shotType) {
        db.update(analyses)
          .set({ shotType: updates.shotType })
          .where(eq(analyses.id, result.analysisId))
          .run();
      }

      return result;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      db.delete(annotations).where(eq(annotations.id, input.id)).run();
      return { success: true };
    }),

  stats: publicProcedure.query(async () => {
    const rows = db
      .select({
        shotType: annotations.shotType,
        count: sql<number>`count(*)`,
        proCount: sql<number>`sum(case when ${annotations.isProReference} = 1 then 1 else 0 end)`,
      })
      .from(annotations)
      .groupBy(annotations.shotType)
      .all();
    return rows;
  }),

  unannotated: publicProcedure.query(async () => {
    // Get analyses that have no annotation
    const annotated = db
      .select({ analysisId: annotations.analysisId })
      .from(annotations);

    return db
      .select()
      .from(analyses)
      .where(
        sql`${analyses.id} NOT IN (SELECT ${annotations.analysisId} FROM ${annotations})`
      )
      .orderBy(desc(analyses.createdAt))
      .all();
  }),

  // Export all annotated data for training
  exportTrainingData: publicProcedure.query(async () => {
    const rows = db
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
      .innerJoin(analyses, eq(annotations.analysisId, analyses.id))
      .all();

    return {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      sampleFps: 15,
      samples: rows.map((r) => ({
        id: r.analysisId,
        shotType: r.shotType,
        isProReference: r.isProReference,
        dominantSide: r.dominantSide,
        frameCount: r.frameCount,
        landmarks: JSON.parse(r.landmarksJson),
        phases: JSON.parse(r.phasesJson),
      })),
    };
  }),
});
