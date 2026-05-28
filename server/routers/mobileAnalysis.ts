import { appendFile, mkdir } from "fs/promises";
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
  analysisJobDetailSchema,
  analysisJobGetInputSchema,
  analysisJobIdInputSchema,
  analysisJobSchema,
  courtCornersInputSchema,
  createMobileAnalysisJobInputSchema,
  recordModeSchema,
  trackingSyncInputSchema,
  type TrackingSyncInput,
} from "../../shared/schema.js";
import { analyses } from "../../drizzle/schema.js";
import { readAnalysisBallTracking } from "../lib/ballTracking.js";
import { readAnalysisRacketTracking } from "../lib/racketTracking.js";
import {
  sanitizeBallTrackingPayload,
  sanitizeRacketTrackingPayload,
} from "../lib/trackingPayload.js";
import { scheduleAnalysisJob } from "../lib/analysisJobProcessor.js";
import {
  getAnalysisJobProgress,
  initializeAnalysisJobProgress,
} from "../lib/analysisJobProgress.js";
import { getTrackingSyncDir } from "../lib/paths.js";
import { assertVideoAccessible } from "../lib/videoAccess.js";

function trackingSyncPath(sessionId: string): string {
  return path.join(getTrackingSyncDir(), `${sessionId}.jsonl`);
}

async function appendTrackingSync(input: TrackingSyncInput) {
  await mkdir(getTrackingSyncDir(), { recursive: true });
  const record = {
    ...input,
    receivedAt: new Date().toISOString(),
  };
  await appendFile(trackingSyncPath(input.sessionId), `${JSON.stringify(record)}\n`);
}

function createJobRecord(input: {
  videoFileName: string;
  videoStorageKey: string;
  courtCornersJson?: string | null;
  mode?: string;
}): ReturnType<typeof analysisJobSchema.parse> {
  const mode = recordModeSchema.parse(input.mode ?? "match");
  const created = db
    .insert(analysisJobs)
    .values({
      videoFileName: input.videoFileName,
      videoStorageKey: input.videoStorageKey,
      courtCornersJson: input.courtCornersJson ?? null,
      mode,
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

function hydrateJobProgress(job: typeof analysisJobs.$inferSelect) {
  return analysisJobSchema.parse({
    ...job,
    stages: getAnalysisJobProgress(job.id),
  });
}

async function hydrateJobTracking(
  job: {
    id: number;
    analysisId: number | null | undefined;
  },
  landmarksJson: string
) {
  const [ballRaw, racketRaw] = await Promise.all([
    readAnalysisBallTracking(job.id, landmarksJson),
    readAnalysisRacketTracking(job.id, landmarksJson),
  ]);
  return {
    ballTracking: sanitizeBallTrackingPayload(ballRaw),
    racketTracking: sanitizeRacketTrackingPayload(racketRaw),
    trackingMeta: {
      sourceJobId: job.id,
      ballSampleCount: ballRaw.length,
      racketSampleCount: racketRaw.length,
    },
  };
}

export const mobileAnalysisRouter = router({
  create: publicProcedure
    .input(createMobileAnalysisJobInputSchema)
    .mutation(async ({ input }) => {
      try {
        await assertVideoAccessible(input.videoStorageKey);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Uploaded video could not be found. Upload the file again.",
        });
      }
      const courtCornersJson = input.courtCorners
        ? JSON.stringify(courtCornersInputSchema.parse(input.courtCorners))
        : null;
      return createJobRecord({
        videoFileName: input.videoFileName,
        videoStorageKey: input.videoStorageKey,
        courtCornersJson,
        mode: input.mode,
      });
    }),

  syncTracking: publicProcedure
    .input(trackingSyncInputSchema)
    .mutation(async ({ input }) => {
      await appendTrackingSync(input);
      return {
        ok: true,
        accepted: input.tuples.length,
      };
    }),

  getById: publicProcedure
    .input(analysisJobGetInputSchema)
    .query(async ({ input }) => {
      const job = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.id))
        .get();
      if (!job) return null;

      const base = hydrateJobProgress(job);

      if (!input.includeTracking) {
        return base;
      }

      if (job.analysisId == null) {
        return analysisJobDetailSchema.parse({
          ...base,
          ballTracking: [],
          racketTracking: [],
          trackingMeta: {
            sourceJobId: null,
            ballSampleCount: 0,
            racketSampleCount: 0,
          },
        });
      }

      const analysis = db
        .select({ landmarksJson: analyses.landmarksJson })
        .from(analyses)
        .where(eq(analyses.id, job.analysisId))
        .get();

      const landmarksJson = analysis?.landmarksJson ?? "[]";
      const tracking = await hydrateJobTracking(job, landmarksJson);

      return analysisJobDetailSchema.parse({
        ...base,
        ...tracking,
      });
    }),

  getProgress: publicProcedure
    .input(analysisJobIdInputSchema)
    .query(({ input }) => {
      const job = db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, input.id))
        .get();
      return job ? hydrateJobProgress(job) : null;
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

      try {
        await assertVideoAccessible(job.videoStorageKey);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Original video is no longer available. Upload the clip again.",
        });
      }

      return createJobRecord({
        videoFileName: job.videoFileName,
        videoStorageKey: job.videoStorageKey,
        courtCornersJson: job.courtCornersJson,
        mode: job.mode,
      });
    }),
});
