import type { Request } from "express";

/**
 * Rate-limit identity for a request.
 *
 * Do not use the leftmost X-Forwarded-For hop (`trust proxy: true` + `req.ip`).
 * On Fly, `Fly-Client-IP` is the TCP peer at the edge and is not attacker-set.
 * Locally, use the socket address.
 */
export function clientIpFromRequest(req: Request | undefined): string {
  if (!req) return "unknown";
  if (process.env.FLY_APP_NAME) {
    const fly = req.get("fly-client-ip")?.trim();
    if (fly) return fly;
  }
  return req.socket?.remoteAddress ?? "unknown";
}
