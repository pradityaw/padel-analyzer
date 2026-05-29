/**
 * Determinism + behavior tests for the Arena Royale simulation core.
 * Run: npx tsx shared/game/sim/world.test.ts   (or: npm run test:game)
 *
 * The headline guarantee is determinism: identical seeds + identical inputs
 * must produce byte-identical world state, so any host (server today) behaves
 * the same and snapshots stay consistent.
 */

import { createWorld, stepWorld } from "./world";
import { worldToResults } from "./snapshot";
import { DEFAULT_WORLD_CONFIG } from "./constants";
import type { InputCommand, PlayerSeed, WorldState } from "./types";

let passed = 0;
let failed = 0;

function assert(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

function idle(): InputCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };
}

const SEEDS: PlayerSeed[] = [
  { id: "p1", name: "Ada" },
  { id: "p2", name: "Bo" },
];

/** Run a scripted match producing inputs per tick from a deterministic fn. */
function run(
  ticks: number,
  inputsFor: (tick: number, state: WorldState) => Record<string, InputCommand>,
): WorldState {
  let world = createWorld(SEEDS, DEFAULT_WORLD_CONFIG);
  for (let i = 0; i < ticks; i++) {
    world = stepWorld(world, inputsFor(i, world), DEFAULT_WORLD_CONFIG);
  }
  return world;
}

assert("createWorld spawns all players alive at full hp", () => {
  const world = createWorld(SEEDS, DEFAULT_WORLD_CONFIG);
  if (world.players.length !== 2) throw new Error("expected 2 players");
  for (const p of world.players) {
    if (!p.alive) throw new Error(`${p.id} should be alive`);
    if (p.hp !== DEFAULT_WORLD_CONFIG.playerMaxHp) throw new Error("full hp");
  }
  if (world.phase !== "playing") throw new Error("expected playing phase");
});

assert("players are stored in stable id-sorted order", () => {
  const world = createWorld(
    [
      { id: "zeta", name: "Z" },
      { id: "alpha", name: "A" },
    ],
    DEFAULT_WORLD_CONFIG,
  );
  if (world.players[0].id !== "alpha") throw new Error("not id-sorted");
});

assert("identical seeds + inputs produce identical state (determinism)", () => {
  const script = (tick: number): Record<string, InputCommand> => ({
    p1: { moveX: 1, moveY: 0, aimX: 1, aimY: 0, fire: tick % 12 === 0 },
    p2: { moveX: -1, moveY: 0.5, aimX: -1, aimY: 0, fire: tick % 9 === 0 },
  });
  const a = run(200, script);
  const b = run(200, script);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("non-deterministic: two identical runs diverged");
  }
});

assert("a player firing into a stationary target lands damage", () => {
  // Place both world states; aim p1 straight at p2 by overriding facing via aim.
  let world = createWorld(SEEDS, DEFAULT_WORLD_CONFIG);
  const [p1, p2] = world.players;
  // Manually line them up horizontally for a deterministic hit.
  world = {
    ...world,
    players: [
      { ...p1, x: 200, y: 300, facingX: 1, facingY: 0 },
      { ...p2, x: 260, y: 300 },
    ],
    storm: { ...world.storm, radius: 5000 }, // disable storm damage
  };
  const before = world.players[1].hp;
  for (let i = 0; i < 6; i++) {
    world = stepWorld(
      world,
      {
        p1: { moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: i === 0 },
        p2: idle(),
      },
      { ...DEFAULT_WORLD_CONFIG, stormShrinkStartTick: 100000 },
    );
  }
  if (world.players[1].hp >= before) {
    throw new Error(`expected damage; hp ${before} -> ${world.players[1].hp}`);
  }
});

assert("storm shrinks after its start tick", () => {
  const cfg = { ...DEFAULT_WORLD_CONFIG, stormShrinkStartTick: 0 };
  let world = createWorld(SEEDS, cfg);
  const start = world.storm.radius;
  for (let i = 0; i < 30; i++) world = stepWorld(world, {}, cfg);
  if (world.storm.radius >= start) throw new Error("storm did not shrink");
  if (world.storm.radius < cfg.stormMinRadius) throw new Error("shrank past min");
});

assert("last player standing ends the match with a winner", () => {
  // Tiny storm + no inputs: both sit outside the zone, but p2 starts closer to
  // death by lowering its hp. Drive until one remains.
  const cfg = {
    ...DEFAULT_WORLD_CONFIG,
    stormShrinkStartTick: 0,
    stormStartRadius: 1, // everyone is immediately outside
    stormMinRadius: 1,
  };
  let world = createWorld(SEEDS, cfg);
  world = {
    ...world,
    players: [
      { ...world.players[0], hp: 100 },
      { ...world.players[1], hp: 5 },
    ],
  };
  for (let i = 0; i < 600 && world.phase !== "over"; i++) {
    world = stepWorld(world, {}, cfg);
  }
  if (world.phase !== "over") throw new Error("match never ended");
  if (world.winnerId !== "p1") throw new Error(`unexpected winner ${world.winnerId}`);

  const results = worldToResults(world);
  if (results[0].id !== "p1" || results[0].placement !== 1) {
    throw new Error("winner should place first in results");
  }
});

assert("over phase is terminal (further steps only advance tick)", () => {
  const cfg = { ...DEFAULT_WORLD_CONFIG, stormStartRadius: 1, stormShrinkStartTick: 0 };
  let world = createWorld(SEEDS, cfg);
  world = { ...world, players: [{ ...world.players[0] }, { ...world.players[1], hp: 1 }] };
  for (let i = 0; i < 600 && world.phase !== "over"; i++) world = stepWorld(world, {}, cfg);
  const winnerAtEnd = world.winnerId;
  const tickAtEnd = world.tick;
  world = stepWorld(world, {}, cfg);
  if (world.phase !== "over" || world.winnerId !== winnerAtEnd) {
    throw new Error("over phase should be stable");
  }
  if (world.tick !== tickAtEnd + 1) throw new Error("tick should still advance");
});

if (process.exitCode) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(process.exitCode);
}
console.log(`\nAll Arena Royale sim checks passed (${passed} tests).`);
