#!/usr/bin/env node
/**
 * Production server bundle. Keeps native / dev-only deps external so esbuild
 * never tries to parse .node binaries (fsevents, better-sqlite3, etc.).
 */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(rootDir, "server/_core/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  outfile: path.join(rootDir, "dist/index.js"),
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  logLevel: "info",
});
