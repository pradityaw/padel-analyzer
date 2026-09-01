import path from "path";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db.js";
import { analyses, analysisJobs, annotations } from "../../drizzle/schema.js";

const UPLOAD_OWNER_RE = /^u(\d+)_/;

export function safeUploadBasename(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const base = path.basename(raw);
  if (!base || base !== raw) return null;
  if (base === "." || base === "..") return null;
  return base;
}

/** `u{id}_` prefix used by local uploads and YouTube saves. */
export function ownedUploadPrefix(userId: number): string {
  return `u${userId}_`;
}

/**
 * Owner id embedded in a storage basename. Compares the integer between `u`
 * and `_` so user 1 does not match `u10_…` / `u11_…` (startsWith(`u${id}`)
 * would). Returns null when the name is not an owned-upload key.
 */
export function uploadOwnerIdFromName(filename: string): number | null {
  const match = UPLOAD_OWNER_RE.exec(filename);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  if (String(id) !== match[1]) return null;
  return id;
}

export function canReadUploadFile(userId: number, filename: string): boolean {
  const safe = safeUploadBasename(filename);
  if (!safe) return false;
  if (uploadOwnerIdFromName(safe) === userId) return true;

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
