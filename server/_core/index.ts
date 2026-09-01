import express from "express";
import { MulterError } from "multer";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers/index.js";
import path from "path";
import { mkdirSync, readdirSync, statSync } from "fs";
import { createUploadHandler } from "./upload.js";
import { getThumbnailsDir, getUploadsDir, getDataRoot } from "../lib/paths.js";
import { resolveProjectRoot } from "../lib/projectRoot.js";
import { MAX_UPLOAD_MB, DATA_VOLUME_SOFT_CAP_BYTES } from "../../shared/config.js";
import { logger } from "../lib/logger.js";
import { createRateLimiter } from "../lib/rateLimiter.js";
import { createRequestContext } from "./requestContext.js";
import { registerSlackFeedbackRoutes } from "../lib/slackFeedbackEvents.js";
import { recoverPendingAnalysisJobs } from "../lib/analysisJobProcessor.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { ensureSchema } from "../lib/ensureSchema.js";
import { initSentry } from "../lib/sentry.js";

const rootDir = resolveProjectRoot(import.meta.url);
const uploadsDir = getUploadsDir();

mkdirSync(uploadsDir, { recursive: true });
mkdirSync(getThumbnailsDir(), { recursive: true });

const app = express();
// Fly (and most reverse proxies) terminate TLS in front of the app; trust the
// forwarded client IP so rate limiting keys on the real caller, not the proxy.
app.set("trust proxy", true);
// Raw-body Slack route must register before express.json() so signature verification works.
registerSlackFeedbackRoutes(app);
registerAuthRoutes(app);
app.use(express.json({ limit: `${MAX_UPLOAD_MB}mb` }));

const upload = createUploadHandler(uploadsDir);

function uploadSingleMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `Video is too large (max ${MAX_UPLOAD_MB} MB). Try trimming the clip or lowering quality.`,
        });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : "Could not receive the upload.",
      });
      return;
    }
    next();
  });
}

// Token-bucket limiter on the expensive public routes. Tuned for a single
// Fly instance; bump via env if you scale out. Uploads are the heaviest
// (disk + Python CV pipeline downstream), so they get the tightest budget.
const uploadLimiter = createRateLimiter({
  capacity: Number(process.env.RATE_LIMIT_UPLOAD_CAPACITY ?? 10),
  refillPerSecond: Number(process.env.RATE_LIMIT_UPLOAD_REFILL_PER_SEC ?? 0.5),
  id: "upload",
});

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/upload", uploadLimiter, uploadSingleMiddleware, (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  res.json({ storageKey: req.file.filename });
});

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: createRequestContext,
  })
);

app.use("/uploads", express.static(uploadsDir));

// Inline NODE_ENV check so esbuild can dead-code-eliminate the dev branch in production bundles.
if (process.env.NODE_ENV === "production") {
  const publicDir = path.join(rootDir, "dist/public");
  app.use(express.static(publicDir));
  app.get("/*splat", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  const { attachViteDevMiddleware } = await import("./viteDev.js");
  await attachViteDevMiddleware(app, rootDir);
}

function directorySizeBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += directorySizeBytes(full);
      else total += statSync(full).size;
    }
  } catch {
    return total;
  }
  return total;
}

ensureSchema();
await initSentry();

const PORT = parseInt(process.env.PORT || "3001", 10);
/** Bind all interfaces so phones on the LAN can reach the dev API (physical device uploads). */
const LISTEN_HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, LISTEN_HOST, () => {
  const usedBytes = directorySizeBytes(getDataRoot());
  if (usedBytes > DATA_VOLUME_SOFT_CAP_BYTES) {
    logger.warn(
      { usedBytes, capBytes: DATA_VOLUME_SOFT_CAP_BYTES },
      "data volume over soft cap — delete old analyses or enlarge the Fly volume",
    );
  }
  logger.info(
    { host: LISTEN_HOST, port: PORT, url: `http://localhost:${PORT}`, usedBytes },
    "Padel Analyzer listening",
  );
  recoverPendingAnalysisJobs();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.fatal(
      { err, host: LISTEN_HOST, port: PORT },
      "Padel Analyzer could not start: address already in use",
    );
    process.exit(1);
  }
  throw err;
});
