import pino from "pino";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }),
});

export function requestIdMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const reqId =
    (req.headers["x-request-id"] as string) || crypto.randomUUID();
  (req as any).id = reqId;
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const reqId = (req as any).id ?? "-";

  res.on("finish", () => {
    logger.info(
      {
        reqId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - start,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode}`
    );
  });

  next();
}
