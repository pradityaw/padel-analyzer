import { createHash, randomBytes } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db.js";
import {
  users,
  sessions,
  magicLinkChallenges,
} from "../../drizzle/schema.js";

const SESSION_COOKIE = "padel_session";
const MAGIC_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pepper(): string {
  return process.env.SESSION_SECRET || "dev-insecure-change-me";
}

export function hashMagicToken(token: string): string {
  return createHash("sha256").update(pepper() + token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export { SESSION_COOKIE };

export type SessionUser = { id: number; email: string };

export async function findUserBySessionToken(
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token) return null;
  const now = new Date().toISOString();
  const row = db
    .select({
      id: users.id,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .get();
  return row ?? null;
}

export function getOrCreateUserByEmail(email: string): { id: number; email: string } {
  const normalized = email.trim().toLowerCase();
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .get();
  if (existing) return { id: existing.id, email: existing.email };

  const inserted = db
    .insert(users)
    .values({ email: normalized })
    .returning()
    .get();
  if (!inserted) throw new Error("Failed to create user");
  return { id: inserted.id, email: inserted.email };
}

export function createMagicLinkChallenge(email: string, tokenHash: string): void {
  const expires = new Date(Date.now() + MAGIC_TTL_MS).toISOString();
  db.insert(magicLinkChallenges).values({
    email: email.trim().toLowerCase(),
    tokenHash,
    expiresAt: expires,
  }).run();
}

export function consumeMagicLink(token: string): SessionUser | null {
  const hash = hashMagicToken(token);
  const now = new Date().toISOString();
  const row = db
    .select()
    .from(magicLinkChallenges)
    .where(
      and(eq(magicLinkChallenges.tokenHash, hash), gt(magicLinkChallenges.expiresAt, now))
    )
    .get();
  if (!row) return null;

  db.delete(magicLinkChallenges).where(eq(magicLinkChallenges.id, row.id)).run();

  const user = getOrCreateUserByEmail(row.email);
  return user;
}

export function createSessionForUser(userId: number): { token: string; expiresAt: string } {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.insert(sessions)
    .values({ userId, token, expiresAt })
    .run();
  return { token, expiresAt };
}

export function deleteSessionToken(token: string): void {
  db.delete(sessions).where(eq(sessions.token, token)).run();
}
