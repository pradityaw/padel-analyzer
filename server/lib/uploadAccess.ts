import path from "path";
import { TRPCError } from "@trpc/server";
import { and, eq, or } from "drizzle-orm";
import type { AuthMode } from "../_core/context.js";
import { db } from "../db.js";
import { analyses, analysisJobs, annotations } from "../../drizzle/schema.js";
import { isCloudStorageKey } from "./objectStorage.js";

export function safeUploadBasename(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const base = path.basename(raw);
  if (!base || base !== raw) return null;
  if (base === "." || base === "..") return null;
  return base;
}

export function canReadUploadFile(userId: number, filename: string): boolean {
  const safe = safeUploadBasename(filename);
  if (!safe) return false;
  if (safe.startsWith(`u${userId}_`)) return true;

  const analysis = db
    .select({ id: analyses.id, userId: analyses.userId })
    .from(analyses)
    .where(
      or(eq(analyses.videoStorageKey, safe), eq(analyses.videoFileName, safe)),
    )
    .get();
  if (analysis?.userId === userId) return true;

  const job = db
    .select({ id: analysisJobs.id })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.userId, userId),
        or(
          eq(analysisJobs.videoStorageKey, safe),
          eq(analysisJobs.videoFileName, safe),
        ),
      ),
    )
    .get();
  if (job) return true;

  if (analysis) {
    const pro = db
      .select({ id: annotations.id })
      .from(annotations)
      .where(
        and(
          eq(annotations.analysisId, analysis.id),
          eq(annotations.isProReference, true),
        ),
      )
      .get();
    if (pro) return true;
  }
  return false;
}

function cloudKeyOwnedByOtherUser(
  storageKey: string,
  userId: number,
): boolean {
  const analysis = db
    .select({ userId: analyses.userId })
    .from(analyses)
    .where(eq(analyses.videoStorageKey, storageKey))
    .get();
  if (analysis?.userId != null && analysis.userId !== userId) {
    return true;
  }

  const job = db
    .select({ userId: analysisJobs.userId })
    .from(analysisJobs)
    .where(eq(analysisJobs.videoStorageKey, storageKey))
    .get();
  if (job?.userId != null && job.userId !== userId) {
    return true;
  }
  return false;
}

/**
 * When AUTH_MODE=on, analysis jobs may only reference videos the caller may read
 * (same rules as GET /uploads/:file).
 */
export function requireVideoStorageForUser(
  authMode: AuthMode,
  userId: number | null | undefined,
  storageKey: string,
): void {
  if (authMode === "off") return;
  if (userId == null) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }

  if (isCloudStorageKey(storageKey)) {
    if (cloudKeyOwnedByOtherUser(storageKey, userId)) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Video not found.",
      });
    }
    return;
  }

  const base = path.basename(storageKey);
  if (!canReadUploadFile(userId, base)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Video not found.",
    });
  }
}
