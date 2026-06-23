/**
 * Atomic download dedup + temp/rename semantics.
 * Run: tsx scripts/qa/atomic-download.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import {
  downloadToFileAtomic,
  resetAtomicDownloadLocksForTests,
} from "../../server/lib/atomicDownload.js";

function assert(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok ${name}`))
    .catch((err) => {
      console.error(`FAIL ${name}:`, err);
      process.exitCode = 1;
    });
}

async function main() {
  await assert("concurrent callers invoke download once", async () => {
    resetAtomicDownloadLocksForTests();
    const dir = await mkdtemp(path.join(tmpdir(), "atomic-dl-"));
    const dest = path.join(dir, "video.mp4");
    let calls = 0;

    const download = async (tempPath: string) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      await writeFile(tempPath, "payload");
    };

    await Promise.all([
      downloadToFileAtomic(dest, download),
      downloadToFileAtomic(dest, download),
      downloadToFileAtomic(dest, download),
    ]);

    if (calls !== 1) {
      throw new Error(`expected 1 download, got ${calls}`);
    }
    if (!existsSync(dest)) {
      throw new Error("expected final file to exist");
    }
    const body = await readFile(dest, "utf8");
    if (body !== "payload") {
      throw new Error("expected atomic rename to place payload");
    }
    await rm(dir, { recursive: true, force: true });
  });

  await assert("skips download when destination already exists", async () => {
    resetAtomicDownloadLocksForTests();
    const dir = await mkdtemp(path.join(tmpdir(), "atomic-dl-"));
    const dest = path.join(dir, "existing.mp4");
    await writeFile(dest, "cached");
    let calls = 0;

    await downloadToFileAtomic(dest, async () => {
      calls += 1;
    });

    if (calls !== 0) {
      throw new Error(`expected 0 downloads, got ${calls}`);
    }
    await rm(dir, { recursive: true, force: true });
  });
}

main();
