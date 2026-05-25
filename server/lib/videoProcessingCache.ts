import { createWriteStream, existsSync } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import {
  createPresignedGetUrl,
  isCloudStorageKey,
  isObjectStorageConfigured,
} from "./objectStorage.js";
import { getDataRoot } from "./paths.js";
import { resolveLocalVideoPath } from "./videoAccess.js";

const cacheDir = () => path.join(getDataRoot(), "processing-cache");

function cachePathForKey(storageKey: string): string {
  const safe = storageKey.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return path.join(cacheDir(), safe);
}

async function downloadCloudObjectToFile(
  storageKey: string,
  destination: string
): Promise<void> {
  const url = await createPresignedGetUrl(storageKey);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download video from object storage (HTTP ${response.status}).`
    );
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(destination));
}

/**
 * Returns a stable local filesystem path for CV/Python workers.
 * Cloud objects are downloaded once per storage key and reused from cache.
 */
export async function ensureLocalVideoPath(storageKey: string): Promise<string> {
  if (!isCloudStorageKey(storageKey) || !isObjectStorageConfigured()) {
    return resolveLocalVideoPath(storageKey);
  }

  const cached = cachePathForKey(storageKey);
  if (existsSync(cached)) {
    const info = await stat(cached);
    if (info.size > 0) return cached;
  }

  await mkdir(cacheDir(), { recursive: true });
  const tempPath = `${cached}.part-${Date.now()}`;
  try {
    await downloadCloudObjectToFile(storageKey, tempPath);
    await rename(tempPath, cached);
    return cached;
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        await unlink(tempPath);
      }
    } catch {
      /* ignore cleanup errors */
    }
    throw error;
  }
}
