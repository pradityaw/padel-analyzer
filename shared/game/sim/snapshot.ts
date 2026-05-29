/**
 * Helpers to project authoritative `WorldState` into the lean snapshot frames
 * sent over the wire and into end-of-match results. Shared by the server host
 * and the single-device renderer so both interpret world state identically.
 */

import type { ResultEntry, SnapshotMessage } from "../protocol/types";
import type { WorldState } from "./types";

export function worldToSnapshot(world: WorldState): SnapshotMessage {
  return {
    t: "snapshot",
    tick: world.tick,
    phase: world.phase === "over" ? "over" : "playing",
    storm: { cx: world.storm.cx, cy: world.storm.cy, radius: world.storm.radius },
    players: world.players.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      facingX: p.facingX,
      facingY: p.facingY,
      hp: p.hp,
      alive: p.alive,
    })),
    projectiles: world.projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y })),
  };
}

/**
 * Final standings: the winner (still alive) places 1st, then the dead are
 * ranked by who survived longest (latest `diedAtTick` first).
 */
export function worldToResults(world: WorldState): ResultEntry[] {
  const ranked = [...world.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive && b.alive) return b.kills - a.kills;
    return b.diedAtTick - a.diedAtTick;
  });
  return ranked.map((p, index) => ({
    id: p.id,
    name: p.name,
    placement: index + 1,
    kills: p.kills,
  }));
}
