#!/usr/bin/env node
/**
 * Run API (watch) + Expo Go with auto git-pull when feedback agents merge PRs.
 *
 * Usage: npm run dev:mobile
 * - API: defaults to port 3001, or the next free port if another local app has it.
 * - Expo Go reloads when origin/default branch advances (~15s poll)
 */
import net from "node:net";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredApiPort = Number(process.env.PADEL_PORT || process.env.PORT || 3001);

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}

async function findApiPort(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(
    `[dev-with-mobile] Could not find a free API port starting at ${startPort}.`
  );
}

function getLanHost() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "localhost";
}

function run(name, command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[dev-with-mobile] ${name} exited with code ${code}`);
    }
  });
  return child;
}

const apiPort = await findApiPort(preferredApiPort);
const lanHost = getLanHost();
const expoApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL || `http://${lanHost}:${apiPort}`;

if (apiPort !== preferredApiPort) {
  console.warn(
    `[dev-with-mobile] Port ${preferredApiPort} is busy; using API port ${apiPort}.`
  );
}
console.log(`[dev-with-mobile] Expo API URL: ${expoApiBaseUrl}`);

const apiEnv = {
  ...process.env,
  HOST: process.env.HOST || "0.0.0.0",
  PORT: String(apiPort),
};
const mobileEnv = {
  ...process.env,
  EXPO_PUBLIC_API_BASE_URL: expoApiBaseUrl,
  EXPO_PUBLIC_API_PORT: String(apiPort),
};

const api = run("api", "npm", ["run", "dev"], repoRoot, apiEnv);
const mobile = run(
  "mobile",
  "node",
  ["mobile/scripts/expo-live.mjs"],
  repoRoot,
  mobileEnv
);

function shutdown() {
  api.kill("SIGINT");
  mobile.kill("SIGINT");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
