import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { AuthMode } from "../_core/context.js";
import { db } from "../db.js";
import {
  analyses,
  analysisJobs,
  annotations,
  type Analysis,
  type AnalysisJob,
} from "../../drizzle/schema.js";
import { canReadUploadFile, safeUploadBasename } from "./uploadAccess.js";

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

export function isProReferenceAnalysis(analysisId: number): boolean {
  const row = db
    .select({ id: annotations.id })
    .from(annotations)
    .where(
      and(
        eq(annotations.analysisId, analysisId),
        eq(annotations.isProReference, true),
      ),
    )
    .get();
  return !!row;
}

/** Owner, or a clip marked as a shared pro reference. */
export function requireAccessibleAnalysis(
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
  if (authMode === "off") return row;
  if (userId != null && row.userId === userId) return row;
  if (isProReferenceAnalysis(analysisId)) return row;
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Analysis not found.",
  });
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

export function assertCallerOwnsUploadKey(
  authMode: AuthMode,
  userId: number | null | undefined,
  storageKey: string | null | undefined,
): void {
  if (authMode === "off" || !storageKey) return;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  if (storageKey.startsWith("s3://") || storageKey.includes("/")) return;
  const safe = safeUploadBasename(storageKey);
  if (!safe) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid video key.",
    });
  }
  if (!canReadUploadFile(userId, safe)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Video not found.",
    });
  }
}
