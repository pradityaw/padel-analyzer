#!/usr/bin/env node
/**
 * Deploy the Padel Analyzer API to Fly.io for hosted mobile testing (laptop off).
 *
 * Usage:
 *   npm run hosted:deploy-api
 *   npm run hosted:deploy-api -- --skip-build
 *   npm run hosted:deploy-api -- --secrets-only
 *
 * Prerequisites:
 *   brew install flyctl && fly auth login
 *   Fly billing active (trial card): https://fly.io/dashboard/personal/billing
 *   fly volumes create padel_data (created automatically when missing)
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadHostedConfig() {
  const raw = readFileSync(path.join(repoRoot, "hosted.config.json"), "utf8");
  return JSON.parse(raw);
}

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
    console.error(`[hosted-api] failed to run ${cmd}:`, r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runCapture(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
}

function requireFly() {
  const which = runCapture("which", ["fly"]);
  if (which.status !== 0) {
    console.error(
      "[hosted-api] fly CLI not found. Install once:\n\n  brew install flyctl\n  fly auth login\n"
    );
    process.exit(1);
  }
}

function checkFlyAuth() {
  const r = runCapture("fly", ["auth", "whoami"]);
  if (r.status !== 0) {
    console.error(
      "[hosted-api] Not logged in to Fly. Run once:\n\n  fly auth login\n"
    );
    process.exit(1);
  }
  const user = (r.stdout || "").trim();
  console.log(`[hosted-api] Fly user: ${user}`);
}

function assertFlyBilling() {
  const cfg = loadHostedConfig();
  const r = runCapture("fly", ["volumes", "list", "--app", cfg.flyApp]);
  const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
  if (combined.includes("trial has ended")) {
    console.error(`
[hosted-api] Fly trial ended — add a payment method before deploying:

  https://fly.io/dashboard/personal/billing

Then re-run:

  npm run hosted:deploy-api
`);
    process.exit(1);
  }
  if (r.status !== 0 && !combined.includes("Could not find App")) {
    console.error("[hosted-api] Could not query Fly volumes:", combined.trim());
    process.exit(1);
  }
}

function ensureVolume() {
  const cfg = loadHostedConfig();
  const list = runCapture("fly", ["volumes", "list", "--app", cfg.flyApp]);
  if (list.status !== 0) {
    console.error("[hosted-api] volume list failed:", (list.stderr || "").trim());
    process.exit(1);
  }
  if (list.stdout.includes(cfg.flyVolumeName)) {
    console.log(`[hosted-api] Volume ${cfg.flyVolumeName} already exists.`);
    return;
  }
  console.log(
    `[hosted-api] Creating volume ${cfg.flyVolumeName} (${cfg.flyVolumeSizeGb}GB, ${cfg.flyRegion})…`
  );
  run("fly", [
    "volumes",
    "create",
    cfg.flyVolumeName,
    "--region",
    cfg.flyRegion,
    "--size",
    String(cfg.flyVolumeSizeGb),
    "--app",
    cfg.flyApp,
    "--yes",
  ]);
}

function setSecrets() {
  const cfg = loadHostedConfig();
  const sessionSecret =
    process.env.SESSION_SECRET?.trim() || randomBytes(32).toString("hex");
  const authMode = process.env.AUTH_MODE?.trim() || "off";

  const pairs = [
    `NODE_ENV=production`,
    `AUTH_MODE=${authMode}`,
    `SESSION_SECRET=${sessionSecret}`,
    `PADEL_DATA_DIR=/data`,
  ];

  console.log(
    `[hosted-api] Setting secrets on ${cfg.flyApp} (AUTH_MODE=${authMode})…`
  );
  run("fly", ["secrets", "set", ...pairs, "--app", cfg.flyApp]);
}

function pushDatabase() {
  const cfg = loadHostedConfig();
  console.log("[hosted-api] Applying SQLite schema on Fly (drizzle-kit push)…");
  run("fly", [
    "ssh",
    "console",
    "--app",
    cfg.flyApp,
    "-C",
    "cd /app && npx --yes drizzle-kit push",
  ]);
}

function printNextSteps() {
  const cfg = loadHostedConfig();
  console.log(`
[hosted-api] Deploy complete.

  Health:  ${cfg.hostedApiBaseUrl}/healthz
  Web UI:  ${cfg.hostedApiBaseUrl}/

Mobile EAS builds use EXPO_PUBLIC_API_BASE_URL=${cfg.hostedApiBaseUrl}
(from hosted.config.json → mobile/eas.json preview/production profiles).

Next:
  npm run hosted:login     # Expo account (browser)
  npm run hosted:setup     # link EAS project (once)
  npm run hosted:build:android   # fastest phone install (APK)
  npm run hosted:build:ios       # TestFlight / internal iOS
`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(`Usage: node scripts/deploy-hosted-api.mjs [options]

Options:
  --secrets-only   Push Fly secrets; do not build or deploy
  --skip-build     Deploy without npm run build

Config: hosted.config.json (flyApp, hostedApiBaseUrl, flyRegion, flyVolumeName)
`);
    process.exit(0);
  }

  const cfg = loadHostedConfig();
  requireFly();
  checkFlyAuth();
  assertFlyBilling();
  ensureVolume();
  setSecrets();

  if (args.secretsOnly) {
    printNextSteps();
    return;
  }

  if (!args.skipBuild) {
    console.log("[hosted-api] Building production bundle…");
    run("npm", ["run", "build"]);
  }

  console.log(`[hosted-api] Deploying ${cfg.flyApp}…`);
  run("fly", ["deploy", "--app", cfg.flyApp]);

  try {
    pushDatabase();
  } catch {
    console.warn(
      "[hosted-api] drizzle push failed — run manually after first deploy:\n" +
        `  fly ssh console --app ${cfg.flyApp} -C "cd /app && npx --yes drizzle-kit push"`
    );
  }

  const health = runCapture("curl", [
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    `${cfg.hostedApiBaseUrl}/healthz`,
  ]);
  const code = (health.stdout || "").trim();
  if (code === "200") {
    console.log(`[hosted-api] Health check OK (${code})`);
  } else {
    console.warn(
      `[hosted-api] Health check returned ${code || "error"} — wait 30s and curl ${cfg.hostedApiBaseUrl}/healthz`
    );
  }

  printNextSteps();
}

main();
