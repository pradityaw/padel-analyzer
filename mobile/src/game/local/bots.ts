/**
 * Lightweight bot AI for the single-device "vs bots" mode. This runs purely on
 * the client and is NOT authoritative, so it may use Math.random freely.
 *
 * Each bot: retreats to the safe zone when the storm gets close, otherwise
 * hunts the nearest living opponent, aims at them, and fires when roughly lined
 * up and within projectile range.
 */

import { DEFAULT_WORLD_CONFIG } from "../../../../shared/game/sim/constants";
import type {
  InputCommand,
  WorldState,
} from "../../../../shared/game/sim/types";

const cfg = DEFAULT_WORLD_CONFIG;
const PROJECTILE_RANGE = cfg.projectileSpeed * (cfg.projectileTtlTicks / cfg.tickRate);

function unit(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: x / len, y: y / len };
}

export function botInput(world: WorldState, selfId: string): InputCommand {
  const self = world.players.find((p) => p.id === selfId);
  if (!self || !self.alive) {
    return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };
  }

  // Nearest living opponent.
  let target: typeof self | null = null;
  let bestDist = Infinity;
  for (const p of world.players) {
    if (p.id === selfId || !p.alive) continue;
    const d = Math.hypot(p.x - self.x, p.y - self.y);
    if (d < bestDist) {
      bestDist = d;
      target = p;
    }
  }

  const toCenter = unit(world.storm.cx - self.x, world.storm.cy - self.y);
  const distFromCenter = Math.hypot(self.x - world.storm.cx, self.y - world.storm.cy);
  const safeMargin = world.storm.radius - cfg.playerRadius * 2;

  // Retreat to safety takes priority when near/over the storm edge.
  if (distFromCenter > safeMargin) {
    const aim = target ? unit(target.x - self.x, target.y - self.y) : toCenter;
    return {
      moveX: toCenter.x,
      moveY: toCenter.y,
      aimX: aim.x,
      aimY: aim.y,
      fire: false,
    };
  }

  if (!target) {
    // No one to fight — drift gently toward center.
    return { moveX: toCenter.x * 0.4, moveY: toCenter.y * 0.4, aimX: 0, aimY: 0, fire: false };
  }

  const aim = unit(target.x - self.x, target.y - self.y);
  // Keep a fighting distance: close in when far, back off when too close.
  let move: { x: number; y: number };
  if (bestDist > 280) move = aim;
  else if (bestDist < 140) move = { x: -aim.x, y: -aim.y };
  else move = { x: -aim.y, y: aim.x }; // strafe

  const fire = bestDist < PROJECTILE_RANGE * 0.9 && Math.random() < 0.6;
  return { moveX: move.x, moveY: move.y, aimX: aim.x, aimY: aim.y, fire };
}
