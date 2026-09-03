import { existsSync, unlinkSync, statSync } from "fs";
import path from "path";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "../db.js";
import {
  analyses,
  analysisJobs,
  annotations,
  proComparisons,
  feedback,
} from "../../drizzle/schema.js";
import { deleteLandmarksFile } from "./landmarksStorage.js";
import { getDataRoot, getUploadsDir, getAnalysisTimingDir } from "./paths.js";
import { logger } from "./logger.js";

function unlinkQuiet(filePath: string): void {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch (err) {
    logger.warn({ err, filePath }, "failed to unlink artifact");
  }
}

function otherRowsShareUploadKey(
  basename: string,
  excludeAnalysisId: number,
): boolean {
  const analysisHit = db
    .select({ id: analyses.id })
    .from(analyses)
    .where(
      and(
        ne(analyses.id, excludeAnalysisId),
        or(
          eq(analyses.videoStorageKey, basename),
          eq(analyses.videoFileName, basename),
        ),
      ),
    )
    .get();
  if (analysisHit) return true;

  const jobHit = db
    .select({ id: analysisJobs.id })
    .from(analysisJobs)
    .where(
      and(
        or(
          eq(analysisJobs.videoStorageKey, basename),
          eq(analysisJobs.videoFileName, basename),
        ),
        or(
          isNull(analysisJobs.analysisId),
          ne(analysisJobs.analysisId, excludeAnalysisId),
        ),
      ),
    )
    .get();
  return !!jobHit;
}

export function deleteAnalysisArtifacts(analysisId: number): void {
  const row = db.select().from(analyses).where(eq(analyses.id, analysisId)).get();
  if (!row) return;

  const jobs = db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.analysisId, analysisId))
    .all();

  deleteLandmarksFile(row.landmarksPath);

  const storageKey = row.videoStorageKey ?? row.videoFileName;
  if (storageKey && !storageKey.startsWith("s3://") && !storageKey.includes("/")) {
    const basename = path.basename(storageKey);
    if (!otherRowsShareUploadKey(basename, analysisId)) {
      unlinkQuiet(path.join(getUploadsDir(), basename));
    }
  }

  for (const job of jobs) {
    unlinkQuiet(path.join(getDataRoot(), "analysis-agents", `job-${job.id}.json`));
    unlinkQuiet(path.join(getAnalysisTimingDir(), `job-${job.id}-timing.json`));
  }
  unlinkQuiet(path.join(getDataRoot(), "rallies", `${analysisId}.json`));

  db.delete(feedback).where(eq(feedback.analysisId, analysisId)).run();
  db.delete(annotations).where(eq(annotations.analysisId, analysisId)).run();
  db.delete(proComparisons).where(eq(proComparisons.playerAnalysisId, analysisId)).run();
  db.delete(analysisJobs).where(eq(analysisJobs.analysisId, analysisId)).run();
  db.delete(analyses).where(eq(analyses.id, analysisId)).run();
}

export function dataRootBytes(): number {
  try {
    return statSync(getDataRoot()).size;
  } catch {
    return 0;
  }
}
