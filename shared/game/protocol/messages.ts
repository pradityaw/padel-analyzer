/**
 * Zod schemas for validating inbound Arena Royale frames on the server. These
 * mirror the pure types in `./types`. The mobile client does NOT import this
 * module (it has no zod dependency); it uses the plain types instead.
 *
 * Room codes are short, uppercase, unambiguous (no 0/O/1/I) — see
 * `../session.ts`.
 */

import { z } from "zod";
import type { ClientMessage } from "./types";

export const ROOM_CODE_REGEX = /^[A-Z2-9]{4,6}$/;

const finite = z.number().finite();
const axis = z.number().min(-1).max(1);

export const joinMessageSchema = z.object({
  t: z.literal("join"),
  roomCode: z.string().regex(ROOM_CODE_REGEX),
  name: z.string().trim().min(1).max(16),
});

export const startMessageSchema = z.object({ t: z.literal("start") });

export const inputMessageSchema = z.object({
  t: z.literal("input"),
  tick: z.number().int().min(0),
  moveX: axis,
  moveY: axis,
  aimX: finite,
  aimY: finite,
  fire: z.boolean(),
});

export const leaveMessageSchema = z.object({ t: z.literal("leave") });

export const pingMessageSchema = z.object({
  t: z.literal("ping"),
  ts: z.number(),
});

export const clientMessageSchema = z.discriminatedUnion("t", [
  joinMessageSchema,
  startMessageSchema,
  inputMessageSchema,
  leaveMessageSchema,
  pingMessageSchema,
]);

/** Parse a raw WebSocket frame into a typed ClientMessage, or null if invalid. */
export function decodeClientMessage(raw: string | Buffer): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = clientMessageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
