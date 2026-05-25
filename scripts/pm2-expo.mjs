#!/usr/bin/env node
/**
 * PM2 entry: free Metro port, then start Expo Go (LAN) without interactive prompts.
 */
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(repoRoot, "mobile");
const port = process.env.RCT_METRO_PORT || "8081";

function freePort(targetPort) {
  try {
    const pids = execFileSync("lsof", ["-ti", `:${targetPort}`], {
      encoding: "utf8",
    }).trim();
    if (!pids) return;
    for (const pid of pids.split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
        console.log(`[pm2-expo] Freed port ${targetPort} (pid ${pid})`);
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
  ["expo", "start", "--lan", "--go", "--port", port],
  {
    cwd: mobileRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: "1",
      EXPO_PUBLIC_API_PORT: process.env.EXPO_PUBLIC_API_PORT || "3001",
    },
    shell: process.platform === "win32",
  }
);

child.on("exit", (code) => process.exit(code ?? 0));

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
