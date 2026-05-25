import { NativeModules } from "react-native";

const fallbackBaseUrl = "http://localhost:3001";
const fallbackApiPort = "3001";

function stripTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function isPrivateLanHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
  if (h.endsWith(".local")) return true;
  if (/^10(\.|$)/.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function getExpoGoLanBaseUrl(): string | null {
  const scriptUrl =
    (NativeModules.SourceCode as { scriptURL?: string } | undefined)?.scriptURL;

  if (!scriptUrl) return null;

  try {
    const { hostname } = new URL(scriptUrl);
    if (!isPrivateLanHost(hostname)) return null;
    const port = process.env.EXPO_PUBLIC_API_PORT?.trim() || fallbackApiPort;
    return `http://${hostname}:${port}`;
  } catch {
    return null;
  }
}

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

export const API_BASE_URL = stripTrailingSlash(
  configuredBaseUrl || getExpoGoLanBaseUrl() || fallbackBaseUrl
);

export function isUsingLocalhostBaseUrl() {
  return API_BASE_URL.includes("localhost");
}

/** True when API is plain HTTP targeting a RFC1918-style LAN host (typical Expo dev setups). */
export function usesHttpToPrivateLanBaseUrl(): boolean {
  try {
    const u = new URL(API_BASE_URL);
    if (u.protocol !== "http:") return false;
    return isPrivateLanHost(u.hostname);
  } catch {
    return false;
  }
}

/** Set when refreshing Expo — visible on Home in dev to confirm latest bundle. */
export const DEV_BUILD_STAMP =
  process.env.EXPO_PUBLIC_DEV_BUILD_STAMP?.trim() || "unknown";
