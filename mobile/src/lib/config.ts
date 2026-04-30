const fallbackBaseUrl = "http://localhost:3001";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || fallbackBaseUrl;

export function isUsingLocalhostBaseUrl() {
  return API_BASE_URL.includes("localhost");
}
