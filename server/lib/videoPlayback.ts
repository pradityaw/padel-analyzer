import { existsSync } from "fs";
import type { Response } from "express";
import {
  createPresignedGetUrl,
  isCloudStorageKey,
  isObjectStorageConfigured,
} from "./objectStorage.js";
import { resolveLocalVideoPath } from "./videoAccess.js";

const PRESIGN_PLAYBACK_TTL_SEC = Number(
  process.env.OBJECT_STORAGE_PLAYBACK_TTL_SEC || 3600
);

/**
 * Stream a local upload or redirect to a presigned cloud object URL.
 */
export async function serveVideoPlayback(
  storageKey: string,
  res: Response
): Promise<void> {
  const key = storageKey.trim();
  if (!key) {
    res.status(400).json({ error: "Missing video storage key." });
    return;
  }

  if (isCloudStorageKey(key) && isObjectStorageConfigured()) {
    const url = await createPresignedGetUrl(key, PRESIGN_PLAYBACK_TTL_SEC);
    res.redirect(302, url);
    return;
  }

  let localPath: string;
  try {
    localPath = resolveLocalVideoPath(key);
  } catch {
    res.status(400).json({ error: "Invalid video storage key." });
    return;
  }

  if (!existsSync(localPath)) {
    res.status(404).json({ error: "Video file not found." });
    return;
  }

  res.sendFile(localPath);
}
