/**
 * Pull latest default branch and nudge Expo Metro so Expo Go reloads new JS.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BRANCH = "cursor/customer-journey-ui-ux";
const STAMP_REL = "mobile/.feedback-sync-stamp";

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function resolveSyncBranch() {
  return (
    process.env.FEEDBACK_SYNC_BRANCH ||
    process.env.FEEDBACK_DEFAULT_BRANCH ||
    DEFAULT_BRANCH
  );
}

/**
 * @param {number} [port]
 */
export async function nudgeMetroReload(port = Number(process.env.RCT_METRO_PORT) || 8081) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/reload`);
    return res.ok;
  } catch {
    return false;
  }
}

function touchSyncStamp(repoRoot) {
  const stampPath = resolve(repoRoot, STAMP_REL);
  writeFileSync(stampPath, `${new Date().toISOString()}\n`, "utf8");
  return stampPath;
}

function listChangedPaths(repoRoot, fromSha, toSha) {
  if (!fromSha || fromSha === toSha) return [];
  try {
    const out = runGit(["diff", "--name-only", fromSha, toSha], repoRoot);
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ repoRoot?: string; branch?: string; force?: boolean; reloadMetro?: boolean }} opts
 */
export async function syncDevWorkspace(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const branch = opts.branch ?? resolveSyncBranch();
  const reloadMetro = opts.reloadMetro !== false;

  runGit(["fetch", "origin", branch], repoRoot);

  let localSha;
  try {
    localSha = runGit(["rev-parse", "HEAD"], repoRoot);
  } catch {
    localSha = "";
  }

  const remoteSha = runGit(["rev-parse", `origin/${branch}`], repoRoot);

  if (localSha === remoteSha && !opts.force) {
    return {
      pulled: false,
      branch,
      localSha,
      remoteSha,
      reason: "already_up_to_date",
    };
  }

  runGit(["pull", "--ff-only", "origin", branch], repoRoot);

  const newSha = runGit(["rev-parse", "HEAD"], repoRoot);
  const changed = listChangedPaths(repoRoot, localSha, newSha);
  touchSyncStamp(repoRoot);

  let metroReloaded = false;
  if (reloadMetro) {
    metroReloaded = await nudgeMetroReload();
  }

  const nativeConfigChanged = changed.some(
    (p) => p === "mobile/app.json" || p.startsWith("mobile/ios/") || p.startsWith("mobile/android/")
  );

  return {
    pulled: true,
    branch,
    fromSha: localSha,
    toSha: newSha,
    shortSha: newSha.slice(0, 7),
    changedCount: changed.length,
    nativeConfigChanged,
    metroReloaded,
  };
}

/**
 * Poll origin for new feedback merges (for Expo Go while dev server is running).
 * @param {{ repoRoot?: string; branch?: string; intervalMs?: number; onSync?: (result: Awaited<ReturnType<typeof syncDevWorkspace>>) => void }} opts
 */
export function startDevWorkspaceWatcher(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const branch = opts.branch ?? resolveSyncBranch();
  const intervalMs =
    Number(process.env.EXPO_SYNC_INTERVAL_MS) ||
    Number(process.env.FEEDBACK_SYNC_INTERVAL_MS) ||
    15_000;

  if (process.env.EXPO_SYNC_PULL === "0" || process.env.FEEDBACK_SYNC_DEV === "0") {
    return () => {};
  }

  let remoteSha = "";
  try {
    runGit(["fetch", "origin", branch], repoRoot);
    remoteSha = runGit(["rev-parse", `origin/${branch}`], repoRoot);
  } catch {
    /* first fetch may fail offline */
  }

  let localSha = "";
  try {
    localSha = runGit(["rev-parse", "HEAD"], repoRoot);
  } catch {
    /* ignore */
  }

  console.log(
    `[sync-dev] Watching origin/${branch} every ${intervalMs / 1000}s (local ${localSha.slice(0, 7) || "?"})`
  );

  const timer = setInterval(async () => {
    try {
      runGit(["fetch", "origin", branch], repoRoot);
      const nextRemote = runGit(["rev-parse", `origin/${branch}`], repoRoot);
      if (!remoteSha) {
        remoteSha = nextRemote;
        return;
      }
      if (nextRemote === remoteSha) return;

      remoteSha = nextRemote;
      const result = await syncDevWorkspace({ repoRoot, branch });
      opts.onSync?.(result);
      if (result.pulled) {
        console.log(
          `[sync-dev] Pulled ${result.shortSha} (${result.changedCount} files) — Metro reload ${result.metroReloaded ? "ok" : "skipped"}`
        );
        if (result.nativeConfigChanged) {
          console.warn(
            "[sync-dev] Native config changed — restart `npm run dev:mobile` if Expo Go behaves oddly."
          );
        }
      }
    } catch (err) {
      console.warn(
        "[sync-dev] poll failed:",
        err instanceof Error ? err.message : err
      );
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
