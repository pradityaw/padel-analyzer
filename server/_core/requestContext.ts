/**
 * Minimal request-only tRPC context: exposes the Express `req`/`res` to
 * procedures so they can read `req.ip` (for per-client rate limiting) WITHOUT
 * the per-request auth DB lookup.
 *
 * This is deliberately separate from `_core/context.ts` (the richer auth
 * context), which is excluded from the typecheck program until auth storage
 * ships (Phase 0.3/4.1). Keeping this dependency-free keeps it inside the
 * compiled program. When auth storage lands, the adapter can switch to the full
 * `createContext` from `context.ts` instead.
 */
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

export async function createRequestContext({
  req,
  res,
}: CreateExpressContextOptions) {
  return { req, res };
}

export type RequestContext = Awaited<ReturnType<typeof createRequestContext>>;
