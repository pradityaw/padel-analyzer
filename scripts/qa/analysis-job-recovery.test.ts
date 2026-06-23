/**
 * Analysis job recovery after server restart.
 * Run: tsx scripts/qa/analysis-job-recovery.test.ts
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

assert("recoverPendingAnalysisJobs is exported", () => {
  const source = readSource("server/lib/analysisJobProcessor.ts");
  if (!source.includes("export async function recoverPendingAnalysisJobs")) {
    throw new Error("missing recoverPendingAnalysisJobs export");
  }
  if (!source.includes('inArray(analysisJobs.status, ["queued", "processing"])')) {
    throw new Error("must query queued and processing jobs");
  }
});

assert("server startup invokes job recovery", () => {
  const source = readSource("server/_core/index.ts");
  if (!source.includes("recoverPendingAnalysisJobs")) {
    throw new Error("index.ts must call recoverPendingAnalysisJobs on listen");
  }
});

assert("Slack events route registered before express.json", () => {
  const source = readSource("server/_core/index.ts");
  const slackIdx = source.indexOf("registerSlackFeedbackRoutes(app)");
  const jsonIdx = source.indexOf("app.use(express.json");
  if (slackIdx < 0) {
    throw new Error("registerSlackFeedbackRoutes not called");
  }
  if (jsonIdx < 0 || slackIdx > jsonIdx) {
    throw new Error("Slack routes must register before express.json()");
  }
});
