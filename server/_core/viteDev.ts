import type { Express } from "express";
import path from "path";

/** Dev-only Vite middleware (not bundled into production server). */
export async function attachViteDevMiddleware(
  app: Express,
  rootDir: string,
): Promise<void> {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.join(rootDir, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
