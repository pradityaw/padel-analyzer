import path from "path";

/** Root for SQLite DB, uploads, thumbnails, landmarks (override in Docker with PADEL_DATA_DIR=/data). */
export function getDataRoot(): string {
  return process.env.PADEL_DATA_DIR
    ? path.resolve(process.env.PADEL_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

export function getDbFilePath(): string {
  return path.join(getDataRoot(), "padel.db");
}

export function getUploadsDir(): string {
  return path.join(getDataRoot(), "uploads");
}

export function getThumbnailsDir(): string {
  return path.join(getDataRoot(), "thumbnails");
}

export function getLandmarksDir(): string {
  return path.join(getDataRoot(), "landmarks");
}
