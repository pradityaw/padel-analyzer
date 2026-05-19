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

async function parseFailedUploadResponse(response: Response): Promise<string | undefined> {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    const body = JSON.parse(raw) as { error?: string; message?: string };
    return body.error ?? body.message;
  } catch {
    return raw.trim().slice(0, 280);
  }
}

export async function uploadVideoAsset(asset: DocumentPickerAsset) {
  const fileName = asset.name || "swing.mp4";
  const form = new FormData();
  form.append("file", {
    uri: asset.uri,
    name: fileName,
    type: asset.mimeType || "video/mp4",
  } as any);

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const detail = await parseFailedUploadResponse(response).catch(() => undefined);
    throw new Error(
      detail?.trim()
        ? detail
        : `Upload failed (HTTP ${response.status}). Check Wi‑Fi and that the API at ${API_BASE_URL} is running.`,
    );
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
