export type CourtPointId = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";

export type Point2D = {
  x: number;
  y: number;
};

export type CourtCalibrationPoint = Point2D & {
  id: CourtPointId;
};

export type CourtCalibration = {
  version: 1;
  videoId: string;
  videoWidth: number;
  videoHeight: number;
  points: CourtCalibrationPoint[];
  updatedAt: string;
};

export type HomographyMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export type CourtDimensionsMeters = {
  width: number;
  length: number;
};

const STORAGE_PREFIX = "padel-analyzer:court-calibration:v1:";
const STORAGE_VERSION = 1;

export const PADEL_COURT_DIMENSIONS_M: CourtDimensionsMeters = {
  width: 10,
  length: 20,
};

export const COURT_POINT_ORDER: CourtPointId[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
];

export const COURT_POINT_LABELS: Record<CourtPointId, string> = {
  topLeft: "Far left",
  topRight: "Far right",
  bottomRight: "Near right",
  bottomLeft: "Near left",
};

function storageKey(videoId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(videoId)}`;
}

function isFinitePoint(value: unknown): value is Point2D {
  if (typeof value !== "object" || value == null) return false;
  const point = value as Partial<Point2D>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isCourtPoint(value: unknown): value is CourtCalibrationPoint {
  if (!isFinitePoint(value)) return false;
  const point = value as Partial<CourtCalibrationPoint>;
  return COURT_POINT_ORDER.includes(point.id as CourtPointId);
}

function sortCourtPoints(points: CourtCalibrationPoint[]): CourtCalibrationPoint[] {
  return COURT_POINT_ORDER.map((id) => points.find((point) => point.id === id)).filter(
    Boolean
  ) as CourtCalibrationPoint[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sanitizeVideoId(videoId: string): string {
  return videoId.trim() || "unknown-video";
}

export function clampPointToBounds(point: Point2D, width: number, height: number): Point2D {
  return {
    x: clamp(point.x, 0, Math.max(0, width)),
    y: clamp(point.y, 0, Math.max(0, height)),
  };
}

export function createDefaultCourtCalibration(
  videoId: string,
  videoWidth: number,
  videoHeight: number
): CourtCalibration {
  const width = Math.max(1, videoWidth);
  const height = Math.max(1, videoHeight);
  const insetX = width * 0.18;
  const insetTop = height * 0.18;
  const insetBottom = height * 0.12;

  return {
    version: STORAGE_VERSION,
    videoId: sanitizeVideoId(videoId),
    videoWidth: width,
    videoHeight: height,
    points: [
      { id: "topLeft", x: insetX, y: insetTop },
      { id: "topRight", x: width - insetX, y: insetTop },
      { id: "bottomRight", x: width - insetX * 0.35, y: height - insetBottom },
      { id: "bottomLeft", x: insetX * 0.35, y: height - insetBottom },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function scaleCalibrationToVideoSize(
  calibration: CourtCalibration,
  videoWidth: number,
  videoHeight: number
): CourtCalibration {
  const targetWidth = Math.max(1, videoWidth);
  const targetHeight = Math.max(1, videoHeight);
  const sx = targetWidth / Math.max(1, calibration.videoWidth);
  const sy = targetHeight / Math.max(1, calibration.videoHeight);

  return {
    ...calibration,
    videoWidth: targetWidth,
    videoHeight: targetHeight,
    points: sortCourtPoints(calibration.points).map((point) => {
      const scaled = clampPointToBounds(
        { x: point.x * sx, y: point.y * sy },
        targetWidth,
        targetHeight
      );
      return { ...point, ...scaled };
    }),
  };
}

export function parseCourtCalibration(
  raw: string,
  expectedVideoId: string
): CourtCalibration | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CourtCalibration>;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (parsed.videoId !== sanitizeVideoId(expectedVideoId)) return null;
    if (
      typeof parsed.videoWidth !== "number" ||
      typeof parsed.videoHeight !== "number" ||
      !Number.isFinite(parsed.videoWidth) ||
      !Number.isFinite(parsed.videoHeight)
    ) {
      return null;
    }
    if (!Array.isArray(parsed.points) || parsed.points.length !== COURT_POINT_ORDER.length) {
      return null;
    }

    const points = sortCourtPoints(parsed.points.filter(isCourtPoint));
    if (points.length !== COURT_POINT_ORDER.length) return null;

    return {
      version: STORAGE_VERSION,
      videoId: parsed.videoId,
      videoWidth: Math.max(1, parsed.videoWidth),
      videoHeight: Math.max(1, parsed.videoHeight),
      points,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function loadCourtCalibration(
  videoId: string,
  videoWidth: number,
  videoHeight: number,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage
): CourtCalibration | null {
  if (!storage) return null;
  const raw = storage.getItem(storageKey(sanitizeVideoId(videoId)));
  if (!raw) return null;
  const parsed = parseCourtCalibration(raw, videoId);
  return parsed ? scaleCalibrationToVideoSize(parsed, videoWidth, videoHeight) : null;
}

export function saveCourtCalibration(
  calibration: CourtCalibration,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage
): boolean {
  if (!storage) return false;
  try {
    const normalized: CourtCalibration = {
      ...calibration,
      version: STORAGE_VERSION,
      videoId: sanitizeVideoId(calibration.videoId),
      points: sortCourtPoints(calibration.points),
      updatedAt: new Date().toISOString(),
    };
    storage.setItem(storageKey(normalized.videoId), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function updateCalibrationPoint(
  calibration: CourtCalibration,
  pointId: CourtPointId,
  nextPoint: Point2D
): CourtCalibration {
  const clamped = clampPointToBounds(
    nextPoint,
    calibration.videoWidth,
    calibration.videoHeight
  );
  return {
    ...calibration,
    points: sortCourtPoints(
      calibration.points.map((point) =>
        point.id === pointId ? { ...point, ...clamped } : point
      )
    ),
    updatedAt: new Date().toISOString(),
  };
}

function courtTargetPoints(dimensions: CourtDimensionsMeters): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: dimensions.width, y: 0 },
    { x: dimensions.width, y: dimensions.length },
    { x: 0, y: dimensions.length },
  ];
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex] ?? 0]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot]![col]!) < 1e-10) {
      return null;
    }

    if (pivot !== col) {
      const tmp = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = tmp;
    }

    const pivotValue = a[col]![col]!;
    for (let c = col; c <= n; c++) {
      a[col]![c] = a[col]![c]! / pivotValue;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (Math.abs(factor) < 1e-14) continue;
      for (let c = col; c <= n; c++) {
        a[row]![c] = a[row]![c]! - factor * a[col]![c]!;
      }
    }
  }

  return a.map((row) => row[n]!);
}

export function calculateHomography(
  sourcePixels: Point2D[],
  targetMeters: Point2D[] = courtTargetPoints(PADEL_COURT_DIMENSIONS_M)
): HomographyMatrix | null {
  if (sourcePixels.length !== 4 || targetMeters.length !== 4) return null;

  const matrix: number[][] = [];
  const vector: number[] = [];

  for (let i = 0; i < 4; i++) {
    const source = sourcePixels[i]!;
    const target = targetMeters[i]!;
    if (!isFinitePoint(source) || !isFinitePoint(target)) return null;

    matrix.push([source.x, source.y, 1, 0, 0, 0, -target.x * source.x, -target.x * source.y]);
    vector.push(target.x);
    matrix.push([0, 0, 0, source.x, source.y, 1, -target.y * source.x, -target.y * source.y]);
    vector.push(target.y);
  }

  const h = solveLinearSystem(matrix, vector);
  if (!h) return null;

  return [
    [h[0]!, h[1]!, h[2]!],
    [h[3]!, h[4]!, h[5]!],
    [h[6]!, h[7]!, 1],
  ];
}

export function calculateCourtHomography(
  calibration: CourtCalibration,
  dimensions: CourtDimensionsMeters = PADEL_COURT_DIMENSIONS_M
): HomographyMatrix | null {
  const points = sortCourtPoints(calibration.points);
  if (points.length !== COURT_POINT_ORDER.length) return null;
  return calculateHomography(points, courtTargetPoints(dimensions));
}

export function projectPixelToCourtMeters(
  point: Point2D,
  homography: HomographyMatrix
): Point2D | null {
  const denominator =
    homography[2][0] * point.x + homography[2][1] * point.y + homography[2][2];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) return null;

  const x =
    (homography[0][0] * point.x + homography[0][1] * point.y + homography[0][2]) /
    denominator;
  const y =
    (homography[1][0] * point.x + homography[1][1] * point.y + homography[1][2]) /
    denominator;

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function distanceMeters(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function metersPerSecondToKmh(metersPerSecond: number): number {
  return metersPerSecond * 3.6;
}

export function calculateSpeedKmhBetweenPixels(
  fromPixel: Point2D,
  toPixel: Point2D,
  fps: number,
  homography: HomographyMatrix,
  frameDelta = 1
): number | null {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(frameDelta) || frameDelta <= 0) {
    return null;
  }

  const fromMeters = projectPixelToCourtMeters(fromPixel, homography);
  const toMeters = projectPixelToCourtMeters(toPixel, homography);
  if (!fromMeters || !toMeters) return null;

  const elapsedSeconds = frameDelta / fps;
  return metersPerSecondToKmh(distanceMeters(fromMeters, toMeters) / elapsedSeconds);
}

export function estimateLocalMetersPerPixel(
  segmentStartPixel: Point2D,
  segmentEndPixel: Point2D,
  homography: HomographyMatrix
): number | null {
  const pixelDistance = distanceMeters(segmentStartPixel, segmentEndPixel);
  if (pixelDistance <= 0) return null;

  const startMeters = projectPixelToCourtMeters(segmentStartPixel, homography);
  const endMeters = projectPixelToCourtMeters(segmentEndPixel, homography);
  if (!startMeters || !endMeters) return null;

  return distanceMeters(startMeters, endMeters) / pixelDistance;
}

export function pixelDistancePerFrameToKmh(
  pixelDistancePerFrame: number,
  fps: number,
  metersPerPixel: number
): number | null {
  if (
    !Number.isFinite(pixelDistancePerFrame) ||
    !Number.isFinite(fps) ||
    !Number.isFinite(metersPerPixel) ||
    pixelDistancePerFrame < 0 ||
    fps <= 0 ||
    metersPerPixel <= 0
  ) {
    return null;
  }
  return metersPerSecondToKmh(pixelDistancePerFrame * metersPerPixel * fps);
}
