/**
 * Authoritative, deterministic Arena Royale simulation.
 *
 * `stepWorld(state, inputs, config)` is a pure reducer: given identical inputs
 * it always produces identical output. It performs no I/O, reads no
 * wall-clock time, and never calls `Math.random`. Players are iterated in a
 * stable id-sorted order so behavior is reproducible across runtimes (Node
 * server today; other hosts later).
 */

import type {
  GamePhase,
  InputCommand,
  PlayerSeed,
  PlayerState,
  Projectile,
  WorldConfig,
  WorldState,
} from "./types";

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalize a vector; returns {0,0} for a zero-length input. */
function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/** Even, deterministic spawn positions arranged around the arena center. */
function spawnPosition(
  index: number,
  total: number,
  config: WorldConfig,
): { x: number; y: number } {
  const cx = config.arenaWidth / 2;
  const cy = config.arenaHeight / 2;
  const ring = Math.min(config.arenaWidth, config.arenaHeight) * 0.32;
  const angle = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring };
}

export function createWorld(
  seeds: PlayerSeed[],
  config: WorldConfig,
): WorldState {
  const ordered = [...seeds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const players: PlayerState[] = ordered.map((seed, index) => {
    const pos = spawnPosition(index, ordered.length, config);
    return {
      id: seed.id,
      name: seed.name,
      x: pos.x,
      y: pos.y,
      facingX: 0,
      facingY: 1,
      hp: config.playerMaxHp,
      alive: true,
      fireCooldown: 0,
      kills: 0,
      diedAtTick: -1,
    };
  });

  return {
    tick: 0,
    phase: "playing",
    players,
    projectiles: [],
    storm: {
      cx: config.arenaWidth / 2,
      cy: config.arenaHeight / 2,
      radius: config.stormStartRadius,
    },
    winnerId: null,
    nextProjectileId: 1,
  };
}

/**
 * Advance the world by exactly one tick.
 *
 * `inputs` maps playerId -> intent for this tick. Missing players are treated
 * as idle (no movement, no fire).
 */
export function stepWorld(
  state: WorldState,
  inputs: Record<string, InputCommand>,
  config: WorldConfig,
): WorldState {
  if (state.phase === "over") {
    return { ...state, tick: state.tick + 1 };
  }

  const dt = 1 / config.tickRate;
  let nextProjectileId = state.nextProjectileId;
  const projectiles: Projectile[] = [];

  // ── Players: movement, facing, firing ────────────────────────────────────
  const players: PlayerState[] = state.players.map((p) => {
    if (!p.alive) return { ...p };
    const input = inputs[p.id];
    let { x, y, facingX, facingY, fireCooldown } = p;

    if (input) {
      const move = normalize(input.moveX, input.moveY);
      x = clamp(
        x + move.x * config.moveSpeed * dt,
        config.playerRadius,
        config.arenaWidth - config.playerRadius,
      );
      y = clamp(
        y + move.y * config.moveSpeed * dt,
        config.playerRadius,
        config.arenaHeight - config.playerRadius,
      );

      const aim = normalize(input.aimX, input.aimY);
      if (aim.x !== 0 || aim.y !== 0) {
        facingX = aim.x;
        facingY = aim.y;
      } else if (move.x !== 0 || move.y !== 0) {
        facingX = move.x;
        facingY = move.y;
      }
    }

    fireCooldown = Math.max(0, fireCooldown - 1);

    if (input?.fire && fireCooldown === 0) {
      const dir = normalize(facingX, facingY);
      const muzzle = config.playerRadius + config.projectileRadius + 1;
      projectiles.push({
        id: nextProjectileId++,
        ownerId: p.id,
        x: x + dir.x * muzzle,
        y: y + dir.y * muzzle,
        vx: dir.x * config.projectileSpeed,
        vy: dir.y * config.projectileSpeed,
        ttl: config.projectileTtlTicks,
      });
      fireCooldown = config.fireCooldownTicks;
    }

    return { ...p, x, y, facingX, facingY, fireCooldown };
  });

  // ── Carry forward existing projectiles, advancing position ────────────────
  for (const proj of state.projectiles) {
    const ttl = proj.ttl - 1;
    if (ttl <= 0) continue;
    const x = proj.x + proj.vx * dt;
    const y = proj.y + proj.vy * dt;
    if (
      x < 0 ||
      x > config.arenaWidth ||
      y < 0 ||
      y > config.arenaHeight
    ) {
      continue;
    }
    projectiles.push({ ...proj, x, y, ttl });
  }

  // ── Projectile ↔ player collisions ────────────────────────────────────────
  const hitRadius = config.playerRadius + config.projectileRadius;
  const surviving: Projectile[] = [];
  const byId = new Map(players.map((p) => [p.id, p]));
  for (const proj of projectiles) {
    let consumed = false;
    for (const target of players) {
      if (!target.alive || target.id === proj.ownerId) continue;
      const dx = target.x - proj.x;
      const dy = target.y - proj.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        target.hp -= config.projectileDamage;
        const owner = byId.get(proj.ownerId);
        if (owner && target.hp <= 0 && target.alive) owner.kills += 1;
        consumed = true;
        break;
      }
    }
    if (!consumed) surviving.push(proj);
  }

  // ── Storm shrink + out-of-zone damage ─────────────────────────────────────
  const nextTick = state.tick + 1;
  let radius = state.storm.radius;
  if (state.tick >= config.stormShrinkStartTick) {
    radius = Math.max(
      config.stormMinRadius,
      radius - config.stormShrinkPerSecond * dt,
    );
  }
  for (const p of players) {
    if (!p.alive) continue;
    const dx = p.x - state.storm.cx;
    const dy = p.y - state.storm.cy;
    if (Math.hypot(dx, dy) > radius) {
      p.hp -= config.stormDamagePerTick;
    }
  }

  // ── Resolve deaths ────────────────────────────────────────────────────────
  for (const p of players) {
    if (p.alive && p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      p.diedAtTick = nextTick;
    }
  }

  // ── Win condition ─────────────────────────────────────────────────────────
  let phase: GamePhase = state.phase;
  let winnerId = state.winnerId;
  const alive = players.filter((p) => p.alive);
  if (phase === "playing" && players.length > 1 && alive.length <= 1) {
    phase = "over";
    winnerId = alive.length === 1 ? alive[0].id : null;
  }

  return {
    tick: nextTick,
    phase,
    players,
    projectiles: surviving,
    storm: { cx: state.storm.cx, cy: state.storm.cy, radius },
    winnerId,
    nextProjectileId,
  };
}
