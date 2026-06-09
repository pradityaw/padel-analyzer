#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const toolRoot = resolve(__dirname, "..")
const promptsDir = resolve(toolRoot, "prompts")

const TASKS = {
  "m1-worker-offload-spike": "m1-worker-offload-spike.md",
  "m2-config-dedup": "m2-config-dedup.md",
  "quality-warning-persist": "quality-warning-persist.md",
}

function printUsage() {
  console.log(`Padel Analyzer — Kanban prompt printer

Usage:
  pnpm prompt -- --task m1-worker-offload-spike
  pnpm prompt:list

Tasks:
  ${Object.keys(TASKS).join("\n  ")}
`)
}

function loadPrompt(task) {
  const file = TASKS[task]
  if (!file) {
    throw new Error(`Unknown task "${task}". Run with --list.`)
  }
  const body = readFileSync(resolve(promptsDir, file), "utf8").trim()
  const guardrails = readFileSync(resolve(promptsDir, "_guardrails.md"), "utf8").trim()
  return `${body}\n\n---\n\n${guardrails}\n`
}

const args = process.argv.slice(2)
if (args.includes("--list") || args.includes("-l")) {
  for (const name of Object.keys(TASKS)) {
    console.log(name)
  }
  process.exit(0)
}

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  printUsage()
  process.exit(args.length === 0 ? 1 : 0)
}

let task
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--task" || args[i] === "-t") {
    task = args[++i]
  }
}

if (!task) {
  console.error("Missing --task <name>\n")
  printUsage()
  process.exit(1)
}

try {
  process.stdout.write(loadPrompt(task))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
