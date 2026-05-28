/** Persists the in-flight server analysis job id across Upload refresh/navigation. */
export const ACTIVE_ANALYSIS_JOB_STORAGE_KEY = "padel-active-analysis-job-v1";

export function readActiveAnalysisJobId(): number | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(ACTIVE_ANALYSIS_JOB_STORAGE_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function writeActiveAnalysisJobId(jobId: number): void {
  localStorage.setItem(ACTIVE_ANALYSIS_JOB_STORAGE_KEY, String(jobId));
}

export function clearActiveAnalysisJobId(): void {
  localStorage.removeItem(ACTIVE_ANALYSIS_JOB_STORAGE_KEY);
}
