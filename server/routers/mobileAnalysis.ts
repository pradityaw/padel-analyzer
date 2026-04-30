import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { desc, eq } from "drizzle-orm";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import {
  analysisJobs,
  analyses,
  type NewAnalysis,
  type NewAnalysisJob,
} from "../../drizzle/schema.js";
import {
  analysisJobSchema,
  createMobileAnalysisJobInputSchema,
} from "../../shared/schema.js";
import { runMobileAnalysis } from "../_core/mobileAnalysisRunner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const uploadsDir = path.join(rootDir, "data/uploads");

async function updateJob(
  jobId: number,
  updates: Partial<NewAnalysisJob>
): Promise<void> {
  db.update(analysisJobs)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(analysisJobs.id, jobId))
    .run();
}

async function processMobileAnalysisJob(jobId: number): Promise<void> {
  try {
    const job = db
      .select()
      .from(analysisJobs)
      .where(eq(analysisJobs.id, jobId))
      .get();

    if (!job) return;

    await updateJob(jobId, {
      status: "processing",
      progress: 10,
      statusMessage: "Preparing analysis runtime...",
      errorMessage: null,
    });

    const videoPath = path.join(uploadsDir, job.videoStorageKey);
    if (!existsSync(videoPath)) {
      throw new Error("Uploaded video could not be found on the server.");
    }

    await updateJob(jobId, {
      progress: 40,
      statusMessage: "Extracting pose landmarks...",
    });

    const result = await runMobileAnalysis(videoPath);

    await updateJob(jobId, {
      progress: 90,
      statusMessage: "Saving analysis...",
    });

    const newAnalysis: NewAnalysis = {
      videoFileName: job.videoFileName,
      videoStorageKey: job.videoStorageKey,
      overallScore: result.overallScore,
      dominantSide: result.dominantSide,
      durationMs: result.durationMs,
      frameCount: result.frameCount,
      sampleFps: result.sampleFps,
      phasesJson: JSON.stringify(result.phases),
      landmarksJson: JSON.stringify(result.frameLandmarks),
      shotType: result.shotType as NewAnalysis["shotType"],
      shotConfidence: result.shotConfidence,
      skillLabel: result.skillLabel as NewAnalysis["skillLabel"],
      skillConfidence: result.skillConfidence,
      qualityScore: result.qualityScore,
    };

    const saved = db
      .insert(analyses)
      .values(newAnalysis)
      .returning()
      .get();

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      statusMessage: "Analysis complete.",
      analysisId: saved.id,
      errorMessage: null,
    });
  } catch (error) {
    await updateJob(jobId, {
      status: "failed",
      progress: 100,
      statusMessage: "Analysis failed.",
      errorMessage:
        error instanceof Error ? error.message : "Unknown analysis failure.",
    });
  }
}

export const mobileAnalysisRouter = router({
  create: publicProcedure
    .input(createMobileAnalysisJobInputSchema)
    .mutation(async ({ input }) => {
      const created = db
        .insert(analysisJobs)
        .values({
          videoFileName: input.videoFileName,
          videoStorageKey: input.videoStorageKey,
          status: "queued",
          progress: 0,
          statusMessage: "Queued for analysis.",
        } satisfies NewAnalysisJob)
        .returning()
        .get();

      void processMobileAnalysisJob(created.id);

      return analysisJobSchema.parse(created);
    }),

  getById: publicProcedure
    .input(analysisJobSchema.pick({ id: true }))
    .query(({ input }) => {
      const job = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.id))
        .get();
      return job ? analysisJobSchema.parse(job) : null;
    }),

  list: publicProcedure.query(() => {
    return db
      .select()
      .from(analysisJobs)
      .orderBy(desc(analysisJobs.createdAt))
      .limit(20)
      .all()
      .map((job) => analysisJobSchema.parse(job));
  }),
});
