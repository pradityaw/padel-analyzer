/**
 * Squash-merge a feedback PR by number (used after SDK opens a PR).
 */
import { execFileSync } from "node:child_process";

/**
 * @param {string | number} prNumber
 * @param {{ dryRun?: boolean }} opts
 */
export function mergeFeedbackPr(prNumber, opts = {}) {
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
  return { merged: true, prNumber: num };
}

/**
 * @param {string} prUrl
 */
export function prNumberFromUrl(prUrl) {
  const m = String(prUrl).match(/\/pull\/(\d+)\/?$/);
  return m ? m[1] : null;
}
