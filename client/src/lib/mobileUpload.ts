import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers/index.js";
import type {
  CompleteUploadInput,
  InitiateUploadResponse,
} from "@shared/schema";
import { MAX_UPLOAD_BYTES } from "@shared/config";

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
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ?? "Failed to save video on server"
    );
  }
  const body = (await response.json()) as UploadResponse;
  return body.storageKey;
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
  options.onProgress?.({
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 100,
    mode: "stream",
  });
  return parseUploadResponse(response);
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
      try {
        const body = JSON.parse(xhr.responseText || "{}") as Partial<UploadResponse> & {
          error?: string;
        };
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(body.error ?? "Failed to save video on server"));
          return;
        }
        if (!body.storageKey) {
          reject(new Error("Upload completed without a storage key."));
          return;
        }
        resolve(body.storageKey);
      } catch {
        reject(new Error("Upload response was not valid JSON."));
      }
    };

    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error("Network error while uploading video."));
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
    if (supportsStreamingRequestBody()) {
      return uploadWithStreamingFetch(file, options);
    }
    return uploadWithXhr(file, options);
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
  if (supportsStreamingRequestBody()) {
    return uploadWithStreamingFetch(file, options);
  }
  return uploadWithXhr(file, options);
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
