#!/usr/bin/env node
/**
 * Start Expo for Expo Go with LAN + a fresh dev stamp, and nudge connected clients
 * to reload when native env files change (EXPO_PUBLIC_* requires a rebundle).
 *
 * Polls the default git branch every ~15s so feedback-agent merges appear in Expo Go
 * without manual `git pull` (disable with EXPO_SYNC_PULL=0).
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(mobileRoot, "..");
const metroPort = process.env.RCT_METRO_PORT || "8081";
const extraArgs = process.argv.slice(2);

const syncModuleUrl = pathToFileURL(
  path.join(repoRoot, "scripts/feedback-bot/lib/sync-dev-workspace.mjs")
).href;

function devStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

let reloadTimer;
function scheduleMetroReload(reason) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    fetch(`http://127.0.0.1:${metroPort}/reload`)
      .then(() => {
        console.log(`[expo-live] Reloaded clients (${reason})`);
      })
      .catch(() => {
        /* Metro not ready yet */
      });
  }, 400);
}

function watchPath(targetPath, label) {
  try {
    watch(targetPath, { recursive: targetPath.endsWith("src") }, () => {
      scheduleMetroReload(label);
    });
  } catch {
    /* ignore */
  }
}

const env = {
  ...process.env,
  EXPO_PUBLIC_DEV_BUILD_STAMP: devStamp(),
};

console.log("[expo-live] Dev stamp:", env.EXPO_PUBLIC_DEV_BUILD_STAMP);
console.log(
  "[expo-live] Open Expo Go on the same Wi‑Fi and scan the QR code."
);
if (process.env.EXPO_SYNC_PULL !== "0") {
  console.log(
    "[expo-live] Auto-pull enabled — feedback agent merges will reload Expo Go (~15s)."
  );
}

const child = spawn(
  "npx",
  ["expo", "start", "--lan", "--go", ...extraArgs],
  {
    cwd: mobileRoot,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  }
);

child.on("exit", (code) => process.exit(code ?? 0));

let stopWatcher = () => {};

setTimeout(async () => {
  watchPath(path.join(mobileRoot, ".env"), ".env");
  watchPath(path.join(mobileRoot, ".env.local"), ".env.local");
  watchPath(path.join(mobileRoot, "app.json"), "app.json");
  watchPath(path.join(mobileRoot, ".feedback-sync-stamp"), "feedback-sync");
  watchPath(path.join(mobileRoot, "src"), "mobile/src");

  try {
    const { startDevWorkspaceWatcher } = await import(syncModuleUrl);
    stopWatcher = startDevWorkspaceWatcher({
      repoRoot,
      onSync: (result) => {
        if (result.pulled) scheduleMetroReload("git pull");
      },
    });
  } catch (err) {
    console.warn(
      "[expo-live] Could not start git sync watcher:",
      err instanceof Error ? err.message : err
    );
  }
}, 8000);

process.on("SIGINT", () => {
  stopWatcher();
  child.kill("SIGINT");
});
