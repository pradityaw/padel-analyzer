import { existsSync } from "fs";
import path from "path";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import {
  analysisJobs,
  type NewAnalysisJob,
} from "../../drizzle/schema.js";
import {
  analysisJobSchema,
  createMobileAnalysisJobInputSchema,
} from "../../shared/schema.js";
import { scheduleAnalysisJob } from "../lib/analysisJobProcessor.js";
import {
  getAnalysisJobProgress,
  initializeAnalysisJobProgress,
} from "../lib/analysisJobProgress.js";
import { getUploadsDir } from "../lib/paths.js";

function createJobRecord(input: {
  videoFileName: string;
  videoStorageKey: string;
}): ReturnType<typeof analysisJobSchema.parse> {
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

  const stages = initializeAnalysisJobProgress(created.id);
  scheduleAnalysisJob(created.id);
  return analysisJobSchema.parse({ ...created, stages });
}

export const mobileAnalysisRouter = router({
  create: publicProcedure
    .input(createMobileAnalysisJobInputSchema)
    .mutation(async ({ input }) => {
      const videoPath = path.join(getUploadsDir(), input.videoStorageKey);
      if (!existsSync(videoPath)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Uploaded video could not be found on the server. Upload the file again.",
        });
      }
      return createJobRecord(input);
    }),

  getById: publicProcedure
    .input(analysisJobSchema.pick({ id: true }))
    .query(({ input }) => {
      const job = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.id))
        .get();
      return job
        ? analysisJobSchema.parse({
            ...job,
            stages: getAnalysisJobProgress(job.id),
          })
        : null;
    }),

  list: publicProcedure.query(() => {
    return db
      .select()
      .from(analysisJobs)
      .orderBy(desc(analysisJobs.createdAt))
      .limit(20)
      .all()
      .map((job) =>
        analysisJobSchema.parse({
          ...job,
          stages: getAnalysisJobProgress(job.id),
        })
      );
  }),

  /** Re-queue analysis for an existing upload (failed or completed jobs). */
  retry: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const job = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.id))
        .get();

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found." });
      }

      const videoPath = path.join(getUploadsDir(), job.videoStorageKey);
      if (!existsSync(videoPath)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Original video is no longer on the server. Upload the clip again.",
        });
      }

      return createJobRecord({
        videoFileName: job.videoFileName,
        videoStorageKey: job.videoStorageKey,
      });
    }),
});
