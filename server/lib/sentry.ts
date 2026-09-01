import { logger } from "./logger.js";

export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      tracesSampleRate: 0,
    });
    logger.info("Sentry initialized");
  } catch (err) {
    logger.warn({ err }, "Sentry init skipped");
  }
}
