import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers/index.js";
import type {
  CompleteUploadInput,
  InitiateUploadResponse,
} from "@shared/schema";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@shared/config";

type UploadProgress = {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  mode: "stream" | "xhr" | "cloud-single" | "cloud-multipart";
};

type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

type UploadResponse = {
  storageKey: string;
};

type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

const CRLF = "\r\n";

/**
 * Mirrors `mobile/src/lib/api.ts` so web uploads surface the same actionable
 * errors when gateways return HTML/text or JSON bodies omit `error`.
 */
function describeUploadFailure(
  status: number,
  rawBody: string,
  jsonError?: string,
): string {
  const fromJson = jsonError?.trim();
  if (fromJson) return fromJson;

  const trimmed = rawBody.trim();
  if (trimmed.length > 0) {
    if (/<!DOCTYPE\b|<html\b/i.test(trimmed)) {
      return `Upload endpoint returned HTML (HTTP ${status}) instead of JSON—often a proxy, auth page, or wrong API origin. Serve the SPA and POST /api/upload on the same host, or check reverse‑proxy timeouts and upload size limits.`;
    }
    const snippet = trimmed
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 280);
    if (snippet.length > 0) {
      return `Upload failed (HTTP ${status}): ${snippet}${trimmed.length > 280 ? "…" : ""}`;
    }
  }

  switch (status) {
    case 400:
      return "Upload rejected: no usable video reached the server. Try another clip, browser, or use YouTube.";
    case 413:
      return `Video exceeds the upload limit (${MAX_UPLOAD_MB} MB). Trim or re-encode the clip, then retry.`;
    case 502:
    case 503:
    case 504:
      return "Server or gateway unavailable. Is the analyzer running? If uploads go through nginx, verify its client_max_body_size matches the analyzer limit.";
    default:
      if (!Number.isFinite(status) || status === 0) {
        return "Network blocked or aborted the upload. Check connection, HTTPS errors, VPN, ad blockers, and that /api/upload is reachable.";
      }
      return `Upload failed (HTTP ${status}). Check Wi‑Fi, firewall, VPN, same-origin routing to /api, then retry.`;
  }
}

let trpcClient: ReturnType<typeof createTRPCProxyClient<AppRouter>> | null =
  null;

function getTrpcClient() {
  if (!trpcClient) {
    trpcClient = createTRPCProxyClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    });
  }
  return trpcClient;
}

function buildMultipartHeader(file: File, boundary: string): Uint8Array {
  const safeName = file.name.replace(/"/g, "%22");
  const type = file.type || "application/octet-stream";
  return new TextEncoder().encode(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${safeName}"${CRLF}` +
      `Content-Type: ${type}${CRLF}${CRLF}`
  );
}

function buildMultipartFooter(boundary: string): Uint8Array {
  return new TextEncoder().encode(`${CRLF}--${boundary}--${CRLF}`);
}

function supportsStreamingRequestBody(): boolean {
  if (typeof ReadableStream === "undefined" || typeof Request === "undefined") {
    return false;
  }

  let duplexAccessed = false;
  try {
    new Request("https://example.invalid", {
      method: "POST",
      body: new ReadableStream(),
      get duplex() {
        duplexAccessed = true;
        return "half";
      },
    } as RequestInitWithDuplex);
  } catch {
    return false;
  }
  return duplexAccessed;
}

function createStreamingMultipartBody(
  file: File,
  boundary: string,
  onProgress?: UploadOptions["onProgress"]
): ReadableStream<Uint8Array> {
  const header = buildMultipartHeader(file, boundary);
  const footer = buildMultipartFooter(boundary);
  const reader = file.stream().getReader();
  let loadedBytes = 0;
  let sentHeader = false;
  let sentFooter = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentHeader) {
        sentHeader = true;
        controller.enqueue(header);
        return;
      }

      const chunk = await reader.read();
      if (!chunk.done) {
        const value = chunk.value;
        loadedBytes += value.byteLength;
        onProgress?.({
          loadedBytes,
          totalBytes: file.size,
          percent: Math.min(100, Math.round((loadedBytes / file.size) * 100)),
          mode: "stream",
        });
        controller.enqueue(value);
        return;
      }

      if (!sentFooter) {
        sentFooter = true;
        controller.enqueue(footer);
        return;
      }

      controller.close();
    },
    cancel() {
      void reader.cancel();
    },
  });
}

