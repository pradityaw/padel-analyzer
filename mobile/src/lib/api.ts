import { API_BASE_URL } from "./config";
import { trpc } from "./trpc";
import type { CourtCornersPayload } from "./courtCorners";
import type { RecordMode } from "./recordMode";
import type {
  AnalysisDetail,
  AnalysisJob,
  AnalysisListResponse,
  AuthSession,
  CvMatchResult,
  CvStatus,
  ProComparison,
} from "./types";

type UploadResponse = {
  storageKey: string;
};

// Mirror of MAX_UPLOAD_BYTES in shared/config.ts. The mobile app does not
// import from shared/ to preserve build independence (see mobile/CLAUDE.md).
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

/** Video source from Photos, Files, or in-app camera — not tied to DocumentPicker. */
export type UploadVideoInput = {
  uri: string;
  name?: string;
  size?: number;
  mimeType?: string;
};

function readUploadFailureMessage(
  status: number,
  bodyText: string,
  jsonError?: string
) {
  if (jsonError) return jsonError;
  const trimmed = bodyText.trim();
  if (trimmed.length > 0) {
    return `Upload failed (HTTP ${status}): ${trimmed.slice(0, 280)}`;
  }
  switch (status) {
    case 400:
      return "Upload rejected: no usable video file reached the server. Try another clip or Browse Files.";
    case 413:
      return "Video is too large for the server upload limit.";
    case 503:
      return "Server unavailable. Is the analyzer running on this machine?";
    default:
      return `Upload failed (HTTP ${status}). Check API URL and Wi‑Fi, then retry.`;
  }
}

async function parseFailedUploadResponse(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") && raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error) {
        return readUploadFailureMessage(response.status, raw, parsed.error);
      }
    } catch {
      /* fall through */
    }
  }
  return readUploadFailureMessage(response.status, raw);
}

export async function uploadVideoAsset(input: UploadVideoInput) {
  const fileName = input.name || `swing-${Date.now()}.mp4`;

  if (typeof input.size === "number" && input.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large. Maximum ${MAX_UPLOAD_MB} MB.`);
  }

  const form = new FormData();
  form.append("file", {
    uri: input.uri,
    name: fileName,
    type: input.mimeType || "video/mp4",
  } as any);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    const isNetworkIssue =
      err instanceof TypeError ||
      (err instanceof Error &&
        (/network/i.test(err.message) ||
          err.message === "Network request failed"));
    if (isNetworkIssue) {
      throw new Error(
        `Could not reach analysis server at ${API_BASE_URL}. Same Wi‑Fi as your computer, correct IP/port, firewall off for 3001, and on iOS allow Local Network for this app.`
      );
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(await parseFailedUploadResponse(response));
  }

  const uploaded = (await response.json()) as UploadResponse;
  return {
    videoFileName: fileName,
    videoStorageKey: uploaded.storageKey,
  };
}

export async function createMobileAnalysisJob(input: {
  videoFileName: string;
  videoStorageKey: string;
  courtCorners?: CourtCornersPayload;
  mode?: RecordMode;
}) {
  return (await trpc.mutation("mobileAnalysis.create", input)) as AnalysisJob;
}

export async function getMobileAnalysisJob(jobId: number) {
  return (await trpc.query("mobileAnalysis.getProgress", { id: jobId })) as
    | AnalysisJob
    | null;
}

export async function retryMobileAnalysisJob(jobId: number) {
  return (await trpc.mutation("mobileAnalysis.retry", { id: jobId })) as AnalysisJob;
}

export async function listRecentAnalyses() {
  return (await trpc.query("analysis.list", {
    limit: 20,
  })) as AnalysisListResponse;
}

export async function getAnalysisById(analysisId: number) {
  return (await trpc.query("analysis.getById", { id: analysisId })) as
    | AnalysisDetail
    | null;
}

export async function getCvStatus(analysisId: number) {
  try {
    return (await trpc.query("analysis.getCvStatus", { id: analysisId })) as {
      cvStatus: CvStatus | null;
      cvResult: CvMatchResult | null;
    };
  } catch {
    return { cvStatus: null, cvResult: null };
  }
}

export async function triggerCvPipeline(analysisId: number) {
  try {
    return (await trpc.mutation("analysis.triggerCvPipeline", {
      analysisId,
    })) as { status: CvStatus };
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Match analysis is not available on this server build."
    );
  }
}

export async function deleteAnalysis(analysisId: number) {
  return (await trpc.mutation("analysis.delete", { id: analysisId })) as {
    success: boolean;
  };
}

export async function getSession(): Promise<AuthSession> {
  try {
    return (await trpc.query("auth.getSession")) as AuthSession;
  } catch {
    return { authMode: "off", user: null };
  }
}

export async function requestMagicLink(email: string) {
  try {
    return (await trpc.mutation("auth.requestMagicLink", { email })) as {
      ok: true;
      devMagicLinkUrl?: string;
    };
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Sign-in is not available on this server build."
    );
  }
}

export async function logout() {
  try {
    return (await trpc.mutation("auth.logout")) as { ok: true };
  } catch {
    return { ok: true as const };
  }
}

export async function listProComparisons() {
  return (await trpc.query("proCompare.list")) as ProComparison[];
}
