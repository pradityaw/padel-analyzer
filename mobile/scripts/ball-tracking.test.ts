/**
 * Mobile ball-tracking helper smoke tests (tsx assert pattern).
 */
import {
  buildBallFrameMap,
  computeBallSpeedPxPerFrame,
  findPriorBallSample,
  getBallForFrameIndex,
  normalizeBallCoordinate,
  parseBallTrackingSamples,
} from "../src/lib/ballTracking";

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

assert("parseBallTrackingSamples rejects malformed tuples", () => {
  const parsed = parseBallTrackingSamples([
    [0, 0.5, 0.5, 0.9],
    [1, NaN, 0.5, 0.9],
    [2, 0.5, 0.5, 0.05],
    "bad",
  ]);
  if (parsed.length !== 1) throw new Error(`expected 1 sample, got ${parsed.length}`);
});

assert("normalizeBallCoordinate handles pixels and normalized", () => {
  if (normalizeBallCoordinate(0.5, 1920) !== 0.5) throw new Error("normalized");
  if (normalizeBallCoordinate(960, 1920) !== 0.5) throw new Error("pixel");
  if (normalizeBallCoordinate(Number.NaN, 1920) != null) throw new Error("nan");
});

assert("buildBallFrameMap keeps highest confidence per frame", () => {
  const map = buildBallFrameMap([
    [3, 0.4, 0.6, 0.5],
    [3, 0.41, 0.61, 0.8],
  ]);
  const p = getBallForFrameIndex(map, 3);
  if (!p || p.confidence !== 0.8) throw new Error("confidence pick");
});

assert("computeBallSpeedPxPerFrame rejects zero frame delta", () => {
  const a = { x: 0, y: 0, confidence: 0.9 };
  const b = { x: 0.1, y: 0, confidence: 0.9 };
  if (computeBallSpeedPxPerFrame(a, b, 0) != null) throw new Error("zero delta");
  const speed = computeBallSpeedPxPerFrame(a, b, 1);
  if (speed == null || Math.abs(speed - 0.1) > 1e-6) throw new Error(`speed ${speed}`);
});

assert("findPriorBallSample walks back within max gap", () => {
  const map = buildBallFrameMap([
    [0, 0.2, 0.2, 0.9],
    [2, 0.4, 0.2, 0.9],
  ]);
  const prior = findPriorBallSample(map, 2, 5);
  if (!prior || prior.frameIndex !== 0) throw new Error("prior frame");
});

console.log("mobile-ball-tracking: all assertions passed");
