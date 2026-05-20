#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
  });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const qaCode = await run(npm, ["run", "qa:browser"]);
const summaryCode = await run("node", ["scripts/qa/summarize-artifacts.mjs"]);

process.exitCode = qaCode || summaryCode;
