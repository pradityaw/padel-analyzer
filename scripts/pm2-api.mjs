#!/usr/bin/env node
/**
 * PM2 entry: free API port, then start tsx watch dev server.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT || process.env.PADEL_PORT || "3001";

function freePort(targetPort) {
  try {
    const pids = execFileSync("lsof", ["-ti", `:${targetPort}`], {
      encoding: "utf8",
    }).trim();
    if (!pids) return;
    for (const pid of pids.split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
        console.log(`[pm2-api] Freed port ${targetPort} (pid ${pid})`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* port already free */
  }
}

freePort(port);

const child = spawn(
  "npx",
  ["tsx", "watch", "server/_core/index.ts"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: port,
    },
    shell: process.platform === "win32",
  }
);

child.on("exit", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
