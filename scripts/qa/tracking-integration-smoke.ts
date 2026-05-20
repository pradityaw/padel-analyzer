/**
 * Smoke tests for tracking bridge utilities (no running server required).
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeBallTrackSamples,
} from "../../server/lib/ballTracking.ts";
import {
  normalizeRacketTrackSamples,
} from "../../server/lib/racketTracking.ts";
import {
  sanitizeBallTrackingPayload,
  sanitizeRacketTrackingPayload,
} from "../../server/lib/trackingPayload.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function assert(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`, err);
    throw err;
  }
}

const landmarksJson = JSON.stringify([
  { frameIndex: 0, timestamp: 0, landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }] },
  { frameIndex: 1, timestamp: 66, landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }] },
]);

assert("normalizeBallTrackSamples maps timestamp to frameIndex", () => {
  const ball = normalizeBallTrackSamples(
    {
      ball_track: [
        { timestamp_sec: 0, image_x: 100, image_y: 200, confidence: 0.9 },
        { timestamp_sec: 0.066, image_x: 110, image_y: 210, confidence: 0.8 },
      ],
    },
    landmarksJson
  );
  if (ball.length < 1) throw new Error("expected samples");
  const [fi] = ball[0]!;
  if (fi !== 0 && fi !== 1) throw new Error(`unexpected frameIndex ${fi}`);
});

assert("sanitizeBallTrackingPayload drops invalid tuples", () => {
  const out = sanitizeBallTrackingPayload([
    [0, 0.5, 0.5, 0.9],
    [1, Number.NaN, 0.5, 0.9] as [number, number, number, number],
  ]);
  if (out.length !== 1) throw new Error(`expected 1 got ${out.length}`);
});

assert("sanitizeRacketTrackingPayload accepts valid racket tuples", () => {
  const out = sanitizeRacketTrackingPayload([[0, 0, 0.5, 0.5, 0.4]]);
  if (out.length !== 1) throw new Error("racket sanitize failed");
});

assert("normalizeRacketTrackSamples reads players[].samples", () => {
  const racket = normalizeRacketTrackSamples(
    {
      players: [
        {
          player_id: 0,
          samples: [
            { frame_idx: 0, image_x: 0.4, image_y: 0.6, confidence: 0.4, interpolated: true },
          ],
        },
      ],
    },
    landmarksJson
  );
  if (racket.length !== 1) throw new Error("expected one racket sample");
  if (racket[0]![4] !== 0.4) throw new Error("confidence mismatch");
});

// Optional: inspect latest on-disk agent artifact when present (local dev QA aid).
const agentsDir = path.join(repoRoot, "data", "analysis-agents");
if (existsSync(agentsDir)) {
  const jobs = readdirSync(agentsDir)
    .filter((f) => /^job-\d+\.json$/.test(f))
    .sort();
  const latest = jobs[jobs.length - 1];
  if (latest) {
    const raw = JSON.parse(
      readFileSync(path.join(agentsDir, latest), "utf8")
    ) as { agents?: Record<string, unknown> };
    const agents = raw.agents ?? {};
    console.log(
      `info: latest artifact ${latest} agents=${Object.keys(agents).join(",") || "(none)"}`
    );
  }
}

console.log("tracking-integration-smoke: all assertions passed");
