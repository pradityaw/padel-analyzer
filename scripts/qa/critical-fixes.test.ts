/**
 * Regression tests for critical server correctness fixes.
 * Run: tsx scripts/qa/critical-fixes.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { downloadOnceToFile } from "../../server/lib/atomicDownload.js";
import { resolveVideoPlaybackUrl } from "../../server/lib/videoAccess.js";
import { isCloudStorageKey } from "../../server/lib/objectStorage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function assert(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL ${name}:`, err);
      process.exitCode = 1;
    });
}

const originalEnv = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OBJECT_STORAGE_")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env = { ...originalEnv };
    });
}

await assert("downloadOnceToFile dedupes concurrent writers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "atomic-dl-"));
  const dest = path.join(dir, "clip.mp4");
  let active = 0;
  let maxActive = 0;

  const download = async (tempPath: string) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 40));
    await writeFile(tempPath, "video-bytes");
    active -= 1;
  };

  await Promise.all([
    downloadOnceToFile("dedupe-key", dest, download),
    downloadOnceToFile("dedupe-key", dest, download),
  ]);

  if (!existsSync(dest)) {
    throw new Error("expected final file to exist");
  }
  const body = await readFile(dest, "utf8");
  if (body !== "video-bytes") {
    throw new Error("unexpected file contents");
  }
  if (maxActive > 1) {
    throw new Error(`expected single in-flight download, saw ${maxActive}`);
  }
  await rm(dir, { recursive: true, force: true });
});

await assert("resolveVideoPlaybackUrl returns static path when cloud disabled", async () => {
  await withEnv({}, async () => {
    const url = await resolveVideoPlaybackUrl("upload_123.mp4");
    if (url !== "/uploads/upload_123.mp4") {
      throw new Error(`unexpected playback url: ${url}`);
    }
  });
});

await assert("cloud storage keys are detected for playback routing", async () => {
  await withEnv(
    {
      OBJECT_STORAGE_BUCKET: "padel",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_KEY_PREFIX: "uploads",
    },
    () => {
      if (!isCloudStorageKey("uploads/abc123.mp4")) {
        throw new Error("expected uploads/ key to be cloud");
      }
    }
  );
});

await assert(
  "Slack feedback routes register before express.json in server entry",
  async () => {
    const indexPath = path.join(repoRoot, "server/_core/index.ts");
    const source = await readFile(indexPath, "utf8");
    const slackIdx = source.indexOf("registerSlackFeedbackRoutes(app)");
    const jsonIdx = source.indexOf("app.use(express.json(");
    if (slackIdx === -1) {
      throw new Error("registerSlackFeedbackRoutes(app) missing from server/_core/index.ts");
    }
    if (jsonIdx === -1) {
      throw new Error("express.json middleware missing from server/_core/index.ts");
    }
    if (slackIdx > jsonIdx) {
      throw new Error(
        "registerSlackFeedbackRoutes must be called before express.json for HMAC raw-body verify",
      );
    }
  },
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All critical-fixes checks passed.");
