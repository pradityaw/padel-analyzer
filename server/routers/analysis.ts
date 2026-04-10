import { z } from "zod";
import path from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { analyses } from "../../drizzle/schema.js";
import { eq, desc } from "drizzle-orm";
import {
  createAnalysisInputSchema,
  updateAnalysisResultsSchema,
  updateAnalysisStateSchema,
} from "../../shared/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const landmarksDir = path.resolve(__dirname, "../../data/landmarks");

function writeLandmarksFile(analysisId: number, landmarksJson: string): string {
  const fileName = `${analysisId}.json`;
  const filePath = path.join(landmarksDir, fileName);
  writeFileSync(filePath, landmarksJson, "utf-8");
  return fileName;
}

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
      const { id, landmarksJson, ...updates } = input;
      // Write landmarks to disk file
      const landmarksPath = writeLandmarksFile(id, landmarksJson);
      db.update(analyses)
        .set({ ...updates, landmarksJson: "[]", landmarksPath })
        .where(eq(analyses.id, id))
        .run();
      return db.select().from(analyses).where(eq(analyses.id, id)).get();
    }),

  create: publicProcedure
    .input(createAnalysisInputSchema)
    .mutation(async ({ input }) => {
      const { landmarksJson, ...rest } = input;
      const result = db
        .insert(analyses)
        .values({ ...rest, landmarksJson: "[]" })
        .returning()
        .get();
      // Write landmarks to disk file
      const landmarksPath = writeLandmarksFile(result.id, landmarksJson);
      db.update(analyses)
        .set({ landmarksPath })
        .where(eq(analyses.id, result.id))
        .run();
      return { ...result, landmarksPath };
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

  getLandmarks: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const row = db
        .select({
          landmarksJson: analyses.landmarksJson,
          landmarksPath: analyses.landmarksPath,
        })
        .from(analyses)
        .where(eq(analyses.id, input.id))
        .get();
      if (!row) return null;
      // Prefer disk file if available
      if (row.landmarksPath) {
        const filePath = path.join(landmarksDir, row.landmarksPath);
        if (existsSync(filePath)) {
          return readFileSync(filePath, "utf-8");
        }
      }
      // Fallback to inline JSON for legacy rows
      return row.landmarksJson;
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
