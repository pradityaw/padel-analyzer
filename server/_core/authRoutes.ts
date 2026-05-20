import type { Express } from "express";
import { parse, serialize } from "cookie";
import {
  SESSION_COOKIE,
  consumeMagicLink,
  createSessionForUser,
} from "../lib/sessionAuth.js";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/status", (_req, res) => {
    res.json({ authMode: process.env.AUTH_MODE === "on" ? "on" : "off" });
  });

  app.get("/api/auth/verify", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.status(400).send("Missing token");
      return;
    }
    const user = consumeMagicLink(token);
    if (!user) {
      res.status(400).send("Invalid or expired link");
      return;
    }
    const { token: sessionToken, expiresAt } = createSessionForUser(user.id);
    const maxAge = Math.max(
      0,
      Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
    );
    res.setHeader(
      "Set-Cookie",
      serialize(SESSION_COOKIE, sessionToken, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge,
      })
    );
    res.redirect(302, "/");
  });
}

export function readSessionCookie(header: string | undefined): string | undefined {
  const cookies = parse(header ?? "");
  const v = cookies[SESSION_COOKIE];
  return typeof v === "string" ? v : undefined;
}
