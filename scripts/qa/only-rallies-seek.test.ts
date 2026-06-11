/**
 * Unit tests for Only Rallies dead-time seek debouncing.
 * Run: tsx scripts/qa/only-rallies-seek.test.ts
 */
import { planOnlyRalliesSeek } from "../../client/src/lib/onlyRalliesSeek.js";

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

assert("seeks once toward next rally when far from start", () => {
  const first = planOnlyRalliesSeek({
    currentTimeSec: 0,
    nextRallyStartMs: 10_000,
    pendingSeekTargetSec: null,
  });
  if (first.seekToSec !== 10.001) throw new Error(`expected seek, got ${first.seekToSec}`);
  if (first.pendingSeekTargetSec !== 10) throw new Error("expected pending target 10");

  const repeat = planOnlyRalliesSeek({
    currentTimeSec: 2,
    nextRallyStartMs: 10_000,
    pendingSeekTargetSec: first.pendingSeekTargetSec,
  });
  if (repeat.seekToSec !== null) {
    throw new Error("must not re-seek every frame after keyframe snap");
  }
});

assert("clears pending when within tolerance of rally start", () => {
  const plan = planOnlyRalliesSeek({
    currentTimeSec: 9.96,
    nextRallyStartMs: 10_000,
    pendingSeekTargetSec: 10,
  });
  if (plan.seekToSec !== null || plan.pendingSeekTargetSec !== null) {
    throw new Error("should allow natural playback into rally");
  }
});

assert("resets when no next rally", () => {
  const plan = planOnlyRalliesSeek({
    currentTimeSec: 120,
    nextRallyStartMs: null,
    pendingSeekTargetSec: 10,
  });
  if (plan.pendingSeekTargetSec !== null) {
    throw new Error("expected pending cleared at end of video");
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
