#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const promptsDir = resolve(__dirname, "prompts");
const logsDir = resolve(repoRoot, ".cursor-sdk-runs");
let CursorSdkErrorRef;

async function loadSdk() {
  const sdk = await import("@cursor/sdk");
  CursorSdkErrorRef = sdk.CursorSdkError;
  return sdk.Agent;
}

const TASKS = {
  "mvp-scan": "mvp-scan.md",
  "fix-critical": "fix-critical.md",
  "browser-qa": "browser-qa.md",
  "python-e2e": "python-e2e.md",
  "feedback-review": "feedback-review.md",
  "feedback-implement": "feedback-implement.md",
  "ux-review": "ux-review.md",
  "qa-release": "qa-release.md",
  "deploy-check": "deploy-check.md",
  "architect-review": "architect-review.md",
};

const TASK_MODELS = {
  "mvp-scan": "composer-2-fast",
  "deploy-check": "composer-2-fast",
  "feedback-review": "composer-2-fast",
  "ux-review": "composer-2-fast",
  "browser-qa": "composer-2",
  "python-e2e": "composer-2",
  "qa-release": "composer-2",
  "fix-critical": "composer-2",
  "architect-review": "composer-2",
  "feedback-implement": "composer-2",
};

function printUsage() {
  console.log(`Cursor SDK MVP runner

Usage:
  npm run cursor-sdk:list
  npm run cursor-sdk -- --task mvp-scan --dry-run
  npm run cursor-sdk -- --task browser-qa
  npm run cursor-sdk -- --task qa-release

Options:
  --task <name>      One of: ${Object.keys(TASKS).join(", ")}
  --cwd <path>       Repo/app directory for the agent. Defaults to PADEL_APP_CWD,
                     then repo root, then .claude/worktrees/zen-wescoff.
  --model <id>       Cursor model id. Defaults to CURSOR_MODEL or task-specific model.
  --dry-run          Print the resolved prompt without calling the SDK.
  --force            Expire a wedged local run before starting a new one.
  --list             Print available tasks.
`);
}

function parseArgs(argv) {
  const args = {
    task: undefined,
    cwd: undefined,
    model: "__task_default__",
    dryRun: false,
    force: false,
    list: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--task" || arg === "-t") {
      args.task = argv[++i];
    } else if (arg === "--cwd") {
      args.cwd = argv[++i];
    } else if (arg === "--model" || arg === "-m") {
      args.model = argv[++i];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--list") {
      args.list = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-") && !args.task) {
      args.task = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function resolveDefaultCwd(inputCwd) {
  if (inputCwd) return resolve(inputCwd);
  if (process.env.PADEL_APP_CWD) return resolve(process.env.PADEL_APP_CWD);
  if (existsSync(resolve(repoRoot, "package.json"))) return repoRoot;

  const preferredWorktree = resolve(repoRoot, ".claude/worktrees/zen-wescoff");
  if (existsSync(resolve(preferredWorktree, "package.json"))) {
    return preferredWorktree;
  }

  return repoRoot;
}

function loadTaskPrompt(taskName, cwd) {
  const promptFile = TASKS[taskName];
  if (!promptFile) {
    throw new Error(`Unknown task "${taskName}". Run npm run cursor-sdk:list.`);
  }

  const promptPath = resolve(promptsDir, promptFile);
  let prompt = readFileSync(promptPath, "utf8").trim();

  if (taskName === "feedback-implement" && process.env.FEEDBACK_BUNDLE_JSON) {
    prompt = `${prompt}

---

## Feedback bundle

\`\`\`json
${process.env.FEEDBACK_BUNDLE_JSON.trim()}
\`\`\`
`;
  }

  if (taskName === "feedback-implement") {
    return `${prompt}

---

Execution context:
- Mode: local SDK runner testing the feedback-implement prompt (optional).
- Target cwd: ${cwd}
- Repo root: ${repoRoot}
- Keep changes scoped to AGENTS.md workstream boundaries.
- For real tester-driven PRs, use \`npm run feedback:triage\` (cloud agent + auto PR).
`;
  }

  return `${prompt}

---

Execution context:
- Target cwd: ${cwd}
- Repo root: ${repoRoot}
- Keep changes scoped to the task and existing AGENTS.md workstream boundaries.
- Do not commit or push changes unless explicitly asked by the user.
`;
}

function writeLog(taskName, payload) {
  mkdirSync(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(logsDir, `${timestamp}-${taskName}.jsonl`);

  for (const event of payload) {
    writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: "a" });
  }

  return path;
}

function summarizeEvent(event) {
  if (event.type === "status") {
    return `[status] ${event.status}${event.message ? `: ${event.message}` : ""}`;
  }

  if (event.type === "assistant") {
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    return text.trim() ? `\n${text.trim()}\n` : undefined;
  }

  if (event.type === "tool_call") {
    return `[tool] ${event.name} ${event.status}`;
  }

  if (event.type === "task" && event.text) {
    return `[task] ${event.text}`;
  }

  return undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log(Object.keys(TASKS).join("\n"));
    return;
  }

  if (!args.task) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const cwd = resolveDefaultCwd(args.cwd);
  const prompt = loadTaskPrompt(args.task, cwd);
  const taskDefaultModel = TASK_MODELS[args.task] || "composer-2";
  const resolvedModel =
    args.model !== "__task_default__"
      ? args.model
      : process.env.CURSOR_MODEL || taskDefaultModel;
  const modelSource =
    args.model !== "__task_default__"
      ? "--model"
      : process.env.CURSOR_MODEL
        ? "CURSOR_MODEL"
        : taskDefaultModel === TASK_MODELS[args.task]
          ? "task default"
          : "fallback";
  const isModelOverride =
    (args.model !== "__task_default__" || !!process.env.CURSOR_MODEL) &&
    resolvedModel !== taskDefaultModel;

  if (!existsSync(cwd)) {
    throw new Error(`Target cwd does not exist: ${cwd}`);
  }

  if (args.dryRun) {
    console.log(prompt);
    return;
  }

  if (!process.env.CURSOR_API_KEY) {
    throw new Error("Set CURSOR_API_KEY before running a Cursor SDK task.");
  }

  const events = [];
  const Agent = await loadSdk();
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: resolvedModel },
    local: {
      cwd,
      settingSources: ["project", "plugins"],
    },
    name: `padel-${args.task}`,
  });

  try {
    console.log(`Starting ${args.task} with ${resolvedModel} (${modelSource})`);
    if (isModelOverride) {
      console.log(
        `WARNING: model override differs from task default (${taskDefaultModel}); token usage may increase.`
      );
    }
    console.log(`Target cwd: ${cwd}`);
    console.log(
      "NOTE: Max Mode is a Cursor account setting; ensure it is OFF for this API key."
    );

    const run = await agent.send(prompt, {
      local: { force: args.force },
    });

    for await (const event of run.stream()) {
      events.push(event);
      const line = summarizeEvent(event);
      if (line) console.log(line);
    }

    const result = await run.wait();
    events.push({ type: "result", result });

    console.log(`\nRun finished: ${result.status}`);
    if (result.result) console.log(result.result);
  } finally {
    const logPath = writeLog(args.task, events);
    agent.close();
    console.log(`Run log: ${logPath}`);
  }
}

main().catch((err) => {
  if (CursorSdkErrorRef && err instanceof CursorSdkErrorRef) {
    console.error(`Cursor SDK error: ${err.message}`);
    if (err.code) console.error(`Code: ${err.code}`);
    if (err.status) console.error(`Status: ${err.status}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
