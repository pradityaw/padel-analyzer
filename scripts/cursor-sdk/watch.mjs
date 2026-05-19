#!/usr/bin/env node
/**
 * Supervised background QA supervisor: debounced file watches, lock, report.
 * Default: run Playwright or full MVP gate; report only on failure.
 * --auto-fix: after a failing QA run, invoke Cursor SDK browser-qa (requires CURSOR_API_KEY).
 */
import { watch } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const runsDir = resolve(repoRoot, ".cursor-sdk-runs");
const lockPath = resolve(runsDir, "watch.lock");
const pendingPath = resolve(runsDir, "pending-rerun");
const reportPath = resolve(runsDir, "latest-background-report.md");

const STALE_LOCK_MS = 45 * 60 * 1000;

const WATCH_DIRS = ["client", "server", "shared", "e2e"];
const WATCH_FILES = [
  "playwright.config.ts",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "drizzle.config.ts",
];

function parseArgs(argv) {
  const args = {
    watch: false,
    once: false,
    autoFix: false,
    debounceMs: 2000,
    cwd: repoRoot,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--watch" || a === "-w") args.watch = true;
    else if (a === "--once" || a === "-1") args.once = true;
    else if (a === "--auto-fix") args.autoFix = true;
    else if (a === "--debounce" && argv[i + 1]) {
      args.debounceMs = Math.max(500, parseInt(argv[++i], 10) || 2000);
    } else if (a === "--cwd" && argv[i + 1]) {
      args.cwd = resolve(argv[++i]);
    } else if (a === "--help" || a === "-h") {
      console.log(`Supervised Cursor SDK background watcher

Usage:
  node scripts/cursor-sdk/watch.mjs --watch [--auto-fix] [--debounce 2000]
  node scripts/cursor-sdk/watch.mjs --once [--auto-fix]

Options:
  --watch, -w     Watch client/server/shared/e2e and key config files (default for npm cursor-sdk:watch)
  --once, -1      Run one QA cycle immediately, then exit
  --auto-fix      On QA failure, run: npm run cursor-sdk -- --task browser-qa --force (needs CURSOR_API_KEY)
  --debounce MS   Debounce window after file events (default 2000)
  --cwd PATH      Repo root (default: repo root)

Environment:
  CURSOR_API_KEY   Required only when using --auto-fix after a failure

Reports:
  ${reportPath}
`);
      process.exit(0);
    }
  }
  if (!args.watch && !args.once) {
    args.once = true;
  }
  return args;
}

function ensureRunsDir() {
  mkdirSync(runsDir, { recursive: true });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock() {
  if (!existsSync(lockPath)) return null;
  try {
    return JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function tryAcquireLock() {
  ensureRunsDir();
  const now = Date.now();
  const existing = readLock();
  if (existing?.pid && existing?.startedAt) {
    const age = now - existing.startedAt;
    if (age > STALE_LOCK_MS || !isProcessAlive(existing.pid)) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* ignore */
      }
    } else if (existing.pid !== process.pid) {
      return false;
    }
  }
  writeFileSync(
    lockPath,
    JSON.stringify(
      { pid: process.pid, startedAt: now, host: "cursor-sdk-watch" },
      null,
      2
    ),
    "utf8"
  );
  return true;
}

function releaseLock() {
  const existing = readLock();
  if (existing?.pid === process.pid) {
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

function setPendingRerun() {
  ensureRunsDir();
  writeFileSync(pendingPath, `${Date.now()}\n`, "utf8");
}

function consumePendingRerun() {
  if (!existsSync(pendingPath)) return false;
  try {
    unlinkSync(pendingPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelPath(absPath) {
  const rel = relative(repoRoot, absPath).split(sep).join("/");
  return rel || "";
}

function decideQaCommand(changedRelPaths) {
  const set = new Set(changedRelPaths);
  if (set.size === 0) return "qa:browser";
  for (const p of set) {
    if (
      p.startsWith("server/") ||
      p === "server" ||
      p.startsWith("shared/") ||
      p === "shared" ||
      p === "package.json" ||
      p === "package-lock.json" ||
      p === "vite.config.ts" ||
      p === "tsconfig.json" ||
      p === "drizzle.config.ts" ||
      p === "playwright.config.ts"
    ) {
      return "qa:mvp";
    }
  }
  return "qa:browser";
}

function runNpm(script, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", script],
      {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, output: out });
    });
    child.on("error", (err) => {
      resolveRun({ code: 1, output: `${err.message}\n${out}` });
    });
  });
}

function runCursorSdkBrowserQa(cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", "cursor-sdk", "--", "--task", "browser-qa", "--force"],
      {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      out += d.toString();
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, output: out });
    });
    child.on("error", (err) => {
      resolveRun({ code: 1, output: `${err.message}\n${out}` });
    });
  });
}

