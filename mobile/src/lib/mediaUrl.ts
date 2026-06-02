import { API_BASE_URL } from "./config";

/** Mirror of `shared/videoPlayback.ts` — keep mobile build independent of shared/. */
export function buildVideoPlaybackUrl(storageKey: string): string {
  const trimmed = storageKey.trim();
  if (!trimmed) return "";
  return `/api/video/${encodeURIComponent(trimmed)}`;
}

/** Resolve server-relative upload paths for expo-av (Expo Go on device). */
export function resolveUploadUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
