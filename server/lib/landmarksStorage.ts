import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { mkdirSync } from "fs";
import path from "path";
import type { Analysis } from "../../drizzle/schema.js";
import { getLandmarksDir } from "./paths.js";

export function landmarksFilePath(fileName: string): string {
  return path.join(getLandmarksDir(), path.basename(fileName));
}

export function writeLandmarksFile(fileName: string, json: string): void {
  const dir = getLandmarksDir();
  mkdirSync(dir, { recursive: true });
  const safe = path.basename(fileName);
  writeFileSync(path.join(dir, safe), json, "utf8");
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
 * Resolve `landmarksJson` for API responses: prefer file when `landmarksPath` is set.
 */
export function resolveLandmarksJson(row: Analysis): string {
  return row.landmarksJson;
}
