/**
 * In-memory registry of live Arena Royale matches, keyed by room code.
 *
 * Authoritative match state is intentionally NOT in SQLite — only the lobby
 * row and the final results are persisted (see drizzle/schema.ts). The
 * registry owns the per-match tick driver (a single interval at TICK_RATE),
 * persists results when a match ends, and garbage-collects abandoned lobbies.
 */

import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { gameResults, gameSessions } from "../../drizzle/schema.js";
import { TICK_RATE } from "../../shared/game/sim/constants.js";
import type { ResultEntry } from "../../shared/game/protocol/types.js";
import { LiveMatch } from "./liveMatch.js";
import { generateRoomCode } from "./session.js";

const TICK_INTERVAL_MS = 1000 / TICK_RATE;
/** Drop a match that has been empty (all peers gone) for this long. */
const EMPTY_GRACE_MS = 30_000;
/** Keep a finished match around briefly so late snapshots/results land. */
const FINISHED_LINGER_MS = 60_000;

interface Entry {
  match: LiveMatch;
  driver: ReturnType<typeof setInterval> | null;
  emptySince: number | null;
}

export class MatchRegistry {
  private entries = new Map<string, Entry>();
  private gc: ReturnType<typeof setInterval> | null = null;

  /** Create a fresh lobby with a unique code and persist the lobby row. */
  createSession(): LiveMatch {
    let code = generateRoomCode();
    while (this.entries.has(code)) code = generateRoomCode();

    const match = new LiveMatch(code);
    match.onComplete = (results, durationMs) =>
      this.persistResult(code, results, durationMs);
    this.entries.set(code, { match, driver: null, emptySince: null });

    void db
      .insert(gameSessions)
      .values({ code })
      .onConflictDoNothing()
      .catch(() => {});

    this.ensureGc();
    return match;
  }

  get(code: string): LiveMatch | undefined {
    return this.entries.get(code)?.match;
  }

  /** Start the tick driver for a match (idempotent). Call when it goes live. */
  ensureDriver(code: string): void {
    const entry = this.entries.get(code);
    if (!entry || entry.driver) return;
    entry.driver = setInterval(() => {
      entry.match.tick();
      if (entry.match.isFinished() && entry.driver) {
        clearInterval(entry.driver);
        entry.driver = null;
      }
    }, TICK_INTERVAL_MS);
    void db
      .update(gameSessions)
      .set({ status: "playing" })
      .where(eq(gameSessions.code, code))
      .catch(() => {});
  }

  private async persistResult(
    code: string,
    results: ResultEntry[],
    durationMs: number,
  ): Promise<void> {
    const winner = results.find((r) => r.placement === 1) ?? null;
    const endedAt = new Date().toISOString();
    try {
      await db
        .insert(gameResults)
        .values({
          code,
          winnerName: winner?.name ?? null,
          resultsJson: JSON.stringify(results),
          durationMs,
          endedAt,
        })
        .onConflictDoNothing();
      await db
        .update(gameSessions)
        .set({ status: "over", endedAt })
        .where(eq(gameSessions.code, code));
    } catch {
      /* best-effort: a dropped result row should never crash the match loop */
    }
  }

  private ensureGc(): void {
    if (this.gc) return;
    this.gc = setInterval(() => this.sweep(), 10_000);
    // Don't keep the process alive solely for GC.
    this.gc.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [code, entry] of this.entries) {
      const empty = entry.match.isEmpty();
      if (empty && entry.emptySince === null) {
        entry.emptySince = now;
      } else if (!empty) {
        entry.emptySince = null;
      }

      const finishedTooLong =
        entry.match.isFinished() &&
        entry.emptySince !== null &&
        now - entry.emptySince > FINISHED_LINGER_MS;
      const abandoned =
        entry.emptySince !== null && now - entry.emptySince > EMPTY_GRACE_MS;

      if (finishedTooLong || abandoned) {
        if (entry.driver) clearInterval(entry.driver);
        this.entries.delete(code);
      }
    }
  }
}

/** Process-wide singleton shared by the WebSocket server and the tRPC router. */
export const matchRegistry = new MatchRegistry();
