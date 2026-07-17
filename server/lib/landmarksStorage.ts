import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  renameSync,
} from "fs";
import { mkdirSync } from "fs";
import path from "path";
import type { Analysis } from "../../drizzle/schema.js";
import { getLandmarksDir } from "./paths.js";

/** Inline JSON kept in SQLite when the full payload lives on disk. */
export const LANDMARKS_INLINE_PLACEHOLDER = "[]";

export function landmarksFilePath(fileName: string): string {
  return path.join(getLandmarksDir(), path.basename(fileName));
}

export function landmarksFileNameForAnalysis(analysisId: number): string {
  return `${analysisId}.json`;
}

export function writeLandmarksFile(fileName: string, json: string): void {
  const dir = getLandmarksDir();
  mkdirSync(dir, { recursive: true });
  const safe = path.basename(fileName);
  const target = path.join(dir, safe);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, json, "utf8");
  renameSync(temp, target);
}

export function readLandmarksFile(fileName: string): string | null {
  const p = landmarksFilePath(fileName);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

export function deleteLandmarksFile(fileName: string | null | undefined): void {
  if (!fileName) return;
  const p = landmarksFilePath(fileName);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

/**
 * Write landmarks to disk and return the basename stored in `landmarksPath`.
 */
export function persistAnalysisLandmarks(
  analysisId: number,
  landmarksJson: string
): string {
  const fileName = landmarksFileNameForAnalysis(analysisId);
  writeLandmarksFile(fileName, landmarksJson);
  return fileName;
}

/**
 * Resolve `landmarksJson` for API responses: prefer file when `landmarksPath` is set.
 */
export function resolveLandmarksJson(
  row: Pick<Analysis, "landmarksJson" | "landmarksPath">
): string {
  if (row.landmarksPath) {
    const fromFile = readLandmarksFile(row.landmarksPath);
    if (fromFile != null) return fromFile;
    console.warn(
      `[landmarksStorage] Missing landmarks file ${row.landmarksPath}; falling back to inline JSON for analysis`
    );
  }
  return row.landmarksJson;
}
