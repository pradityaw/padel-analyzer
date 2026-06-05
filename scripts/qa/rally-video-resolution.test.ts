/**
 * Rally detection must resolve cloud object keys via processing cache, not
 * a naive uploads/ join (which always misses for keys like uploads/<id>.mp4).
 *
 * Run: tsx scripts/qa/rally-video-resolution.test.ts
 */
import path from "path";
import {
  isCloudStorageKey,
  isObjectStorageConfigured,
} from "../../server/lib/objectStorage.js";
import { resolveLocalVideoPath } from "../../server/lib/videoAccess.js";
import { resolveVideoPathForRallyDetection } from "../../server/lib/rallyDetection.js";
import { getUploadsDir } from "../../server/lib/paths.js";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

const originalEnv = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OBJECT_STORAGE_")) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, overrides);
  try {
    fn();
  } finally {
    process.env = { ...originalEnv };
  }
}

assert("cloud keys are not found via resolveLocalVideoPath alone", () => {
  withEnv(
    {
      OBJECT_STORAGE_BUCKET: "padel",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_KEY_PREFIX: "uploads",
    },
    () => {
      const key = "uploads/abc123.mp4";
      if (!isObjectStorageConfigured() || !isCloudStorageKey(key)) {
        throw new Error("expected cloud storage key detection");
      }
      const uploadsDir = path.resolve(getUploadsDir());
      const naiveLocal = resolveLocalVideoPath(key);
      const doubleNested = path.join(uploadsDir, key);
      if (naiveLocal !== doubleNested) {
        throw new Error("unexpected local path mapping for cloud key");
      }
      const segments = naiveLocal.split(path.sep);
      const uploadsCount = segments.filter((part) => part === "uploads").length;
      if (uploadsCount < 2) {
        throw new Error(
          `legacy join should nest uploads prefix twice, got: ${naiveLocal}`
        );
      }
    }
  );
});

async function runAsyncChecks(): Promise<void> {
  const resolved = await resolveVideoPathForRallyDetection(null);
  if (resolved !== null) {
    throw new Error("expected null when analysis has no video reference");
  }
  console.log("ok resolveVideoPathForRallyDetection returns null when no video ref");
}

runAsyncChecks()
  .then(() => {
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
    console.log("All rally video resolution checks passed.");
  })
  .catch((err) => {
    console.error("FAIL async rally resolution checks:", err);
    process.exit(1);
  });
