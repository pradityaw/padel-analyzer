/**
 * Unit tests for overlay frame budget / degrade escalation.
 * Run: npm run test:overlay-frame-budget
 */
import {
  OVERLAY_FRAME_BUDGET_MS,
  OverlayFrameBudget,
  computePercentile,
  degradeFlagsFromSkipLevel,
} from "../../client/src/lib/overlay/overlayFrameBudget.js";

let passed = 0;
let failed = 0;

function assert(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

assert("computePercentile returns median for odd samples", () => {
  const p50 = computePercentile([10, 20, 30], 50);
  if (p50 !== 20) throw new Error(`expected 20, got ${p50}`);
});

assert("degrade level 1 skips ball trail only", () => {
  const flags = degradeFlagsFromSkipLevel(1, 1);
  if (!flags.skipBallTrail || flags.skipSkeleton || flags.skipAllLayers) {
    throw new Error(`unexpected flags ${JSON.stringify(flags)}`);
  }
});

assert("degrade level 3 skips all layers on odd frames", () => {
  const even = degradeFlagsFromSkipLevel(3, 2);
  const odd = degradeFlagsFromSkipLevel(3, 3);
  if (even.skipAllLayers) throw new Error("even frame should paint");
  if (!odd.skipAllLayers) throw new Error("odd frame should skip paint");
});

assert("escalates skip level after consecutive slow paints", () => {
  const budget = new OverlayFrameBudget();
  budget.degradeForFrame();
  for (let i = 0; i < 3; i++) {
    budget.record(OVERLAY_FRAME_BUDGET_MS + 5);
  }
  if (budget.skipLevelSnapshot < 1) {
    throw new Error(`expected skip level >= 1, got ${budget.skipLevelSnapshot}`);
  }
});

assert("recovers skip level when paints stay under budget", () => {
  const budget = new OverlayFrameBudget();
  for (let i = 0; i < 3; i++) {
    budget.degradeForFrame();
    budget.record(OVERLAY_FRAME_BUDGET_MS + 8);
  }
  const elevated = budget.skipLevelSnapshot;
  for (let i = 0; i < 80; i++) {
    budget.degradeForFrame();
    budget.record(4);
  }
  if (budget.skipLevelSnapshot >= elevated && elevated > 0) {
    throw new Error(
      `expected skip level to drop from ${elevated}, got ${budget.skipLevelSnapshot}`
    );
  }
});

assert("reset clears skip level", () => {
  const budget = new OverlayFrameBudget();
  budget.degradeForFrame();
  for (let i = 0; i < 4; i++) budget.record(40);
  budget.reset();
  if (budget.skipLevelSnapshot !== 0) {
    throw new Error(`expected 0 after reset, got ${budget.skipLevelSnapshot}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
