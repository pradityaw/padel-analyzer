import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import { eq, desc } from "drizzle-orm";

export const analysisRouter = router({
  create: publicProcedure
    .input(
      z.object({
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
        processingState: z
          .enum(["pending", "processing", "complete", "failed"])
          .optional()
          .default("complete"),
        qualityWarnings: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = db.insert(analyses).values(input).returning().get();
      return result;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const result = db
        .select()
        .from(analyses)
        .where(eq(analyses.id, input.id))
        .get();
      return result ?? null;
    }),

  list: publicProcedure.query(async () => {
    return db.select().from(analyses).orderBy(desc(analyses.createdAt)).all();
  }),

  updateState: publicProcedure
    .input(
      z.object({
        id: z.number(),
        processingState: z.enum(["pending", "processing", "complete", "failed"]),
        qualityWarnings: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      db.update(analyses).set(updates).where(eq(analyses.id, id)).run();
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      db.delete(analyses).where(eq(analyses.id, input.id)).run();
      return { success: true };
    }),
});
