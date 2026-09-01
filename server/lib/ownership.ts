import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { AuthMode } from "../_core/context.js";
import { db } from "../db.js";
import { analyses, analysisJobs, type Analysis, type AnalysisJob } from "../../drizzle/schema.js";

export function requireOwner(
  authMode: AuthMode,
  userId: number | null | undefined,
  rowUserId: number | null | undefined,
): void {
  if (authMode === "off") return;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  if (rowUserId == null || rowUserId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Analysis not found.",
    });
  }
}

export function ownerIdForInsert(
  authMode: AuthMode,
  userId: number | null | undefined,
): number | null {
  if (authMode === "off") return userId ?? null;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  return userId;
}

export function requireOwnedAnalysis(
  authMode: AuthMode,
  userId: number | null | undefined,
  analysisId: number,
): Analysis {
  const row = db.select().from(analyses).where(eq(analyses.id, analysisId)).get();
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Analysis not found.",
    });
  }
  requireOwner(authMode, userId, row.userId);
  return row;
}

export function requireOwnedJob(
  authMode: AuthMode,
  userId: number | null | undefined,
  jobId: number,
): AnalysisJob {
  const row = db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.id, jobId))
    .get();
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Job not found.",
    });
  }
  requireOwner(authMode, userId, row.userId);
  return row;
}
