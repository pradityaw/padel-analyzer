/**
 * Unit tests for client court calibration / homography speed utilities.
 * Run: npx tsx scripts/qa/court-calibration.test.ts
 *      (or npm run test:court-calibration when wired in package.json)
 */
import {
  PADEL_COURT_DIMENSIONS_M,
  calculateCourtHomography,
  calculateHomography,
  calculateSpeedKmhBetweenPixels,
  clampPointToBounds,
  createDefaultCourtCalibration,
  distanceMeters,
  estimateLocalMetersPerPixel,
  metersPerSecondToKmh,
  parseCourtCalibration,
  pixelDistancePerFrameToKmh,
  projectPixelToCourtMeters,
  type CourtCalibration,
  type HomographyMatrix,
  type Point2D,
} from "../../client/src/lib/courtCalibration.js";

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

function assertNear(actual: number, expected: number, tolerance: number, label: string) {
  if (!Number.isFinite(actual)) {
    throw new Error(`${label}: expected finite number near ${expected}, got ${actual}`);
  }
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label}: expected ${expected} ± ${tolerance}, got ${actual} (delta ${Math.abs(actual - expected)})`
    );
  }
}

function assertNull(value: unknown, label: string) {
  if (value !== null) {
    throw new Error(`${label}: expected null, got ${String(value)}`);
  }
}

function assertNoNonFinite(value: number | null, label: string) {
  if (value === null) return;
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: expected null or finite number, got ${value}`);
  }
}

/** Rectilinear quad: inner video rectangle maps linearly to the padel court floor (10×20 m). */
function makeRectilinearCalibration(
  videoWidth = 1600,
  videoHeight = 900,
  videoId = "test-video"
): CourtCalibration & { insetX: number; insetY: number; innerW: number; innerH: number } {
  const insetX = 100;
  const insetY = 90;
  const innerW = videoWidth - insetX * 2;
  const innerH = videoHeight - insetY * 2;

  return {
    version: 1,
    videoId,
    videoWidth,
    videoHeight,
    updatedAt: "2020-01-01T00:00:00.000Z",
    insetX,
    insetY,
    innerW,
    innerH,
    points: [
      { id: "topLeft", x: insetX, y: insetY },
      { id: "topRight", x: insetX + innerW, y: insetY },
      { id: "bottomRight", x: insetX + innerW, y: insetY + innerH },
      { id: "bottomLeft", x: insetX, y: insetY + innerH },
    ],
  };
}

/** Inverse of the rectilinear floor mapping used by makeRectilinearCalibration. */
function courtMetersToPixel(
  meters: Point2D,
  cal: ReturnType<typeof makeRectilinearCalibration>
): Point2D {
  const { width: courtW, length: courtL } = PADEL_COURT_DIMENSIONS_M;
  return {
    x: cal.insetX + (meters.x / courtW) * cal.innerW,
    y: cal.insetY + (meters.y / courtL) * cal.innerH,
  };
}

/**
 * Reference: speed (km/h) = court_distance_m / (frameDelta / fps) * 3.6
 * Example at 30 fps, frameDelta=1, distance=1 m → 108 km/h.
 */
function expectedKmh(distanceM: number, fps: number, frameDelta: number): number {
  return (distanceM / (frameDelta / fps)) * 3.6;
}

const FPS = 30;
const ONE_METER_HORIZONTAL_PX = 140; // innerW(1400) / court width(10)
const ONE_METER_COURT_LENGTH_PX = 36; // innerH(720) / court length(20)

assert("calculateHomography maps unit square to 10×20 m court", () => {
  const source: Point2D[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];
  const H = calculateHomography(source);
  if (!H) throw new Error("expected homography");

  const farLeft = projectPixelToCourtMeters({ x: 0, y: 0 }, H);
  const nearRight = projectPixelToCourtMeters({ x: 100, y: 200 }, H);
  if (!farLeft || !nearRight) throw new Error("projection failed");

  assertNear(farLeft.x, 0, 1e-6, "farLeft.x");
  assertNear(farLeft.y, 0, 1e-6, "farLeft.y");
  assertNear(nearRight.x, 10, 1e-5, "nearRight.x");
  assertNear(nearRight.y, 20, 1e-5, "nearRight.y");
});