async function parseUploadResponse(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  let jsonError: string | undefined;
  if (!response.ok) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error) jsonError = parsed.error;
    } catch {
      /* plain text / HTML proxy page */
    }
    throw new Error(describeUploadFailure(response.status, raw, jsonError));
  }
  try {
    const body = JSON.parse(raw) as Partial<UploadResponse>;
    if (typeof body.storageKey === "string" && body.storageKey) return body.storageKey;
    throw new Error(
      raw.trim().length === 0
        ? "Upload returned an empty body. Check proxies and routing to /api/upload."
        : "Upload succeeded but the server reply had no storage key.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("storage key")) throw err;
    if (err instanceof Error && err.message.includes("empty body")) throw err;
    throw new Error(describeUploadFailure(response.status, raw));
  }
}

async function uploadWithStreamingFetch(
  file: File,
  options: UploadOptions
): Promise<string> {
  const boundary = `padel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = createStreamingMultipartBody(file, boundary, options.onProgress);
  const response = await fetch("/api/upload", {
    method: "POST",
    body,
    signal: options.signal,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    duplex: "half",
  } as RequestInitWithDuplex);
  const storageKey = await parseUploadResponse(response);
  options.onProgress?.({
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 100,
    mode: "stream",
  });
  return storageKey;
}

function uploadWithXhr(file: File, options: UploadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", file, file.name);

    const abort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener("abort", abort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.({
        loadedBytes: event.loaded,
        totalBytes: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
        mode: "xhr",
      });
    };

    xhr.onload = () => {
      options.signal?.removeEventListener("abort", abort);
      const raw = xhr.responseText ?? "";
      if (xhr.status < 200 || xhr.status >= 300) {
        let jsonError: string | undefined;
        try {
          const parsed = JSON.parse(raw || "{}") as { error?: unknown };
          if (typeof parsed.error === "string" && parsed.error)
            jsonError = parsed.error;
        } catch {
          /* proxy HTML / plaintext */
        }
        reject(new Error(describeUploadFailure(xhr.status, raw, jsonError)));
        return;
      }
      try {
        const body = JSON.parse(raw || "{}") as Partial<UploadResponse>;
        if (typeof body.storageKey === "string" && body.storageKey) {
          resolve(body.storageKey);
          return;
        }
        reject(
          new Error(
            raw.trim().length === 0
              ? "Upload returned an empty body. Check proxies and routing to /api/upload."
              : "Upload succeeded but the server reply had no storage key.",
          ),
        );
        return;
      } catch {
        reject(new Error(describeUploadFailure(xhr.status, raw)));
      }
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(
        new Error(
          describeUploadFailure(0, "", undefined),
        ),
      );
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", abort);
    };

    xhr.open("POST", "/api/upload");
    xhr.send(form);
  });
}

function putWithProgress(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  options: UploadOptions,
  mode: UploadProgress["mode"],
  loadedOffset = 0,
  totalBytes?: number
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const abort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };

    if (options.signal?.aborted) {
      abort();
      return;
    }

    options.signal?.addEventListener("abort", abort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !totalBytes) return;
      const loadedBytes = loadedOffset + event.loaded;
      options.onProgress?.({
        loadedBytes,
        totalBytes,
        percent: Math.min(100, Math.round((loadedBytes / totalBytes) * 100)),
        mode,
      });
    };

    xhr.onload = () => {
      options.signal?.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Cloud upload failed (HTTP ${xhr.status}).`));
        return;
      }
      const etag = xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag");
      resolve(etag?.replaceAll('"', "") ?? undefined);
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error("Network error while uploading to object storage."));
    };

    xhr.open("PUT", url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.send(body);
  });
}

