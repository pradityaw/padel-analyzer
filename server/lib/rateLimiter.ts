/**
 * Lightweight in-memory token-bucket rate limiter for Express.
 *
 * Rationale: the old audit flagged that rate limiting was absent on the
 * expensive routes (upload, analysis create, youtube). Rather than add a new
 * declared dependency, this is a small, dependency-free token bucket that is
 * sufficient for a single-instance deployment (the current Fly topology).
 *
 * Limits are per-remote-IP (falls back to a single bucket if no IP is present,
 * e.g. behind a misconfigured proxy). Buckets are kept in a Map and pruned
 * lazily; for a scaled deployment see docs/QUEUE_DURABILITY.md (you would move
 * to a shared store such as Upstash Redis).
 *
 * Auth-exempt note: the heavy routes here are public procedures that run
 * before session auth in the current topology, so the limiter applies to all
 * callers. Magic-link auth (when AUTH_MODE=on) does not bypass it — that is
 * intentional: an authenticated abuser should still be throttled.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { clientIpFromRequest } from "./clientIp.js";

export type RateLimiterOptions = {
  /** Bucket capacity (burst size). */
  capacity: number;
  /** Tokens refilled per second (sustained rate). */
  refillPerSecond: number;
  /** Identifier prefix for log lines / headers. */
  id?: string;
};

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

const MINUTE_MS = 60_000;

function clientIp(req: Request): string {
  return clientIpFromRequest(req);
}

/**
 * Create an Express middleware that enforces a token-bucket limit per client IP.
 *
 * On limit exceeded it responds 429 with a Retry-After header (seconds) and a
 * JSON body compatible with the existing API error shape.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const capacity = Math.max(1, options.capacity);
  const refillPerSecond = Math.max(0.01, options.refillPerSecond);
  const id = options.id ?? "rate-limit";
  const buckets = new Map<string, Bucket>();

  // Bound memory: periodically drop idle buckets older than the window.
  let lastSweepMs = Date.now();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastSweepMs > MINUTE_MS) {
      lastSweepMs = now;
      for (const [key, bucket] of buckets) {
        if (now - bucket.lastRefillMs > 10 * MINUTE_MS) {
          buckets.delete(key);
        }
      }
    }

    const key = clientIp(req);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { tokens: capacity - 1, lastRefillMs: now });
      return next();
    }

    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return next();
    }

    const retryAfterSec = Math.ceil((1 - bucket.tokens) / refillPerSecond);
    res.setHeader("Retry-After", String(Math.max(1, retryAfterSec)));
    res.setHeader("X-RateLimit-Policy", id);
    res.status(429).json({
      error: `Too many requests. Please wait ${Math.max(1, retryAfterSec)}s and try again.`,
    });
  };
}