assert("calculateCourtHomography rejects incomplete corner sets", () => {
  const cal = makeRectilinearCalibration();
  const broken = { ...cal, points: cal.points.slice(0, 3) };
  assertNull(calculateCourtHomography(broken), "incomplete points");
});

assert("calculateHomography returns null for collinear source points", () => {
  const collinear: Point2D[] = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
    { x: 150, y: 0 },
  ];
  assertNull(calculateHomography(collinear), "collinear quad");
});

assert("rectilinear homography round-trips center court point", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal);
  if (!H) throw new Error("expected homography");

  const centerM = { x: 5, y: 10 };
  const pixel = courtMetersToPixel(centerM, cal);
  const back = projectPixelToCourtMeters(pixel, H);
  if (!back) throw new Error("projection failed");

  assertNear(back.x, centerM.x, 0.02, "round-trip x");
  assertNear(back.y, centerM.y, 0.02, "round-trip y");
});

assert("down-the-line drive: 1 m along court width in 1 frame at 30 fps → 108 km/h", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal);
  if (!H) throw new Error("expected homography");

  const startM = { x: 4, y: 10 };
  const endM = { x: 5, y: 10 };
  const fromPx = courtMetersToPixel(startM, cal);
  const toPx = courtMetersToPixel(endM, cal);

  const kmh = calculateSpeedKmhBetweenPixels(fromPx, toPx, FPS, H, 1);
  assertNoNonFinite(kmh, "drive speed");
  assertNear(kmh!, expectedKmh(1, FPS, 1), 0.5, "horizontal 1 m / 1 frame");

  const deltaPx = ONE_METER_HORIZONTAL_PX;
  const driveByPixels = calculateSpeedKmhBetweenPixels(
    { x: fromPx.x, y: fromPx.y },
    { x: fromPx.x + deltaPx, y: fromPx.y },
    FPS,
    H,
    1
  );
  assertNear(driveByPixels!, 108, 0.5, "fixed 140 px horizontal motion");
});

assert("lob depth: 1 m along court length in 1 frame at 30 fps → 108 km/h", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal);
  if (!H) throw new Error("expected homography");

  // Floor homography has no Z axis; lob depth is modeled as motion along court Y (length).
  const startM = { x: 5, y: 8 };
  const endM = { x: 5, y: 9 };
  const fromPx = courtMetersToPixel(startM, cal);
  const toPx = courtMetersToPixel(endM, cal);

  const kmh = calculateSpeedKmhBetweenPixels(fromPx, toPx, FPS, H, 1);
  assertNoNonFinite(kmh, "lob depth speed");
  assertNear(kmh!, expectedKmh(1, FPS, 1), 0.5, "court-length 1 m / 1 frame");

  const lobByPixels = calculateSpeedKmhBetweenPixels(
    { x: fromPx.x, y: fromPx.y },
    { x: fromPx.x, y: fromPx.y + ONE_METER_COURT_LENGTH_PX },
    FPS,
    H,
    1
  );
  assertNear(lobByPixels!, 108, 0.5, "fixed 36 px vertical (court-length) motion");
});

assert("multi-frame delta scales speed inversely (2 m in 2 frames → 108 km/h)", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal);
  if (!H) throw new Error("expected homography");

  const fromPx = courtMetersToPixel({ x: 3, y: 10 }, cal);
  const toPx = courtMetersToPixel({ x: 5, y: 10 }, cal);

  const kmh = calculateSpeedKmhBetweenPixels(fromPx, toPx, FPS, H, 2);
  assertNear(kmh!, expectedKmh(2, FPS, 2), 0.5, "2 m over 2 frames");
});

assert("estimateLocalMetersPerPixel matches rectilinear scale on horizontal segment", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal);
  if (!H) throw new Error("expected homography");

  const start = courtMetersToPixel({ x: 2, y: 10 }, cal);
  const end = courtMetersToPixel({ x: 3, y: 10 }, cal);
  const mpp = estimateLocalMetersPerPixel(start, end, H);
  assertNoNonFinite(mpp, "meters per pixel");
  assertNear(mpp!, 1 / ONE_METER_HORIZONTAL_PX, 1e-5, "horizontal m/px");
});

assert("pixelDistancePerFrameToKmh matches homography speed for 140 px/frame", () => {
  const mpp = 1 / ONE_METER_HORIZONTAL_PX;
  const kmh = pixelDistancePerFrameToKmh(ONE_METER_HORIZONTAL_PX, FPS, mpp);
  assertNear(kmh!, 108, 0.5, "pixel shortcut at 30 fps");
});

