import { existsSync } from "fs";
import path from "path";
import { assertObjectExists, isCloudStorageKey } from "./objectStorage.js";
import { ensureLocalVideoPath } from "./videoProcessingCache.js";
import { getUploadsDir } from "./paths.js";

export function resolveLocalVideoPath(storageKey: string): string {
  if (path.isAbsolute(storageKey)) {
    throw new Error("videoStorageKey must be a relative upload key.");
  }
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(uploadsDir, storageKey);
  if (!resolved.startsWith(`${uploadsDir}${path.sep}`) && resolved !== uploadsDir) {
    throw new Error("videoStorageKey must stay inside uploads.");
  }
  return resolved;
}

export async function assertVideoAccessible(
  storageKey: string,
  expectedSize?: number
): Promise<void> {
  if (isCloudStorageKey(storageKey)) {
    await assertObjectExists(storageKey, expectedSize);
    return;
  }

  const localPath = resolveLocalVideoPath(storageKey);
  if (!existsSync(localPath)) {
    throw new Error("Uploaded video could not be found on the server.");
  }
}

/**
 * Returns a local filesystem path for Python/OpenCV (cloud objects are cached once).
 */
export async function resolveVideoUriForProcessing(
  storageKey: string
): Promise<string> {
  return ensureLocalVideoPath(storageKey);
}
