/**
 * Single source of truth for Arena Royale gameplay tuning. Both the
 * authoritative host (server) and the renderer (mobile) import from here so
 * arena dimensions, speeds, and the storm schedule never drift between them.
 *
 * Distances are in abstract "arena units"; the renderer scales the arena to
 * fit the device screen. Time-based values are derived from TICK_RATE.
 */

import type { WorldConfig } from "./types";

/** Authoritative simulation rate (Hz). */
export const TICK_RATE = 30;
/** Snapshot broadcast rate (Hz) — lower than the tick rate to save bandwidth. */
export const SNAPSHOT_RATE = 20;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Lobby countdown before a match starts (seconds). */
export const COUNTDOWN_SECONDS = 3;

export const ARENA_WIDTH = 1000;
export const ARENA_HEIGHT = 600;

const seconds = (s: number) => Math.round(s * TICK_RATE);

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  arenaWidth: ARENA_WIDTH,
  arenaHeight: ARENA_HEIGHT,
  tickRate: TICK_RATE,
  playerRadius: 24,
  moveSpeed: 220,
  playerMaxHp: 100,
  projectileSpeed: 520,
  projectileRadius: 9,
  projectileDamage: 18,
  projectileTtlTicks: seconds(1.4),
  fireCooldownTicks: seconds(0.35),
  stormShrinkStartTick: seconds(5),
  // Covers the arena from its center (half-diagonal ≈ 583) at the start.
  stormStartRadius: 585,
  stormMinRadius: 70,
  stormShrinkPerSecond: 18,
  stormDamagePerTick: 1,
};

/** Cute player colors, assigned by join order. */
export const PLAYER_COLORS = ["#a3e635", "#38bdf8", "#f472b6", "#fbbf24"] as const;
