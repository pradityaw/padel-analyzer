#!/usr/bin/env node
/**
 * Hosted mobile workflow: EAS preview builds pointing at Fly API.
 *
 * Usage:
 *   node scripts/mobile-hosted.mjs check
 *   node scripts/mobile-hosted.mjs setup
 *   node scripts/mobile-hosted.mjs build android|ios|all
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.join(repoRoot, "mobile");

function loadHostedConfig() {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "hosted.config.json"), "utf8")
  );
}

function run(cmd, cmdArgs, cwd = repoRoot) {
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: false });
  if (r.error) {
    console.error(`[hosted-mobile] failed: ${cmd}`, r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function capture(cmd, cmdArgs, cwd = repoRoot) {
  return spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", shell: false });
}

function eas(args, cwd = mobileRoot) {
  run("npx", ["eas-cli", ...args], cwd);
}

function easCapture(args, cwd = mobileRoot) {
  return capture("npx", ["eas-cli", ...args], cwd);
}

function readAppJson() {
  return JSON.parse(
    readFileSync(path.join(mobileRoot, "app.json"), "utf8")
  );
}

function cmdCheck() {
  const cfg = loadHostedConfig();
  console.log("[hosted-mobile] Config");
  console.log(`  API URL:  ${cfg.hostedApiBaseUrl}`);
  console.log(`  Fly app:  ${cfg.flyApp}`);

  const fly = capture("which", ["fly"]);
  console.log(`  fly CLI:  ${fly.status === 0 ? "ok" : "MISSING (brew install flyctl)"}`);

  const flyUser = capture("fly", ["auth", "whoami"]);
  console.log(
    `  Fly auth: ${flyUser.status === 0 ? (flyUser.stdout || "").trim() : "not logged in"}`
  );

  const health = capture("curl", [
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    `${cfg.hostedApiBaseUrl}/healthz`,
  ]);
  const healthCode = (health.stdout || "").trim();
  console.log(
    `  API health: ${healthCode === "200" ? "OK" : healthCode || "unreachable — run npm run hosted:deploy-api"}`
  );

  const easWho = easCapture(["whoami"]);
  console.log(
    `  EAS auth: ${easWho.status === 0 ? (easWho.stdout || "").trim() : "not logged in — npm run hosted:login"}`
  );

  const app = readAppJson();
  const projectId = app.expo?.extra?.eas?.projectId;
  console.log(
    `  EAS project: ${projectId ? projectId : "not linked — npm run hosted:setup"}`
  );

  console.log(`
Profiles (mobile/eas.json):
  preview    → internal APK (Android) / ad-hoc or TestFlight (iOS)
  production → store-ready when you are

Build:
  npm run hosted:build:android
  npm run hosted:build:ios
`);
}

function cmdLogin() {
  console.log("[hosted-mobile] Opening Expo login in browser…");
  eas(["login"]);
}

function cmdSetup() {
  const who = easCapture(["whoami"]);
  if (who.status !== 0) {
    console.error("[hosted-mobile] Log in first:\n\n  npm run hosted:login\n");
    process.exit(1);
  }

  const app = readAppJson();
  if (app.expo?.extra?.eas?.projectId) {
    console.log(
      `[hosted-mobile] EAS project already linked: ${app.expo.extra.eas.projectId}`
    );
    return;
  }

  console.log("[hosted-mobile] Linking Expo project (creates padel-analyzer-mobile on expo.dev)…");
  eas(["init"]);
}

function cmdBuild(platform) {
  const cfg = loadHostedConfig();
  const who = easCapture(["whoami"]);
  if (who.status !== 0) {
    console.error("[hosted-mobile] Log in first:\n\n  npm run hosted:login\n");
    process.exit(1);
  }

  const app = readAppJson();
  if (!app.expo?.extra?.eas?.projectId) {
    console.error("[hosted-mobile] Run setup first:\n\n  npm run hosted:setup\n");
    process.exit(1);
  }

  const health = capture("curl", [
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    `${cfg.hostedApiBaseUrl}/healthz`,
  ]);
  if ((health.stdout || "").trim() !== "200") {
    console.warn(
      `[hosted-mobile] Warning: ${cfg.hostedApiBaseUrl}/healthz is not 200 yet. Deploy API first:\n\n  npm run hosted:deploy-api\n`
    );
  }

  const platforms =
    platform === "all" ? ["android", "ios"] : [platform];

  for (const p of platforms) {
    console.log(
      `[hosted-mobile] EAS preview build (${p}) → API ${cfg.hostedApiBaseUrl}`
    );
    eas([
      "build",
      "--profile",
      "preview",
      "--platform",
      p,
      "--non-interactive",
    ]);
  }

  console.log(`
[hosted-mobile] Build submitted. Track progress:

  npm run hosted:build:status

Install:
  Android — download APK from the EAS build page and open on your phone
  iOS     — install via TestFlight or internal distribution link from EAS
`);
}

function cmdStatus() {
  eas(["build:list", "--limit", "5", "--non-interactive"]);
}

function main() {
  const [command, arg] = process.argv.slice(2);

  switch (command) {
    case "check":
      cmdCheck();
      break;
    case "login":
      cmdLogin();
      break;
    case "setup":
      cmdSetup();
      break;
    case "build":
      if (!arg || !["android", "ios", "all"].includes(arg)) {
        console.error("Usage: mobile-hosted.mjs build android|ios|all");
        process.exit(1);
      }
      cmdBuild(arg);
      break;
    case "status":
      cmdStatus();
      break;
    default:
      console.log(`Usage: node scripts/mobile-hosted.mjs <command>

Commands:
  check              Show Fly/EAS/API readiness
  login              eas login (browser)
  setup              eas init — link Expo project (once)
  build android|ios|all   EAS preview build with hosted API URL
  status             List recent EAS builds
`);
      process.exit(command ? 1 : 0);
  }
}

main();
