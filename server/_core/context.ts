import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { findUserBySessionToken } from "../lib/sessionAuth.js";
import { readSessionCookie } from "./authRoutes.js";

export type AuthMode = "off" | "on";

export function getAuthMode(): AuthMode {
  return process.env.AUTH_MODE === "on" ? "on" : "off";
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  const authMode = getAuthMode();
  const sessionToken = readSessionCookie(req.headers.cookie);
  const user = await findUserBySessionToken(sessionToken);
  return { req, res, user, authMode, sessionToken };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
