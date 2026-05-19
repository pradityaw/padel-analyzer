const fallbackBaseUrl = "http://localhost:3001";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || fallbackBaseUrl;

export function isUsingLocalhostBaseUrl() {
  return API_BASE_URL.includes("localhost");
}

/** True when API is plain HTTP targeting a RFC1918-style LAN host (typical Expo dev setups). */
export function usesHttpToPrivateLanBaseUrl(): boolean {
  try {
    const u = new URL(API_BASE_URL);
    if (u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".local")) return true;
    if (/^10(\.|$)/.test(h)) return true;
    if (/^192\.168\./.test(h)) return true;
    const m172 = /^172\.(\d+)\./.exec(h);
    if (m172) {
      const second = Number(m172[1]);
      return second >= 16 && second <= 31;
    }
    return false;
  } catch {
    return false;
  }
}
