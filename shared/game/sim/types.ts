/**
 * Core simulation types for "Arena Royale" — a top-down last-one-standing
 * battle. These are PURE TypeScript types with zero runtime dependencies so
 * they can be imported by the Node server, the test runner, AND the React
 * Native app (which intentionally avoids the zod-bearing protocol module).
 *
 * The simulation is authoritative and deterministic: `stepWorld` is a pure
 * reducer `(state, inputs, config) -> nextState`. It never reads wall-clock
 * time or `Math.random` — randomness, if any, flows through the seeded RNG in
 * `./rng` at world creation only.
 */

export type GamePhase = "lobby" | "countdown" | "playing" | "over";

export interface Vec2 {
  x: number;
  y: number;
}

/** A player's per-tick intent. Clients send these; the host applies them. */
export interface InputCommand {
  /** Movement direction, each component in [-1, 1] (host re-clamps/normalizes). */
  moveX: number;
  moveY: number;
  /** Aim/facing direction (need not be normalized). */
  aimX: number;
  aimY: number;
  /** Whether the attack button is held this tick. */
  fire: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Last facing direction (unit vector), used for rendering + default aim. */
  facingX: number;
  facingY: number;
  hp: number;
  alive: boolean;
  /** Ticks remaining before this player can fire again. */
  fireCooldown: number;
  kills: number;
  /** Tick at which the player died (for results ordering). -1 while alive. */
  diedAtTick: number;
}

export interface Projectile {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks remaining before the projectile despawns. */
  ttl: number;
}

export interface Storm {
  cx: number;
  cy: number;
  radius: number;
}

export interface WorldState {
  tick: number;
  phase: GamePhase;
  players: PlayerState[];
  projectiles: Projectile[];
  storm: Storm;
  winnerId: string | null;
  /** Monotonic id source for projectiles (keeps spawns deterministic). */
  nextProjectileId: number;
}

export interface WorldConfig {
  arenaWidth: number;
  arenaHeight: number;
  tickRate: number;
  playerRadius: number;
  moveSpeed: number;
  playerMaxHp: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileDamage: number;
  projectileTtlTicks: number;
  fireCooldownTicks: number;
  /** Storm starts shrinking once `tick >= stormShrinkStartTick`. */
  stormShrinkStartTick: number;
  stormStartRadius: number;
  stormMinRadius: number;
  /** Units per second the storm radius shrinks. */
  stormShrinkPerSecond: number;
  /** HP lost per tick while outside the safe zone. */
  stormDamagePerTick: number;
}

/** A single player entry at world creation. */
export interface PlayerSeed {
  id: string;
  name: string;
}
