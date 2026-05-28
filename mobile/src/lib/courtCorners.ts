import AsyncStorage from "@react-native-async-storage/async-storage";

export type CourtCorner = { x: number; y: number };

export type CourtCornersPayload = {
  corners: [CourtCorner, CourtCorner, CourtCorner, CourtCorner];
  previewWidth?: number;
  previewHeight?: number;
};

const STORAGE_KEY = "@padel/court-corners/v1";

/** Default padel side-view quadrilateral (normalized 0–1). */
export const DEFAULT_COURT_CORNERS: CourtCornersPayload["corners"] = [
  { x: 0.18, y: 0.2 },
  { x: 0.82, y: 0.2 },
  { x: 0.82, y: 0.88 },
  { x: 0.18, y: 0.88 },
];

export function createDefaultCourtCorners(
  previewWidth?: number,
  previewHeight?: number
): CourtCornersPayload {
  return {
    corners: DEFAULT_COURT_CORNERS.map((c) => ({ ...c })) as CourtCornersPayload["corners"],
    previewWidth,
    previewHeight,
  };
}

export async function loadSavedCourtCorners(): Promise<CourtCornersPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CourtCornersPayload;
    if (!Array.isArray(parsed.corners) || parsed.corners.length !== 4) {
      return null;
    }
    for (const corner of parsed.corners) {
      if (
        typeof corner.x !== "number" ||
        typeof corner.y !== "number" ||
        corner.x < 0 ||
        corner.x > 1 ||
        corner.y < 0 ||
        corner.y > 1
      ) {
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCourtCorners(payload: CourtCornersPayload): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
