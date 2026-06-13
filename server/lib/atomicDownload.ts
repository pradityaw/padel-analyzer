import { existsSync } from "fs";
import { rename, unlink } from "fs/promises";

/**
 * Download to `destPath` only when the file is missing.
 * Writes via a unique temp path and renames atomically so concurrent callers
 * never corrupt the destination with overlapping writes.
 */
export async function downloadToFileIfMissing(
  destPath: string,
  download: (tempPath: string) => Promise<void>
): Promise<void> {
  if (existsSync(destPath)) return;

  const tempPath = `${destPath}.part-${process.pid}-${Date.now()}`;
  try {
    await download(tempPath);
    try {
      await rename(tempPath, destPath);
    } catch (renameErr) {
      // Another worker may have finished first and already created destPath.
      if (existsSync(destPath)) {
        await unlink(tempPath).catch(() => {});
        return;
      }
      throw renameErr;
    }
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