assert("metersPerSecondToKmh converts 30 m/s → 108 km/h", () => {
  assertNear(metersPerSecondToKmh(30), 108, 1e-9, "30 m/s");
});

assert("distanceMeters uses Euclidean metric", () => {
  assertNear(distanceMeters({ x: 0, y: 0 }, { x: 3, y: 4 }), 5, 1e-9, "3-4-5 triangle");
});

assert("calculateSpeedKmhBetweenPixels returns null for zero/negative fps and frameDelta", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal)!;
  const a = courtMetersToPixel({ x: 4, y: 10 }, cal);
  const b = courtMetersToPixel({ x: 5, y: 10 }, cal);

  assertNull(calculateSpeedKmhBetweenPixels(a, b, 0, H, 1), "fps=0");
  assertNull(calculateSpeedKmhBetweenPixels(a, b, -30, H, 1), "negative fps");
  assertNull(calculateSpeedKmhBetweenPixels(a, b, FPS, H, 0), "frameDelta=0");
  assertNull(calculateSpeedKmhBetweenPixels(a, b, FPS, H, -1), "negative frameDelta");
  assertNull(calculateSpeedKmhBetweenPixels(a, b, Number.NaN, H, 1), "NaN fps");
});

assert("calculateSpeedKmhBetweenPixels returns null for non-finite pixels", () => {
  const cal = makeRectilinearCalibration();
  const H = calculateCourtHomography(cal)!;
  const valid = courtMetersToPixel({ x: 5, y: 10 }, cal);

  assertNull(
    calculateSpeedKmhBetweenPixels(
      { x: Number.NaN, y: valid.y },
      valid,
      FPS,
      H,
      1
    ),
    "NaN from pixel"
  );
  assertNull(
    calculateSpeedKmhBetweenPixels(
      valid,
      { x: Number.POSITIVE_INFINITY, y: valid.y },
      FPS,
      H,
      1
    ),
    "Infinity to pixel"
  );
});

assert("projectPixelToCourtMeters returns null near vanishing line", () => {
  const degenerate: HomographyMatrix = [
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, -1],
  ];
  assertNull(projectPixelToCourtMeters({ x: 1, y: 0 }, degenerate), "singular denominator");
});

assert("pixelDistancePerFrameToKmh rejects invalid inputs without NaN", () => {
  const cases: Array<[string, () => number | null]> = [
    ["negative distance", () => pixelDistancePerFrameToKmh(-1, FPS, 0.01)],
    ["zero fps", () => pixelDistancePerFrameToKmh(10, 0, 0.01)],
    ["zero mpp", () => pixelDistancePerFrameToKmh(10, FPS, 0)],
    ["NaN distance", () => pixelDistancePerFrameToKmh(Number.NaN, FPS, 0.01)],
  ];
  for (const [label, fn] of cases) {
    assertNull(fn(), label);
  }
});

assert("parseCourtCalibration rejects malformed payloads", () => {
  assertNull(parseCourtCalibration("not-json", "v1"), "invalid json");
  assertNull(parseCourtCalibration(JSON.stringify({ version: 2 }), "v1"), "wrong version");
  assertNull(
    parseCourtCalibration(
      JSON.stringify({
        version: 1,
        videoId: "other",
        videoWidth: 100,
        videoHeight: 100,
        points: [],
        updatedAt: "",
      }),
      "v1"
    ),
    "video id mismatch"
  );
});

assert("createDefaultCourtCalibration produces four ordered corners", () => {
  const cal = createDefaultCourtCalibration("clip", 1280, 720);
  if (cal.points.length !== 4) throw new Error("expected 4 points");
  const ids = cal.points.map((p) => p.id).join(",");
  if (ids !== "topLeft,topRight,bottomRight,bottomLeft") {
    throw new Error(`unexpected order: ${ids}`);
  }
});

assert("clampPointToBounds clamps to video rectangle", () => {
  const clamped = clampPointToBounds({ x: -5, y: 999 }, 100, 50);
  assertNear(clamped.x, 0, 1e-9, "clamp x min");
  assertNear(clamped.y, 50, 1e-9, "clamp y max");
});

if (process.exitCode) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(process.exitCode);
}

console.log(`\nAll court calibration checks passed (${passed} tests).`);
