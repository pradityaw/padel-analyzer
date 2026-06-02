/**
 * Build the app-relative URL for streaming an uploaded video by storage key.
 *
 * Local keys are bare filenames (`upload_*.mp4`). Cloud keys include the object
 * prefix (`uploads/<id>.mp4`). Always route through `/api/video/…` so the server
 * can serve disk files or redirect to a presigned object URL.
 */
export function buildVideoPlaybackUrl(storageKey: string): string {
  const trimmed = storageKey.trim();
  if (!trimmed) return "";
  return `/api/video/${encodeURIComponent(trimmed)}`;
}
