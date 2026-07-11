import { existsSync } from "fs";
import { rename, unlink } from "fs/promises";
import { randomBytes } from "crypto";

const inFlight = new Map<string, Promise<void>>();

/**
 * Deduplicates concurrent downloads of the same logical asset and writes via
 * temp file + rename so partial yt-dlp output is never served as complete.
 */
export async function downloadOnceToFile(
  dedupeKey: string,
  destPath: string,
  download: (tempPath: string) => Promise<void>
): Promise<void> {
  if (existsSync(destPath)) return;

  const existing = inFlight.get(dedupeKey);
  if (existing) {
    await existing;
    if (!existsSync(destPath)) {
      throw new Error(
        "Concurrent download finished without producing the expected file."
      );
    }
    return;
  }

  const promise = (async () => {
    const tempPath = `${destPath}.part-${randomBytes(6).toString("hex")}`;
    try {
      await download(tempPath);
      await rename(tempPath, destPath);
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
  })();

  inFlight.set(dedupeKey, promise);
  try {
    await promise;
  } finally {
    inFlight.delete(dedupeKey);
  }
}
