/**
 * tRPC lobby endpoints for Arena Royale. These cover the REST-style bits of a
 * session — creating a room and checking a code before opening the realtime
 * WebSocket. Live gameplay (join roster, inputs, snapshots) all flows over the
 * `/game` WebSocket, not tRPC.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure } from "../_core/trpc.js";
import { db } from "../db.js";
import { gameResults } from "../../drizzle/schema.js";
import { MAX_PLAYERS } from "../../shared/game/sim/constants.js";
import { ROOM_CODE_REGEX } from "../../shared/game/protocol/messages.js";
import { matchRegistry } from "../game/matchRegistry.js";

const roomCodeInput = z.object({
  code: z.string().regex(ROOM_CODE_REGEX),
});

export const gameRouter = router({
  /** Create a new battle lobby; returns the room code to share. */
  createSession: publicProcedure.mutation(() => {
    const match = matchRegistry.createSession();
    return { code: match.code };
  }),

  /** Validate a code before connecting (so the join screen can show why not). */
  checkSession: publicProcedure.input(roomCodeInput).query(({ input }) => {
    const match = matchRegistry.get(input.code);
    if (!match) {
      return { exists: false, joinable: false, reason: "not_found" as const };
    }
    if (match.phase !== "lobby") {
      return { exists: true, joinable: false, reason: "started" as const };
    }
    if (match.playerCount >= MAX_PLAYERS) {
      return { exists: true, joinable: false, reason: "full" as const };
    }
    return { exists: true, joinable: true, reason: "ok" as const };
  }),

  /** Final standings for a finished battle (persisted). */
  getResult: publicProcedure.input(roomCodeInput).query(async ({ input }) => {
    const row = await db
      .select()
      .from(gameResults)
      .where(eq(gameResults.code, input.code))
      .get();
    if (!row) return null;
    return {
      code: row.code,
      winnerName: row.winnerName,
      durationMs: row.durationMs,
      endedAt: row.endedAt,
      results: JSON.parse(row.resultsJson) as Array<{
        id: string;
        name: string;
        placement: number;
        kills: number;
      }>,
    };
  }),
});
