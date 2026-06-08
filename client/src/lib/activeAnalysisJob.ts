const STORAGE_KEY = "padel-active-analysis-job-v1";
export const ACTIVE_JOB_QUERY_PARAM = "job";

export type ActiveAnalysisJobSnapshot = {
  jobId: number;
  videoFileName: string;
  processingStartedAt: number;
  source: "upload" | "youtube";
};

function readRaw(): ActiveAnalysisJobSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveAnalysisJobSnapshot>;
    if (
      typeof parsed.jobId !== "number" ||
      !Number.isFinite(parsed.jobId) ||
      parsed.jobId <= 0 ||
      typeof parsed.videoFileName !== "string" ||
      typeof parsed.processingStartedAt !== "number" ||
      !Number.isFinite(parsed.processingStartedAt) ||
      (parsed.source !== "upload" && parsed.source !== "youtube")
    ) {
      return null;
    }
    return {
      jobId: parsed.jobId,
      videoFileName: parsed.videoFileName,
      processingStartedAt: parsed.processingStartedAt,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

function write(snapshot: ActiveAnalysisJobSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota / private mode */
  }
}

export function parseJobIdFromSearch(search: string): number | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get(ACTIVE_JOB_QUERY_PARAM);
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function readStoredActiveJob(): ActiveAnalysisJobSnapshot | null {
  return readRaw();
}

export function saveActiveJob(snapshot: ActiveAnalysisJobSnapshot): void {
  write(snapshot);
}

export function clearActiveJob(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function syncJobDeepLink(jobId: number | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (jobId != null) {
    url.searchParams.set(ACTIVE_JOB_QUERY_PARAM, String(jobId));
  } else {
    url.searchParams.delete(ACTIVE_JOB_QUERY_PARAM);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

/** Prefer `?job=` deep link, then fall back to localStorage. */
export function resolveResumeJobId(search: string): number | null {
  return parseJobIdFromSearch(search) ?? readStoredActiveJob()?.jobId ?? null;
}

export function inferJobSource(videoFileName: string): "upload" | "youtube" {
  return videoFileName.startsWith("yt_") ? "youtube" : "upload";
}
