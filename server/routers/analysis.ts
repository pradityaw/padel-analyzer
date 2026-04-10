import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import { eq, desc } from "drizzle-orm";
import {
  createAnalysisInputSchema,
  updateAnalysisResultsSchema,
  updateAnalysisStateSchema,
} from "../../shared/schema.js";

export const analysisRouter = router({
  createPending: publicProcedure
    .input(
      z.object({
        videoFileName: z.string(),
        videoStorageKey: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = db
        .insert(analyses)
        .values({
          videoFileName: input.videoFileName,
          videoStorageKey: input.videoStorageKey,
          overallScore: 0,
          dominantSide: "right",
          durationMs: 0,
          frameCount: 0,
          sampleFps: 0,
          phasesJson: "[]",
          landmarksJson: "[]",
          processingState: "pending",
        })
        .returning()
        .get();
      return result;
    }),

  updateResults: publicProcedure
    .input(updateAnalysisResultsSchema)
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      db.update(analyses).set(updates).where(eq(analyses.id, id)).run();
      return db.select().from(analyses).where(eq(analyses.id, id)).get();
    }),

  create: publicProcedure
    .input(createAnalysisInputSchema)
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
    .input(updateAnalysisStateSchema)
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
