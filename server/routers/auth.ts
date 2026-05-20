import { randomBytes } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { serialize } from "cookie";
import { router, publicProcedure } from "../_core/trpc.js";
import { getAuthMode } from "../_core/context.js";
import {
  SESSION_COOKIE,
  createMagicLinkChallenge,
  hashMagicToken,
  deleteSessionToken,
} from "../lib/sessionAuth.js";

export const authRouter = router({
  getSession: publicProcedure.query(({ ctx }) => ({
    authMode: ctx.authMode,
    user: ctx.user,
  })),

  requestMagicLink: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(({ input }) => {
      if (getAuthMode() === "off") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Authentication is disabled on this server",
        });
      }
      const token = randomBytes(32).toString("hex");
      createMagicLinkChallenge(input.email, hashMagicToken(token));
      const base =
        process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
        `http://127.0.0.1:${process.env.PORT || "3001"}`;
      const url = `${base}/api/auth/verify?token=${token}`;
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[auth] Magic link for ${input.email}: ${url}`);
      }
      return {
        ok: true as const,
        devMagicLinkUrl:
          process.env.NODE_ENV !== "production" ? url : undefined,
      };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    if (ctx.sessionToken) {
      deleteSessionToken(ctx.sessionToken);
    }
    ctx.res.setHeader(
      "Set-Cookie",
      serialize(SESSION_COOKIE, "", {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 0,
      })
    );
    return { ok: true as const };
  }),
});