function writeReport({
  startedAt,
  changedPaths,
  qaScript,
  qaResult,
  sdkResult,
  autoFix,
}) {
  ensureRunsDir();
  const lines = [
    `# Background QA report`,
    ``,
    `- **Time**: ${new Date(startedAt).toISOString()}`,
    `- **QA script**: \`npm run ${qaScript}\``,
    `- **Changed paths (sample)**: ${changedPaths.length ? changedPaths.slice(0, 20).map((p) => `\`${p}\``).join(", ") : "(none — manual/once run)"}`,
    `- **QA exit code**: ${qaResult.code}`,
    `- **Auto-fix invoked**: ${autoFix ? "yes" : "no"}`,
    sdkResult
      ? `- **SDK browser-qa exit code**: ${sdkResult.code}`
      : `- **SDK browser-qa**: not run`,
    ``,
    `## Suggested next steps`,
    ``,
    qaResult.code === 0
      ? `- QA passed. No action required.`
      : [
          `- Inspect Playwright output and \`qa-artifacts/\`.`,
          `- Review this log tail below.`,
          autoFix
            ? `- Auto-fix was requested: SDK run completed with code ${sdkResult?.code ?? "n/a"}. Review diffs before commit.`
            : `- To attempt narrow fixes via Cursor SDK: \`npm run cursor-sdk -- --task browser-qa --force\` (or restart watcher with \`--auto-fix\`).`,
        ].join("\n"),
    ``,
    `## Command output (truncated)`,
    ``,
    "```",
    (qaResult.output || "").slice(-12000),
    "```",
    ``,
  ];
  if (sdkResult?.output) {
    lines.push(`## SDK browser-qa output (truncated)`, ``, "```", (sdkResult.output || "").slice(-8000), "```", ``);
  }
  lines.push(
    `## Artifacts`,
    ``,
    `- \`qa-artifacts/\` — Playwright traces, screenshots, console/network JSON`,
    `- \`.cursor-sdk-runs/*.jsonl\` — full SDK streams when browser-qa runs`,
    ``
  );
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`\n[watch] Report written: ${reportPath}\n`);
}

async function runCycle(args, changedPaths) {
  const startedAt = Date.now();
  const relPaths = [...new Set(changedPaths.map((p) => normalizeRelPath(p)).filter(Boolean))];
  const qaScript = decideQaCommand(relPaths);

  const acquired = tryAcquireLock();
  if (!acquired) {
    console.log("[watch] Another run is active; queued pending-rerun.");
    setPendingRerun();
    return;
  }

  let sdkResult = null;
  try {
    console.log(`[watch] Running: npm run ${qaScript}`);
    const qaResult = await runNpm(qaScript, args.cwd);

    if (qaResult.code !== 0 && args.autoFix) {
      if (!process.env.CURSOR_API_KEY) {
        console.warn(
          "[watch] QA failed and --auto-fix set, but CURSOR_API_KEY is missing; skipping SDK."
        );
      } else {
        console.log("[watch] Running: npm run cursor-sdk -- --task browser-qa --force");
        sdkResult = await runCursorSdkBrowserQa(args.cwd);
      }
    } else if (qaResult.code !== 0) {
      console.log(
        "[watch] QA failed (report-only mode). See report for next steps."
      );
    }

    writeReport({
      startedAt,
      changedPaths: relPaths,
      qaScript,
      qaResult,
      sdkResult,
      autoFix: args.autoFix && !!process.env.CURSOR_API_KEY,
    });
  } finally {
    releaseLock();
    if (consumePendingRerun()) {
      console.log("[watch] Processing queued rerun...");
      await runCycle(args, []);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(args.cwd)) {
    console.error(`cwd does not exist: ${args.cwd}`);
    process.exit(1);
  }

  if (args.once) {
    runCycle(args, []).catch((e) => {
      console.error(e);
      process.exit(1);
    });
    return;
  }

  /** @type {Set<string>} */
  const pendingChanges = new Set();
  let debounceTimer = null;

  const schedule = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const paths = [...pendingChanges];
      pendingChanges.clear();
      runCycle(args, paths).catch((e) => console.error(e));
    }, args.debounceMs);
  };

  const onEvent = (eventType, absPath) => {
    if (eventType === "rename" && absPath) {
      /* may be delete; still debounce */
    }
    if (absPath) pendingChanges.add(absPath);
    schedule();
  };

  for (const dir of WATCH_DIRS) {
    const abs = resolve(repoRoot, dir);
    if (!existsSync(abs)) continue;
    watch(abs, { recursive: true }, (evt, fname) => {
      const full = fname ? resolve(abs, fname) : abs;
      onEvent(evt, full);
    });
    console.log(`[watch] Watching: ${dir}/`);
  }

  for (const file of WATCH_FILES) {
    const abs = resolve(repoRoot, file);
    if (!existsSync(abs)) continue;
    watch(abs, (evt) => onEvent(evt, abs));
    console.log(`[watch] Watching: ${file}`);
  }

  console.log(
    `[watch] Debounce ${args.debounceMs}ms | auto-fix: ${args.autoFix ? "on" : "off"} | Ctrl+C to stop`
  );

  const onSig = () => {
    console.log("\n[watch] Stopping...");
    releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  runCycle(args, []).catch((e) => console.error(e));
}

main();
