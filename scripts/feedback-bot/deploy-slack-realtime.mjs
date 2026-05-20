#!/usr/bin/env node
/**
 * Push Slack real-time feedback secrets from .env.feedback to Fly and deploy.
 *
 * Prerequisites:
 *   brew install flyctl   (once)
 *   fly auth login        (once, opens browser)
 *   .env.feedback at repo root with SLACK_SIGNING_SECRET + other keys
 *
 * Usage:
 *   npm run feedback:fly-deploy          # secrets + build + deploy
 *   npm run feedback:fly-secrets         # secrets only (no deploy)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadFeedbackEnv, repoRoot } from "./env.mjs";

const APP = process.env.FLY_APP || "padel-analyzer";

const REQUIRED = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_FEEDBACK_CHANNEL_ID",
  "CURSOR_API_KEY",
];

const OPTIONAL = [
  "SLACK_ALLOWLIST_USER_IDS",
  "FEEDBACK_REPO_URL",
  "FEEDBACK_MODEL",
  "FEEDBACK_AGENT_TIMEOUT_MS",
  "FEEDBACK_MAX_PRS_PER_RUN",
  "FEEDBACK_MAX_MESSAGES_PER_RUN",
  "FEEDBACK_AUTO_MERGE",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    secretsOnly: args.includes("--secrets-only"),
    skipBuild: args.includes("--skip-build"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (r.error) {
    console.error(`[fly-deploy] failed to run ${cmd}:`, r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function requireFly() {
  const which = spawnSync("which", ["fly"], { encoding: "utf8" });
  if (which.status !== 0) {
    console.error(
      "[fly-deploy] fly CLI not found. Install: brew install flyctl"
    );
    process.exit(1);
  }
}

function checkAuth() {
  const r = spawnSync("fly", ["auth", "whoami"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  if (r.status !== 0) {
    console.error(
      "[fly-deploy] Not logged in to Fly. Run once:\n\n  npm run feedback:fly-login\n"
    );
    process.exit(1);
  }
  console.log(`[fly-deploy] Fly user: ${(r.stdout || "").trim()}`);
}

function loadEnv() {
  const path = `${repoRoot}/.env.feedback`;
  if (!existsSync(path)) {
    console.error(
      `[fly-deploy] Missing ${path}\nCopy .env.feedback.example and set SLACK_SIGNING_SECRET (and other keys).`
    );
    process.exit(1);
  }
  loadFeedbackEnv();

  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    console.error(
      `[fly-deploy] Missing in .env.feedback: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

function buildSecretArgs() {
  const keys = [...REQUIRED, ...OPTIONAL];
  const pairs = [];
  for (const key of keys) {
    const val = process.env[key]?.trim();
    if (val) pairs.push(`${key}=${val}`);
  }
  return pairs;
}

function setSecrets() {
  const pairs = buildSecretArgs();
  console.log(
    `[fly-deploy] Setting ${pairs.length} secret(s) on app "${APP}" (values not printed)`
  );
  run("fly", ["secrets", "set", ...pairs, "--app", APP]);
}

function printSlackNextSteps() {
  const url = `https://${APP}.fly.dev/api/slack/events`;
  console.log(`
[fly-deploy] Done. Configure Slack (one time):

  1. https://api.slack.com/apps → your app → Event Subscriptions
  2. Enable Events → Request URL: ${url}
  3. Subscribe to: message.channels (and message.groups if private channel)
  4. Save / reinstall app if prompted

Test: post in your feedback channel — you should get :eyes: and "Started working…" within seconds.
`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(`Usage: node scripts/feedback-bot/deploy-slack-realtime.mjs [options]

Options:
  --secrets-only   Push Fly secrets from .env.feedback; do not build or deploy
  --skip-build     Deploy without running npm run build first

Env:
  FLY_APP          Fly app name (default: padel-analyzer)

Requires .env.feedback with at least:
  SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_FEEDBACK_CHANNEL_ID, CURSOR_API_KEY
`);
    process.exit(0);
  }

  requireFly();
  checkAuth();
  loadEnv();
  setSecrets();

  if (args.secretsOnly) {
    printSlackNextSteps();
    return;
  }

  if (!args.skipBuild) {
    console.log("[fly-deploy] Building…");
    run("npm", ["run", "build"]);
  }

  console.log(`[fly-deploy] Deploying app "${APP}"…`);
  run("fly", ["deploy", "--app", APP]);

  printSlackNextSteps();
}

main();
