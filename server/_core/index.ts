import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers/index.js";
import path from "path";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { createUploadHandler } from "./upload.js";
import { logger, requestIdMiddleware, requestLogger } from "./logger.js";
import rateLimit from "express-rate-limit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const uploadsDir = path.join(rootDir, "data/uploads");

const landmarksDir = path.join(rootDir, "data/landmarks");
mkdirSync(uploadsDir, { recursive: true });
mkdirSync(path.join(rootDir, "data/thumbnails"), { recursive: true });
mkdirSync(landmarksDir, { recursive: true });

const app = express();
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(express.json({ limit: "50mb" }));

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
const uploadLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, please try again later" },
});

app.use("/api/trpc", apiLimiter);

const upload = createUploadHandler(uploadsDir);
app.post("/api/upload", uploadLimiter, upload.single("file"), (req, res) => {
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
app.use("/landmarks", express.static(landmarksDir));

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
app.listen(PORT, () => {
  logger.info({ port: PORT }, `Padel Analyzer running at http://localhost:${PORT}`);
});
