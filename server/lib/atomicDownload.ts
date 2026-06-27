import { existsSync } from "fs";
import { rename, unlink } from "fs/promises";

const inFlight = new Map<string, Promise<void>>();

/**
 * Download to `destPath` exactly once per destination, even under concurrent
 * callers. Writes to a temp file first, then atomically renames into place.
 */
export async function downloadToFileAtomic(
  destPath: string,
  download: (tempPath: string) => Promise<void>
): Promise<void> {
  if (existsSync(destPath)) return;

  const existing = inFlight.get(destPath);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    if (existsSync(destPath)) return;

    const tempPath = `${destPath}.part-${process.pid}-${Date.now()}`;
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

  inFlight.set(destPath, promise);
  try {
    await promise;
  } finally {
    inFlight.delete(destPath);
  }
}

/** @internal Test hook — clears in-flight download locks. */
export function resetAtomicDownloadLocksForTests(): void {
  inFlight.clear();
}
