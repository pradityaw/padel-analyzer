/**
 * Regression tests for critical server correctness fixes.
 * Run: tsx scripts/qa/critical-fixes.test.ts
 */
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
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
    if (source.includes("express.json({ limit: `${MAX_UPLOAD_MB}mb` })")) {
      throw new Error("express.json must not use the video upload cap");
    }
    if (!source.includes("express.json({ limit: MAX_JSON_BODY_BYTES })")) {
      throw new Error("express.json should use MAX_JSON_BODY_BYTES");
    }
    if (slackIdx > jsonIdx) {
      throw new Error(
        "registerSlackFeedbackRoutes must be called before express.json for HMAC raw-body verify",
      );
    }
  },
);

await assert("deleteAnalysisArtifacts rolls back DB deletes if analysis row delete fails", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "padel-analysis-del-"));
  process.env.PADEL_DATA_DIR = dataDir;
  process.env.NODE_ENV = "test";

  const { ensureSchema } = await import("../../server/lib/ensureSchema.js");
  const { sqlite } = await import("../../server/db.js");
  const { db } = await import("../../server/db.js");
  const { analyses, feedback } = await import("../../drizzle/schema.js");
  const { deleteAnalysisArtifacts } = await import("../../server/lib/analysisCleanup.js");

  ensureSchema();

  const row = db
    .insert(analyses)
    .values({
      userId: null,
      videoFileName: "orphan-test.mp4",
      overallScore: 70,
      dominantSide: "right",
      durationMs: 1000,
      frameCount: 10,
      sampleFps: 15,
      phasesJson: "[]",
      landmarksJson: "[]",
    })
    .returning()
    .get();
  if (!row) throw new Error("expected analysis insert");

  db.insert(feedback)
    .values({ analysisId: row.id, userId: null, rating: 5, comment: "x" })
    .run();

  const originalPrepare = sqlite.prepare.bind(sqlite) as typeof sqlite.prepare;
  let failNextAnalysesDelete = true;
  sqlite.prepare = ((source: string) => {
    if (
      failNextAnalysesDelete &&
      /delete\s+from\s+"analyses"/i.test(source.replace(/\s+/g, " "))
    ) {
      failNextAnalysesDelete = false;
      throw new Error("simulated analysis delete failure");
    }
    return originalPrepare(source);
  }) as typeof sqlite.prepare;

  try {
    deleteAnalysisArtifacts(row.id);
    throw new Error("expected deleteAnalysisArtifacts to throw");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("simulated analysis delete failure")) {
      throw err;
    }
  } finally {
    sqlite.prepare = originalPrepare;
  }

  const analysisStill = db.select().from(analyses).where(eq(analyses.id, row.id)).get();
  const feedbackStill = db.select().from(feedback).where(eq(feedback.analysisId, row.id)).get();
  if (!analysisStill || !feedbackStill) {
    throw new Error("expected analysis and feedback to remain after failed transaction");
  }

  deleteAnalysisArtifacts(row.id);
  const analysisAfter = db.select().from(analyses).where(eq(analyses.id, row.id)).get();
  const feedbackAfter = db.select().from(feedback).where(eq(feedback.analysisId, row.id)).get();
  if (analysisAfter || feedbackAfter) {
    throw new Error("expected full delete after successful retry");
  }

  await rm(dataDir, { recursive: true, force: true });
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All critical-fixes checks passed.");
