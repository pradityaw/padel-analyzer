import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** macOS-only optional peer; must never be prebundled for the browser. */
const devOnlyNativePeers = ["fsevents"];

export default defineConfig({
  root: path.resolve(__dirname, "client"),
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: devOnlyNativePeers,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client/src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      external: devOnlyNativePeers,
      output: {
        manualChunks: {
          "ort": ["onnxruntime-web"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/uploads": "http://localhost:3001",
    },
  },
  worker: {
    format: "es",
  },
});
