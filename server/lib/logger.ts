/**
 * Shared structured logger for the server.
 *
 * Wraps Pino with a stable, minimal surface so call sites can switch from
 * ad-hoc `console.*` without changing control flow. Output is JSON when
 * `NODE_ENV=production` (single line per event, parseable by log shippers);
 * in development Pino's `pino-pretty`-style fallback keeps lines readable.
 *
 * Why a thin wrapper instead of exporting the raw Pino instance:
 *   - keeps a tiny, typed API (`logger.info/warn/error/debug`) so future
 *     transports or redaction rules live in one place;
 *   - lets us degrade gracefully if Pino ever needs to be swapped out.
 */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: {
    service: "padel-analyzer",
    // Keep the default `pid`/`hostname` (useful for multi-instance Fly logs).
  },
  // In dev, emit one-line readable logs without requiring pino-pretty as a dep.
  // Pino falls back to its default JSON transport otherwise.
  transport: isProduction
    ? undefined
    : {
        target: "pino/file",
        options: { destination: 1, colorize: true, translateTime: "SYS:HH:MM:ss" },
      },
  redact: {
    // Never log credentials, magic-link tokens, or session cookies.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "sessionToken",
      "token",
      "*.token",
      "password",
      "*.password",
      "accessToken",
      "secretAccessKey",
      "*.secretAccessKey",
    ],
    censor: "[REDACTED]",
  },
});

export const logger = baseLogger;

export type Logger = typeof baseLogger;
