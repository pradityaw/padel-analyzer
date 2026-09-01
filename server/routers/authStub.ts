import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc.js";

function getAuthMode(): "on" | "off" {
  return process.env.AUTH_MODE === "on" ? "on" : "off";
}

/** Lightweight auth surface until session DB tables ship in drizzle/schema. */
export const authRouter = router({
  getSession: publicProcedure.query(() => ({
    authMode: getAuthMode(),
    user: null,
  })),

  requestMagicLink: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(() => {
      if (getAuthMode() === "on") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign-in is not available until auth storage is configured.",
        });
      }
      return { ok: true as const, devMagicLinkUrl: undefined };
    }),

  logout: publicProcedure.mutation(() => ({ ok: true as const })),
});
