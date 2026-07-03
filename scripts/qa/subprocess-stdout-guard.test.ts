/**
 * Guards against buffering subprocess stdout after settle (timeout/kill).
 * Run: tsx scripts/qa/subprocess-stdout-guard.test.ts
 */
import { readFileSync } from "fs";
import path from "path";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

function readSource(relPath: string): string {
  return readFileSync(path.resolve(process.cwd(), relPath), "utf8");
}

function expectStdoutSettledGuard(source: string, label: string): void {
  const marker = 'child.stdout.on("data", (chunk: Buffer) => {';
  const idx = source.indexOf(marker);
  if (idx < 0) {
    throw new Error(`${label}: stdout handler not found`);
  }
  const snippet = source.slice(idx, idx + 120);
  if (!snippet.includes("if (settled) return;")) {
    throw new Error(`${label}: missing settled guard in stdout handler`);
  }
}

assert("cvPipeline stdout handler ignores data after settle", () => {
  expectStdoutSettledGuard(readSource("server/lib/cvPipeline.ts"), "cvPipeline");
});

assert("cvAgentStageRunner stdout handler ignores data after settle", () => {
  expectStdoutSettledGuard(
    readSource("server/lib/cvAgentStageRunner.ts"),
    "cvAgentStageRunner"
  );
});

assert("rallyDetection stdout handler ignores data after settle", () => {
  expectStdoutSettledGuard(readSource("server/lib/rallyDetection.ts"), "rallyDetection");
});
