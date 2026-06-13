/**
 * Atomic download helper — no network or yt-dlp required.
 * Run: tsx scripts/qa/atomic-download.test.ts
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import { downloadToFileIfMissing } from "../../server/lib/atomicDownload.js";

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "padel-atomic-download-"));

function tempFile(name: string): string {
  const dir = path.join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "video.mp4");
}

async function assert(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

async function main() {
  await assert("skips download when destination already exists", async () => {
    const dest = tempFile("exists");
    writeFileSync(dest, "cached");

    let downloads = 0;
    await downloadToFileIfMissing(dest, async () => {
      downloads += 1;
      throw new Error("should not download");
    });

    if (downloads !== 0) {
      throw new Error("expected zero download attempts");
    }
    if (readFileSync(dest, "utf8") !== "cached") {
      throw new Error("existing file was modified");
    }
  });

  await assert("writes via temp path and renames to destination", async () => {
    const dest = tempFile("fresh");
    if (existsSync(dest)) {
      rmSync(dest);
    }

    await downloadToFileIfMissing(dest, async (tempPath) => {
      if (tempPath === dest) {
        throw new Error("download must target a temp path");
      }
      writeFileSync(tempPath, "complete-video");
    });

    if (readFileSync(dest, "utf8") !== "complete-video") {
      throw new Error("destination file missing expected contents");
    }
  });

  await assert("concurrent callers never write the destination path directly", async () => {
    const dest = tempFile("concurrent");
    if (existsSync(dest)) {
      rmSync(dest);
    }

    const writtenPaths: string[] = [];

    await Promise.all(
      Array.from({ length: 6 }, () =>
        downloadToFileIfMissing(dest, async (tempPath) => {
          writtenPaths.push(tempPath);
          if (tempPath === dest) {
            throw new Error("must not write directly to dest");
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
          writeFileSync(tempPath, "race-safe");
        })
      )
    );

    if (writtenPaths.some((p) => p === dest)) {
      throw new Error("destination path was written directly");
    }
    if (readFileSync(dest, "utf8") !== "race-safe") {
      throw new Error("final file contents missing after concurrent download");
    }
  });
}

void main();
