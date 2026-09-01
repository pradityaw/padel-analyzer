/**
 * Two-user isolation: B cannot list/get/delete A's analysis when AUTH_MODE=on.
 * Run via npm run test:contracts.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "padel-auth-iso-"));
process.env.PADEL_DATA_DIR = dataDir;
process.env.AUTH_MODE = "on";
process.env.AUTH_ADMIN_EMAIL = "admin@isolation.test";
process.env.NODE_ENV = "test";

const { ensureSchema } = await import("../../server/lib/ensureSchema.js");
const { db } = await import("../../server/db.js");
const { appRouter } = await import("../../server/routers/index.js");
const { analyses, proComparisons } = await import("../../drizzle/schema.js");
const { getOrCreateUserByEmail } = await import("../../server/lib/sessionAuth.js");
const { canReadUploadFile } = await import("../../server/lib/uploadAccess.js");
const { getUploadsDir } = await import("../../server/lib/paths.js");
const { deleteAnalysisArtifacts } = await import("../../server/lib/analysisCleanup.js");

ensureSchema();

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

function stubCtx(user: { id: number; email: string }) {
  return {
    req: { ip: "127.0.0.1" },
    res: { setHeader() {} },
    user,
    authMode: "on" as const,
    sessionToken: "test-session",
  };
}

function isNotFound(err: unknown): boolean {
  return err instanceof TRPCError && err.code === "NOT_FOUND";
}

const createPayload = {
  overallScore: 70,
  dominantSide: "right" as const,
  durationMs: 1000,
  frameCount: 15,
  sampleFps: 15,
  phasesJson: "[]",
  landmarksJson: JSON.stringify([
    {
      frameIndex: 0,
      timestamp: 0,
      landmarks: [{ x: 0, y: 0, z: 0, visibility: 1 }],
    },
  ]),
};

function insertOwnedRow(
  userId: number,
  videoFileName: string,
  videoStorageKey?: string,
) {
  const row = db
    .insert(analyses)
    .values({
      userId,
      videoFileName,
      videoStorageKey: videoStorageKey ?? null,
      overallScore: 71,
      dominantSide: "right",
      durationMs: 2000,
      frameCount: 30,
      sampleFps: 15,
      phasesJson: "[]",
      landmarksJson: "[]",
    })
    .returning()
    .get();
  if (!row) throw new Error("failed to insert analysis");
  return row;
}

const userA = getOrCreateUserByEmail("alice@isolation.test");
const userB = getOrCreateUserByEmail("bob@isolation.test");

const owned = db
  .insert(analyses)
  .values({
    userId: userA.id,
    videoFileName: "alice-swing.mp4",
    overallScore: 71,
    dominantSide: "right",
    durationMs: 2000,
    frameCount: 30,
    sampleFps: 15,
    phasesJson: "[]",
    landmarksJson: "[]",
  })
  .returning()
  .get();

if (!owned) {
  throw new Error("failed to insert Alice analysis");
}

const callerA = appRouter.createCaller(stubCtx(userA));
const callerB = appRouter.createCaller(stubCtx(userB));

await assert("B list does not include A's analysis", async () => {
  const listed = await callerB.analysis.list();
  if (listed.items.some((item) => item.id === owned.id)) {
    throw new Error("Bob listed Alice's analysis");
  }
});

await assert("A list includes own analysis", async () => {
  const listed = await callerA.analysis.list();
  if (!listed.items.some((item) => item.id === owned.id)) {
    throw new Error("Alice did not list her own analysis");
  }
});

await assert("B getById cannot read A's analysis", async () => {
  try {
    await callerB.analysis.getById({ id: owned.id });
    throw new Error("Bob got Alice's analysis");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
});

await assert("A getById returns own analysis", async () => {
  const row = await callerA.analysis.getById({ id: owned.id });
  if (!row || row.id !== owned.id) {
    throw new Error("Alice could not load her analysis");
  }
});

await assert("B delete cannot remove A's analysis", async () => {
  try {
    await callerB.analysis.delete({ id: owned.id });
    throw new Error("Bob deleted Alice's analysis");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  const still = db.select().from(analyses).where(eq(analyses.id, owned.id)).get();
  if (!still) throw new Error("Alice's row was deleted by Bob");
});

await assert("B getRallies cannot touch A's analysis", async () => {
  try {
    await callerB.analysis.getRallies({ analysisId: owned.id });
    throw new Error("Bob loaded Alice's rallies");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
});

const bobOwned = db
  .insert(analyses)
  .values({
    userId: userB.id,
    videoFileName: "bob-swing.mp4",
    overallScore: 60,
    dominantSide: "right",
    durationMs: 2000,
    frameCount: 30,
    sampleFps: 15,
    phasesJson: "[]",
    landmarksJson: "[]",
  })
  .returning()
  .get();
if (!bobOwned) throw new Error("failed to insert Bob analysis");

await assert("B cannot use A's analysis as proCompare proAnalysisId", async () => {
  try {
    await callerB.proCompare.create({
      playerAnalysisId: bobOwned.id,
      proAnalysisId: owned.id,
      shotType: "drive",
      gapAnalysisJson: "{}",
    });
    throw new Error("Bob compared against Alice's analysis");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
});

db.insert(proComparisons)
  .values({
    userId: userB.id,
    playerAnalysisId: bobOwned.id,
    proAnalysisId: owned.id,
    shotType: "drive",
    gapAnalysisJson: "{}",
  })
  .run();

await assert("B list/export does not leak A's filename or landmarks", async () => {
  const listed = await callerB.proCompare.list();
  if (listed.some((row) => row.proFileName === "alice-swing.mp4")) {
    throw new Error("Bob listed Alice's filename via proCompare");
  }
  const exported = await callerB.proCompare.exportPairedData();
  if (exported.pairs.some((pair) => pair.pro?.analysisId === owned.id)) {
    throw new Error("Bob exported Alice's landmarks via proCompare");
  }
});

await assert("B cannot read A's upload filename", async () => {
  if (canReadUploadFile(userB.id, "alice-swing.mp4")) {
    throw new Error("Bob canReadUploadFile Alice's clip");
  }
  if (!canReadUploadFile(userA.id, "alice-swing.mp4")) {
    throw new Error("Alice cannot read her own clip");
  }
});

await assert("A create accepts a display title with an owned storage key", async () => {
  const created = await callerA.analysis.create({
    ...createPayload,
    videoFileName: "My swing.mp4",
    videoStorageKey: `u${userA.id}_owned.mp4`,
  });
  if (!created?.id) throw new Error("Alice create did not return a row");
  await callerA.analysis.delete({ id: created.id });
});

await assert("B create cannot steal A's videoStorageKey", async () => {
  try {
    await callerB.analysis.create({
      ...createPayload,
      videoFileName: "stolen.mp4",
      videoStorageKey: "alice-swing.mp4",
    });
    throw new Error("Bob created an analysis pointing at Alice's file");
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
});

await assert("delete keeps a shared upload until the last analysis is gone", async () => {
  const uploadsDir = getUploadsDir();
  mkdirSync(uploadsDir, { recursive: true });
  const sharedName = `u${userA.id}_shared.mp4`;
  const sharedPath = path.join(uploadsDir, sharedName);
  writeFileSync(sharedPath, "shared-bytes");

  const first = insertOwnedRow(userA.id, sharedName, sharedName);
  const second = insertOwnedRow(userA.id, sharedName, sharedName);

  deleteAnalysisArtifacts(first.id);
  if (!existsSync(sharedPath)) {
    throw new Error("shared upload was unlinked while another analysis still referenced it");
  }
  const firstGone = db.select().from(analyses).where(eq(analyses.id, first.id)).get();
  if (firstGone) throw new Error("first shared analysis was not deleted");

  deleteAnalysisArtifacts(second.id);
  if (existsSync(sharedPath)) {
    throw new Error("shared upload was not unlinked after the last analysis");
  }
});

await assert("A delete removes own analysis", async () => {
  await callerA.analysis.delete({ id: owned.id });
  const gone = db.select().from(analyses).where(eq(analyses.id, owned.id)).get();
  if (gone) throw new Error("Alice delete did not remove the row");
});

await rm(dataDir, { recursive: true, force: true });
