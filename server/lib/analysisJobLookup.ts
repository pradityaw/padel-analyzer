import { and, desc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { analysisJobs } from "../../drizzle/schema.js";

/**
 * Resolve the job id used for CV agent artifacts (`data/analysis-agents/job-{id}.json`).
 * Picks the latest **completed** job for this analysis (highest id), so re-runs do not
 * return stale artifacts from an older failed/queued job.
 */
export function resolveCompletedJobIdForAnalysis(
  analysisId: number
): number | null {
  const row = db
    .select({ id: analysisJobs.id })
    .from(analysisJobs)
    .where(
      and(
        eq(analysisJobs.analysisId, analysisId),
        eq(analysisJobs.status, "completed")
      )
    )
    .orderBy(desc(analysisJobs.id))
    .limit(1)
    .get();

  return row?.id ?? null;
}
