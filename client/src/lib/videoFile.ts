/** Extensions treated as video when the browser leaves {@link File#type} empty or wrong (common on mobile Safari). */
const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv",
  ".3gp",
  ".ogv",
]);

export function isProbablyVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot === -1) return false;
  return VIDEO_FILE_EXTENSIONS.has(lower.slice(dot));
}
