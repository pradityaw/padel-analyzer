/**
 * Object storage helpers — no live bucket credentials required.
 * Run: tsx scripts/qa/object-storage.test.ts
 */
import {
  buildObjectStorageKey,
  getObjectStorageKeyPrefix,
  isCloudStorageKey,
  isObjectStorageConfigured,
} from "../../server/lib/objectStorage.js";

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

assert("isObjectStorageConfigured is false without env", () => {
  withEnv({}, () => {
    if (isObjectStorageConfigured()) {
      throw new Error("expected cloud storage to be disabled");
    }
  });
});

assert("buildObjectStorageKey uses uploads prefix and mp4 fallback", () => {
  withEnv({ OBJECT_STORAGE_KEY_PREFIX: "uploads" }, () => {
    const key = buildObjectStorageKey("clip.mov");
    if (!key.startsWith("uploads/")) {
      throw new Error(`expected uploads/ prefix, got ${key}`);
    }
    if (!key.endsWith(".mov")) {
      throw new Error("expected original extension to be preserved");
    }
    const generic = buildObjectStorageKey("no-extension");
    if (!generic.endsWith(".mp4")) {
      throw new Error("expected .mp4 fallback extension");
    }
  });
});

assert("isCloudStorageKey respects prefix when configured", () => {
  withEnv(
    {
      OBJECT_STORAGE_BUCKET: "padel",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_KEY_PREFIX: "uploads",
    },
    () => {
      if (!isCloudStorageKey("uploads/abc.mp4")) {
        throw new Error("expected cloud key detection");
      }
      if (isCloudStorageKey("upload_local.mp4")) {
        throw new Error("legacy local keys must not be treated as cloud");
      }
      if (getObjectStorageKeyPrefix() !== "uploads") {
        throw new Error("prefix mismatch");
      }
    }
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All object storage unit checks passed.");
