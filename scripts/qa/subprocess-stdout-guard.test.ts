/**
 * Regression: CV subprocess stdout handlers must stop buffering after settle
 * (timeout/kill), or a runaway child can OOM the Node process.
 *
 * Run: tsx scripts/qa/subprocess-stdout-guard.test.ts
 */
import { readFile } from "fs/promises";
import path from "path";

const GUARDED_FILES = [
  "server/lib/cvAgentStageRunner.ts",
  "server/lib/cvPipeline.ts",
  "server/lib/rallyDetection.ts",
] as const;

function assert(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok ${name}`);
    })
    .catch((err) => {
      console.error(`FAIL ${name}:`, err);
      process.exitCode = 1;
    });
}

for (const relativePath of GUARDED_FILES) {
  const label = relativePath.replace(/^server\/lib\//, "");
  await assert(`${label} ignores stdout after settle`, async () => {
    const source = await readFile(path.join(process.cwd(), relativePath), "utf8");
    const handler = source.match(
      /child\.stdout\.on\("data",\s*\(chunk:[^)]+\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/
    );
    if (!handler) {
      throw new Error("stdout data handler not found");
    }
    if (!handler[1]!.includes("if (settled) return")) {
      throw new Error("missing early return when settled");
    }
  });
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log("All subprocess stdout guard checks passed.");
