/**
 * Client-side heuristics for server analysis duration.
 *
 * Calibrated from a long YouTube match (~21 min video → ~48 min wall time).
 * Ranges are intentionally wide so the UI under-promises rather than over-promises.
 */

export type ProcessingSource = "upload" | "youtube";

export type ProcessingTimeTier = "quick" | "moderate" | "long";

export type ProcessingTimeEstimate = {
  durationSec: number | null;
  source: ProcessingSource;
  /** Point estimate in seconds (used for elapsed comparison). */
  expectedSec: number;
  minSec: number;
  maxSec: number;
  tier: ProcessingTimeTier;
  headline: string;
  detail: string;
};

/** Wall-clock multiplier vs video length for server pose + CV agents. */
const LONG_CLIP_RATIO = 2.3;
const SHORT_CLIP_RATIO = 1.35;
const SHORT_CLIP_THRESHOLD_SEC = 3 * 60;
const LONG_CLIP_THRESHOLD_SEC = 10 * 60;

/** Fixed pipeline overhead (rally pass, job queue, aggregation). */
const BASE_OVERHEAD_SEC = 90;

/** YouTube: yt-dlp download before analysis starts. */
const YOUTUBE_DOWNLOAD_RATIO = 0.35;
const YOUTUBE_DOWNLOAD_MIN_SEC = 45;
const YOUTUBE_DOWNLOAD_MAX_SEC = 8 * 60;

function tierFromExpectedSec(expectedSec: number): ProcessingTimeTier {
  if (expectedSec <= 4 * 60) return "quick";
  if (expectedSec <= 15 * 60) return "moderate";
  return "long";
}

function formatMinutes(sec: number): string {
  const totalMin = Math.max(1, Math.round(sec / 60));
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
}

function formatRange(minSec: number, maxSec: number): string {
  if (maxSec - minSec < 90) {
    return `about ${formatMinutes((minSec + maxSec) / 2)}`;
  }
  return `about ${formatMinutes(minSec)}–${formatMinutes(maxSec)}`;
}

function processingMultiplier(durationSec: number): number {
  if (durationSec <= SHORT_CLIP_THRESHOLD_SEC) return SHORT_CLIP_RATIO;
  if (durationSec >= LONG_CLIP_THRESHOLD_SEC) return LONG_CLIP_RATIO;
  const t =
    (durationSec - SHORT_CLIP_THRESHOLD_SEC) /
    (LONG_CLIP_THRESHOLD_SEC - SHORT_CLIP_THRESHOLD_SEC);
  return SHORT_CLIP_RATIO + t * (LONG_CLIP_RATIO - SHORT_CLIP_RATIO);
}

function youtubeDownloadSec(durationSec: number): number {
  const scaled = durationSec * YOUTUBE_DOWNLOAD_RATIO;
  return Math.min(
    YOUTUBE_DOWNLOAD_MAX_SEC,
    Math.max(YOUTUBE_DOWNLOAD_MIN_SEC, Math.round(scaled))
  );
}

function coreAnalysisSec(durationSec: number): number {
  return Math.round(BASE_OVERHEAD_SEC + durationSec * processingMultiplier(durationSec));
}

export function estimateProcessingTime(input: {
  durationSec: number | null;
  source: ProcessingSource;
  fileSizeMb?: number;
}): ProcessingTimeEstimate {
  let durationSec = input.durationSec;

  if (durationSec == null || durationSec <= 0) {
    const sizeGuess =
      input.fileSizeMb != null && input.fileSizeMb > 0
        ? Math.min(12 * 60, Math.max(60, Math.round(input.fileSizeMb * 4)))
        : 3 * 60;
    durationSec = sizeGuess;
  }

  const downloadSec =
    input.source === "youtube" ? youtubeDownloadSec(durationSec) : 0;
  const analysisSec = coreAnalysisSec(durationSec);
  const expectedSec = downloadSec + analysisSec;
  const minSec = Math.round(expectedSec * 0.75);
  const maxSec = Math.round(expectedSec * 1.35);
  const tier = tierFromExpectedSec(expectedSec);
  const range = formatRange(minSec, maxSec);

  const headline =
    tier === "long"
      ? `Expect ${range} — long clips run rally detection, pose, and ball tracking on the server.`
      : tier === "moderate"
        ? `Expect ${range} for server analysis.`
        : `Usually ready in ${range}.`;

  const detail =
    input.source === "youtube"
      ? `Includes YouTube download on the server, then pose extraction (required) plus optional court/ball agents. Keep this tab open until processing finishes.`
      : `Upload saves your file, then the server runs pose extraction (required) plus optional court/ball agents. Keep this tab open until processing finishes.`;

  return {
    durationSec: input.durationSec,
    source: input.source,
    expectedSec,
    minSec,
    maxSec,
    tier,
    headline,
    detail,
  };
}

export function formatElapsedVsEstimate(
  elapsedSec: number,
  estimate: ProcessingTimeEstimate
): string {
  const elapsed = formatMinutes(elapsedSec);
  if (elapsedSec < estimate.minSec) {
    return `${elapsed} elapsed — still within the expected ${formatRange(estimate.minSec, estimate.maxSec)} window.`;
  }
  if (elapsedSec > estimate.maxSec) {
    return `${elapsed} elapsed — taking longer than usual; large matches can approach 45+ minutes.`;
  }
  return `${elapsed} elapsed — on track for ${formatRange(estimate.minSec, estimate.maxSec)} total.`;
}

/** Read duration from a local File via a temporary object URL. */
export function probeVideoFileDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.src = url;
  });
}
