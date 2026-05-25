/**
 * Squash-merge a feedback PR by number (used after SDK opens a PR).
 */
import { execFileSync } from "node:child_process";
import { syncDevWorkspace } from "./sync-dev-workspace.mjs";

/**
 * @param {string | number} prNumber
 * @param {{ dryRun?: boolean }} opts
 */
export async function mergeFeedbackPr(prNumber, opts = {}) {
  const num = String(prNumber).trim();
  if (!/^\d+$/.test(num)) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  if (opts.dryRun) {
    console.log(`[feedback-merge] dry-run: would merge PR #${num}`);
    return { merged: false, dryRun: true, prNumber: num };
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error(
      "Set GITHUB_TOKEN or GH_TOKEN to auto-merge feedback PRs from the bot."
    );
  }

  execFileSync(
    "gh",
    ["pr", "merge", num, "--squash", "--delete-branch"],
    {
      stdio: "inherit",
      env: { ...process.env, GH_TOKEN: token },
    }
  );

  console.log(`[feedback-merge] merged PR #${num}`);

  const result = { merged: true, prNumber: num };
  if (process.env.FEEDBACK_SYNC_DEV !== "0") {
    try {
      result.sync = await syncDevWorkspace({
        repoRoot: opts.repoRoot ?? process.cwd(),
      });
      if (result.sync?.pulled) {
        console.log(
          `[feedback-merge] dev workspace at ${result.sync.shortSha} — Expo Metro nudged`
        );
      }
    } catch (err) {
      result.syncError = err instanceof Error ? err.message : String(err);
      console.warn(`[feedback-merge] dev sync failed:`, result.syncError);
    }
  }
  return result;
}

/**
 * @param {string} prUrl
 */
export function prNumberFromUrl(prUrl) {
  const m = String(prUrl).match(/\/pull\/(\d+)\/?$/);
  return m ? m[1] : null;
}
