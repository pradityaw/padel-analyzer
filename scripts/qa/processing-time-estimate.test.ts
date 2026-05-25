/**
 * Run: npx tsx scripts/qa/processing-time-estimate.test.ts
 */
import {
  estimateProcessingTime,
  formatElapsedVsEstimate,
} from "../../client/src/lib/processingTimeEstimate.ts";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

assert("short upload clip is quick tier", () => {
  const est = estimateProcessingTime({ durationSec: 90, source: "upload" });
  if (est.tier !== "quick") throw new Error(`expected quick, got ${est.tier}`);
  if (est.expectedSec > 8 * 60) throw new Error("expected under 8 min");
});

assert("21 min youtube is long tier", () => {
  const est = estimateProcessingTime({ durationSec: 21 * 60, source: "youtube" });
  if (est.tier !== "long") throw new Error(`expected long, got ${est.tier}`);
  if (est.minSec < 30 * 60) throw new Error("expected at least 30 min low bound");
});

assert("elapsed copy reflects over estimate", () => {
  const est = estimateProcessingTime({ durationSec: 600, source: "upload" });
  const msg = formatElapsedVsEstimate(est.maxSec + 120, est);
  if (!msg.includes("longer than usual")) {
    throw new Error(`unexpected message: ${msg}`);
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log("All processing-time estimate checks passed.");
