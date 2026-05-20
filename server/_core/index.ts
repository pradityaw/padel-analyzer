import express from "express";
import { MulterError } from "multer";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers/index.js";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { createUploadHandler } from "./upload.js";
import { getThumbnailsDir, getUploadsDir } from "../lib/paths.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../shared/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const uploadsDir = getUploadsDir();

mkdirSync(uploadsDir, { recursive: true });
mkdirSync(getThumbnailsDir(), { recursive: true });

const app = express();
app.use(express.json({ limit: "500mb" }));

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

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/upload", uploadSingleMiddleware, (req, res) => {
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
  })
);

app.use("/uploads", express.static(uploadsDir));

const isProd = process.env.NODE_ENV === "production";

if (isProd) {
  const publicDir = path.join(rootDir, "dist/public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.join(rootDir, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const PORT = parseInt(process.env.PORT || "3001", 10);
/** Bind all interfaces so phones on the LAN can reach the dev API (physical device uploads). */
const LISTEN_HOST = process.env.HOST || "0.0.0.0";
const server = app.listen(PORT, LISTEN_HOST, () => {
  console.log(
    `Padel Analyzer listening on ${LISTEN_HOST}:${PORT} (browser: http://localhost:${PORT})`,
  );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Padel Analyzer could not start: ${LISTEN_HOST}:${PORT} is already in use.`,
    );
    process.exit(1);
  }
  throw err;
});
