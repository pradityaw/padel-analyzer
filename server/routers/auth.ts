import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import * as schema from "../../drizzle/schema.js";
import {
  hashPassword,
  verifyPassword,
  generateSessionId,
  sessionExpiresAt,
} from "../_core/auth.js";

const credentialsSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(128),
});

export const authRouter = router({
  register: publicProcedure
    .input(credentialsSchema)
    .mutation(async ({ input }) => {
      const existing = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, input.username))
        .get();

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Username already taken",
        });
      }

      const passwordHash = await hashPassword(input.password);
      const user = await db
        .insert(schema.users)
        .values({ username: input.username, passwordHash })
        .returning({ id: schema.users.id, username: schema.users.username })
        .get();

      const sessionId = generateSessionId();
      await db.insert(schema.sessions).values({
        id: sessionId,
        userId: user.id,
        expiresAt: sessionExpiresAt(),
      });

      return { sessionId, user: { id: user.id, username: user.username } };
    }),

  login: publicProcedure
    .input(credentialsSchema)
    .mutation(async ({ input }) => {
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, input.username))
        .get();

      if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      const sessionId = generateSessionId();
      await db.insert(schema.sessions).values({
        id: sessionId,
        userId: user.id,
        expiresAt: sessionExpiresAt(),
      });

      return {
        sessionId,
        user: { id: user.id, username: user.username },
      };
    }),

  logout: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId));
      return { success: true };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await db
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.userId))
      .get();
    return user ?? null;
  }),
});
