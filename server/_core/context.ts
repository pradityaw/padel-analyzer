import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse } from "cookie";
import { eq, gt } from "drizzle-orm";
import { db } from "../db.js";
import * as schema from "../../drizzle/schema.js";
import type { TRPCContext } from "./trpc.js";

export async function createContext({
  req,
}: CreateExpressContextOptions): Promise<TRPCContext> {
  const cookies = parse(req.headers.cookie || "");
  const sessionId = cookies["session"];

  if (!sessionId) {
    return { userId: null };
  }

  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();

  if (!session || session.expiresAt < new Date().toISOString()) {
    return { userId: null };
  }

  return { userId: session.userId };
}
