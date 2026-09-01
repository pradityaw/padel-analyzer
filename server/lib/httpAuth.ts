import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuthMode } from "../_core/context.js";
import { readSessionCookie } from "../_core/authRoutes.js";
import {
  findUserBySessionToken,
  type SessionUser,
} from "./sessionAuth.js";

export type AuthedRequest = Request & { authUser?: SessionUser };

export function requireAuthWhenEnabled(): RequestHandler {
  return (req, res, next) => {
    if (getAuthMode() === "off") {
      next();
      return;
    }
    void attachUser(req as AuthedRequest, res, next);
  };
}

async function attachUser(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await findUserBySessionToken(
    readSessionCookie(req.headers.cookie),
  );
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  req.authUser = user;
  next();
}
