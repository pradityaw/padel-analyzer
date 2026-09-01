/**
 * Two-user isolation: B cannot list/get/delete A's analysis when AUTH_MODE=on.
 * Run via npm run test:contracts.
 */
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
const { analyses } = await import("../../drizzle/schema.js");
const { getOrCreateUserByEmail } = await import("../../server/lib/sessionAuth.js");

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

await assert("A delete removes own analysis", async () => {
  await callerA.analysis.delete({ id: owned.id });
  const gone = db.select().from(analyses).where(eq(analyses.id, owned.id)).get();
  if (gone) throw new Error("Alice delete did not remove the row");
});

await rm(dataDir, { recursive: true, force: true });
