/**
 * Tests for the authoritative LiveMatch host (server/game/liveMatch.ts).
 * Run: npx tsx scripts/qa/game-live-match.test.ts   (or: npm run test:game)
 *
 * Uses fake in-memory peers and drives ticks by hand (no WebSocket, no timers,
 * no DB) so the full lobby → countdown → play → gameover lifecycle is exercised
 * deterministically.
 */

import { LiveMatch, type Peer } from "../../server/game/liveMatch.js";
import type { ServerMessage } from "../../shared/game/protocol/types.js";
import type { InputCommand } from "../../shared/game/sim/types.js";

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

/** A fake peer that records everything the host sends it. */
function fakePeer(): { send: Peer["send"]; inbox: ServerMessage[] } {
  const inbox: ServerMessage[] = [];
  return { send: (msg) => inbox.push(msg), inbox };
}

function idle(): InputCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };
}

/** Steer a player toward the arena center using the latest snapshot it saw. */
function moveTowardCenter(inbox: ServerMessage[], playerId: string): InputCommand {
  for (let i = inbox.length - 1; i >= 0; i--) {
    const m = inbox[i];
    if (m.t !== "snapshot") continue;
    const me = m.players.find((p) => p.id === playerId);
    if (!me) break;
    const dx = m.storm.cx - me.x;
    const dy = m.storm.cy - me.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 30) return idle(); // close enough — hold the center
    return { moveX: dx / dist, moveY: dy / dist, aimX: 0, aimY: 0, fire: false };
  }
  return idle();
}

assert("first joiner becomes host and everyone sees the lobby", () => {
  const match = new LiveMatch("AAAA");
  const a = fakePeer();
  const b = fakePeer();
  const r1 = match.addPlayer("Ada", { send: a.send });
  const r2 = match.addPlayer("Bo", { send: b.send });
  if (!r1.ok || !r2.ok) throw new Error("joins should succeed");

  const joined = a.inbox.find((m) => m.t === "joined");
  if (!joined || joined.t !== "joined") throw new Error("no joined message");
  if (joined.hostId !== r1.playerId) throw new Error("first joiner should be host");
  if (!match.isHost(r1.playerId)) throw new Error("isHost mismatch");
  if (match.isHost(r2.playerId)) throw new Error("second player is not host");
});

assert("room rejects a 5th player and ignores duplicate-room starts", () => {
  const match = new LiveMatch("BBBB");
  const ids = ["w", "x", "y", "z"].map(
    (n) => match.addPlayer(n, { send: fakePeer().send }),
  );
  if (!ids.every((r) => r.ok)) throw new Error("first four should join");
  const fifth = match.addPlayer("overflow", { send: fakePeer().send });
  if (fifth.ok) throw new Error("fifth player should be rejected");
  if (fifth.ok === false && fifth.code !== "room_full") {
    throw new Error(`expected room_full, got ${fifth.code}`);
  }
});

assert("only the host can start, and only with enough players", () => {
  const match = new LiveMatch("CCCC");
  const host = match.addPlayer("Host", { send: fakePeer().send });
  if (!host.ok) throw new Error("host join failed");

  // Solo: host can't start yet.
  if (match.requestStart(host.playerId).ok) throw new Error("started while solo");

  const guest = match.addPlayer("Guest", { send: fakePeer().send });
  if (!guest.ok) throw new Error("guest join failed");

  if (match.requestStart(guest.playerId).ok) throw new Error("non-host started");
  if (!match.requestStart(host.playerId).ok) throw new Error("host start failed");
  if (match.phase !== "countdown") throw new Error("should be counting down");
});

assert("full lifecycle: countdown → snapshots → elimination → winner", () => {
  const match = new LiveMatch("DDDD");
  const a = fakePeer();
  const b = fakePeer();
  const host = match.addPlayer("Center", { send: a.send });
  const guest = match.addPlayer("Edge", { send: b.send });
  if (!host.ok || !guest.ok) throw new Error("joins failed");

  match.requestStart(host.playerId);

  // Drive to completion. The host hugs the center (survives the storm); the
  // guest sits idle out near the spawn ring and gets caught by the storm.
  for (let i = 0; i < 4000 && match.phase !== "over"; i++) {
    if (match.phase === "playing") {
      match.setInput(host.playerId, moveTowardCenter(a.inbox, host.playerId));
      match.setInput(guest.playerId, idle());
    }
    match.tick();
  }

  if (match.phase !== "over") throw new Error("match never finished");

  const sawCountdown = a.inbox.some((m) => m.t === "countdown");
  const sawSnapshot = a.inbox.some((m) => m.t === "snapshot");
  const sawElimGuest = a.inbox.some(
    (m) => m.t === "eliminated" && m.playerId === guest.playerId,
  );
  const over = a.inbox.find((m) => m.t === "gameover");
  if (!sawCountdown) throw new Error("no countdown broadcast");
  if (!sawSnapshot) throw new Error("no snapshot broadcast");
  if (!sawElimGuest) throw new Error("guest elimination not broadcast");
  if (!over || over.t !== "gameover") throw new Error("no gameover");
  if (over.winnerId !== host.playerId) {
    throw new Error(`expected host to win, got ${over.winnerId}`);
  }
  if (over.results[0].placement !== 1 || over.results[0].id !== host.playerId) {
    throw new Error("winner should place first in results");
  }
});

assert("onComplete fires once with results and a duration", () => {
  const match = new LiveMatch("EEEE");
  let calls = 0;
  let lastDuration = -1;
  match.onComplete = (_results, durationMs) => {
    calls += 1;
    lastDuration = durationMs;
  };
  const a = fakePeer();
  const host = match.addPlayer("Center", { send: a.send });
  const guest = match.addPlayer("Edge", { send: fakePeer().send });
  if (!host.ok || !guest.ok) throw new Error("joins failed");
  match.requestStart(host.playerId);
  for (let i = 0; i < 4000 && match.phase !== "over"; i++) {
    if (match.phase === "playing") {
      match.setInput(host.playerId, moveTowardCenter(a.inbox, host.playerId));
    }
    match.tick();
  }
  // Extra ticks must not re-fire completion.
  match.tick();
  match.tick();
  if (calls !== 1) throw new Error(`onComplete should fire once, fired ${calls}`);
  if (lastDuration < 0) throw new Error("duration not reported");
});

if (process.exitCode) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(process.exitCode);
}
console.log(`\nAll Arena Royale live-match checks passed (${passed} tests).`);