async function uploadSingleToCloud(
  file: File,
  plan: Extract<InitiateUploadResponse, { mode: "single" }>,
  options: UploadOptions
): Promise<string> {
  await putWithProgress(
    plan.uploadUrl,
    file,
    plan.headers,
    options,
    "cloud-single",
    0,
    file.size
  );
  options.onProgress?.({
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 100,
    mode: "cloud-single",
  });
  return plan.storageKey;
}

const MULTIPART_UPLOAD_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker()
  );
  await Promise.all(workers);
  return results;
}

async function uploadMultipartToCloud(
  file: File,
  plan: Extract<InitiateUploadResponse, { mode: "multipart" }>,
  options: UploadOptions
): Promise<string> {
  const completedParts = await mapWithConcurrency(
    plan.parts,
    MULTIPART_UPLOAD_CONCURRENCY,
    async (part) => {
      const start = (part.partNumber - 1) * plan.partSize;
      const end = Math.min(start + plan.partSize, file.size);
      const chunk = file.slice(start, end);
      const etag = await putWithProgress(
        part.uploadUrl,
        chunk,
        {},
        options,
        "cloud-multipart",
        start,
        file.size
      );
      if (!etag) {
        throw new Error(`Missing ETag for multipart part ${part.partNumber}.`);
      }
      return { partNumber: part.partNumber, etag, end };
    }
  );

  completedParts.sort((a, b) => a.partNumber - b.partNumber);
  const loadedBytes = completedParts.reduce(
    (max, part) => Math.max(max, part.end),
    0
  );
  options.onProgress?.({
    loadedBytes,
    totalBytes: file.size,
    percent: Math.min(100, Math.round((loadedBytes / file.size) * 100)),
    mode: "cloud-multipart",
  });

  const parts: NonNullable<CompleteUploadInput["parts"]> = completedParts.map(
    ({ partNumber, etag }) => ({ partNumber, etag })
  );

  const client = getTrpcClient();
  const completed = await client.objectStorage.completeUpload.mutate({
    storageKey: plan.storageKey,
    contentLength: file.size,
    uploadId: plan.uploadId,
    parts,
  });
  return completed.storageKey;
}

/** POST to `/api/upload` — prefer XHR (max compatibility); streaming fetch first caused empty/failed parses on Safari, WebViews, and some reverse proxies. */
async function uploadViaLocalMultipartEndpoint(
  file: File,
  options: UploadOptions
): Promise<string> {
  try {
    return await uploadWithXhr(file, options);
  } catch (xhrError) {
    if (supportsStreamingRequestBody()) {
      try {
        return await uploadWithStreamingFetch(file, options);
      } catch {
        // Fall through — surface the primary XHR failure (better messaging than duplex/network noise).
      }
    }
    throw xhrError;
  }
}

async function uploadToCloudStorage(
  file: File,
  options: UploadOptions
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Video exceeds the configured upload size limit.");
  }

  const client = getTrpcClient();
  const plan = await client.objectStorage.initiateUpload.mutate({
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    contentLength: file.size,
  });

  if (plan.mode === "local") {
    return uploadViaLocalMultipartEndpoint(file, options);
  }

  if (plan.mode === "single") {
    const storageKey = await uploadSingleToCloud(file, plan, options);
    await client.objectStorage.completeUpload.mutate({
      storageKey,
      contentLength: file.size,
    });
    return storageKey;
  }

  return uploadMultipartToCloud(file, plan, options);
}

async function uploadToLocalServer(
  file: File,
  options: UploadOptions
): Promise<string> {
  return uploadViaLocalMultipartEndpoint(file, options);
}

/**
 * Upload a mobile video without materialising it as an ArrayBuffer.
 *
 * When object storage is configured on the server, streams directly to a
 * presigned bucket URL. Otherwise falls back to the legacy `/api/upload` path.
 */
export async function uploadVideoForAnalysis(
  file: File,
  options: UploadOptions = {}
): Promise<string> {
  try {
    const capabilities = await getTrpcClient().objectStorage.getCapabilities.query();
    if (capabilities.mode === "cloud") {
      return uploadToCloudStorage(file, options);
    }
  } catch {
    // Server may be older or offline during capability probe — try local path.
  }
  return uploadToLocalServer(file, options);
}
