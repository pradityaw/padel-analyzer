import path from "path";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db.js";
import { analyses, analysisJobs, annotations } from "../../drizzle/schema.js";

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
