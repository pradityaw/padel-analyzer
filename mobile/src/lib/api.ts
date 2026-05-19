import type { DocumentPickerAsset } from "expo-document-picker";
import { API_BASE_URL } from "./config";
import { trpc } from "./trpc";
import type {
  AnalysisDetail,
  AnalysisJob,
  AnalysisListResponse,
} from "./types";

type UploadResponse = {
  storageKey: string;
};

function readUploadFailureMessage(status: number, bodyText: string, jsonError?: string) {
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
      /* fall through — use plain text handling */
    }
  }
  return readUploadFailureMessage(response.status, raw);
}

export async function uploadVideoAsset(asset: DocumentPickerAsset) {
  const fileName = asset.name || "swing.mp4";
  const form = new FormData();
  form.append("file", {
    uri: asset.uri,
    name: fileName,
    type: asset.mimeType || "video/mp4",
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
        (/network/i.test(err.message) || err.message === "Network request failed"));
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
}) {
  return (await trpc.mutation("mobileAnalysis.create", input)) as AnalysisJob;
}

export async function getMobileAnalysisJob(jobId: number) {
  return (await trpc.query("mobileAnalysis.getById", { id: jobId })) as
    | AnalysisJob
    | null;
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
