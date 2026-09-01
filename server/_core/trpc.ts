import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import superjson from "superjson";

const t = initTRPC.create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * tRPC rate-limit middleware factory (in-memory token bucket per client IP).
 *
 * This is the tRPC-side counterpart of `createRateLimiter` (Express). Use it on
 * expensive procedures that are reached over tRPC — the analysis-create and
 * YouTube mutations. It keys on the Express `req.ip` (available because the
 * adapter is wired with `createRequestContext` and `trust proxy` is on).
 *
 * On limit exceeded it throws a tRPC `TOO_MANY_REQUESTS` error, which the
 * client surfaces the same way as any other procedure error.
 *
 * NOTE: this shares nothing with the Express upload limiter — they are separate
 * buckets by design (different route shapes). If you scale out, move both to a
 * shared store (see docs/QUEUE_DURABILITY.md).
 */

type RateBucket = { tokens: number; lastRefillMs: number };

const buckets = new Map<string, RateBucket>();
let lastSweepMs = Date.now();
const MINUTE_MS = 60_000;

function clientIpFromReq(req: unknown): string {
  if (req && typeof req === "object" && "ip" in req) {
    const ip = (req as Request).ip;
    if (typeof ip === "string") return ip;
  }
  return "unknown";
}

/**
 * @param capacity  Bucket capacity (burst size).
 * @param refillPerSecond  Sustained refill rate (tokens/sec).
 * @param id  Stable identifier for this limiter (log/debug only).
 */
export function rateLimit(opts: {
  capacity: number;
  refillPerSecond: number;
  id: string;
}) {
  const capacity = Math.max(1, opts.capacity);
  const refillPerSecond = Math.max(0.01, opts.refillPerSecond);
  return t.middleware(({ ctx, next }) => {
    const now = Date.now();
    if (now - lastSweepMs > MINUTE_MS) {
      lastSweepMs = now;
      for (const [key, bucket] of buckets) {
        if (now - bucket.lastRefillMs > 10 * MINUTE_MS) buckets.delete(key);
      }
    }

    const req = (ctx as { req?: unknown } | undefined)?.req;
    const key = clientIpFromReq(req);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { tokens: capacity - 1, lastRefillMs: now });
      return next();
    }

    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + elapsedSec * refillPerSecond,
    );
    bucket.lastRefillMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return next();
    }

    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please slow down and try again shortly.",
    });
  });
}
