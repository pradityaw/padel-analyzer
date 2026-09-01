import { initTRPC, TRPCError } from "@trpc/server";
import type { Request } from "express";
import superjson from "superjson";
import type { Context } from "./context.js";
import { getAuthMode } from "./context.js";

function sanitizeErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (
    /sqlite|no such table|SQLITE_|better-sqlite|drizzle|yt-dlp|Traceback|ECONNREFUSED/i.test(
      compact,
    )
  ) {
    return "Something went wrong. Please try again.";
  }
  return compact.slice(0, 300);
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const production = process.env.NODE_ENV === "production";
    return {
      ...shape,
      message: production ? sanitizeErrorMessage(error.message) : error.message,
      data: {
        ...shape.data,
        stack: production ? undefined : shape.data.stack,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (getAuthMode() === "off") {
    return next({ ctx });
  }
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to continue.",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

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

    const req = ctx.req;
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
