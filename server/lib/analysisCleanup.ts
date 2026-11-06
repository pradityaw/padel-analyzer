import { existsSync, unlinkSync, statSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
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
    unlinkQuiet(path.join(getUploadsDir(), path.basename(storageKey)));
  }

  for (const job of jobs) {
    unlinkQuiet(path.join(getDataRoot(), "analysis-agents", `job-${job.id}.json`));
    unlinkQuiet(path.join(getAnalysisTimingDir(), `job-${job.id}-timing.json`));
  }
  unlinkQuiet(path.join(getDataRoot(), "rallies", `${analysisId}.json`));

  // Single SQLite transaction so a crash/power-loss cannot leave orphaned child
  // rows (e.g. pro_comparisons referencing a deleted analysis) after partial deletes.
  db.transaction((tx) => {
    tx.delete(feedback).where(eq(feedback.analysisId, analysisId)).run();
    tx.delete(annotations).where(eq(annotations.analysisId, analysisId)).run();
    tx.delete(proComparisons).where(eq(proComparisons.playerAnalysisId, analysisId)).run();
    tx.delete(analysisJobs).where(eq(analysisJobs.analysisId, analysisId)).run();
    const deleted = tx.delete(analyses).where(eq(analyses.id, analysisId)).run();
    if (deleted.changes === 0) {
      throw new Error(
        `deleteAnalysisArtifacts: analysis ${analysisId} was not removed (missing row or concurrent delete)`,
      );
    }
  });
}

export function dataRootBytes(): number {
  try {
    return statSync(getDataRoot()).size;
  } catch {
    return 0;
  }
}
