/**
 * A single live Arena Royale match — the authoritative game host for one room.
 *
 * Transport-agnostic by design: it talks to players through a minimal `Peer`
 * interface (`send(msg)`), so it can be driven by real WebSocket connections
 * in production and by fake peers in unit tests. It owns the lobby roster, the
 * countdown, and the deterministic `WorldState`, and it pushes lobby updates,
 * snapshots, eliminations, and the final results to peers.
 *
 * It contains NO timers: `tick()` is called by an external driver
 * (server/game/matchRegistry.ts in production; a loop in tests). One tick
 * advances exactly one simulation step.
 */

import {
  COUNTDOWN_SECONDS,
  DEFAULT_WORLD_CONFIG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  SNAPSHOT_RATE,
  TICK_RATE,
} from "../../shared/game/sim/constants.js";
import { createWorld, stepWorld } from "../../shared/game/sim/world.js";
import { worldToResults, worldToSnapshot } from "../../shared/game/sim/snapshot.js";
import type {
  InputCommand,
  PlayerSeed,
  WorldState,
} from "../../shared/game/sim/types.js";
import type {
  LobbyPlayer,
  ResultEntry,
  ServerMessage,
} from "../../shared/game/protocol/types.js";

export interface Peer {
  id: string;
  send(msg: ServerMessage): void;
}

interface Member {
  id: string;
  name: string;
  colorIndex: number;
  connected: boolean;
  peer: Peer;
  input: InputCommand;
}

const SNAPSHOT_EVERY = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

function idleInput(): InputCommand {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false };
}

export type MatchPhase = "lobby" | "countdown" | "playing" | "over";

export class LiveMatch {
  readonly code: string;
  private members = new Map<string, Member>();
  private order: string[] = [];
  private hostId: string | null = null;
  private nextPlayerSeq = 1;

  phase: MatchPhase = "lobby";
  private countdownTicksLeft = 0;
  private lastBroadcastSecond = -1;
  private world: WorldState | null = null;
  private startedAtMs = 0;

  /** Set by the registry; invoked once when the match finishes. */
  onComplete: ((results: ResultEntry[], durationMs: number) => void) | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ── Roster ─────────────────────────────────────────────────────────────────

  get playerCount(): number {
    return this.members.size;
  }

  isEmpty(): boolean {
    return [...this.members.values()].every((m) => !m.connected);
  }

  isFinished(): boolean {
    return this.phase === "over";
  }

  /**
   * Add a player to the lobby. Returns the assigned playerId, or an error code
   * if the room is full or already in progress.
   */
  addPlayer(
    name: string,
    peer: Omit<Peer, "id">,
  ): { ok: true; playerId: string } | { ok: false; code: "room_full" | "already_started" } {
    if (this.phase !== "lobby") return { ok: false, code: "already_started" };
    if (this.members.size >= MAX_PLAYERS) return { ok: false, code: "room_full" };

    const playerId = `p${this.nextPlayerSeq++}`;
    const colorIndex = this.members.size % PLAYER_COLORS.length;
    const member: Member = {
      id: playerId,
      name,
      colorIndex,
      connected: true,
      peer: { id: playerId, send: peer.send },
      input: idleInput(),
    };
    this.members.set(playerId, member);
    this.order.push(playerId);
    if (!this.hostId) this.hostId = playerId;

    member.peer.send({
      t: "joined",
      playerId,
      roomCode: this.code,
      hostId: this.hostId,
      players: this.lobbyPlayers(),
    });
    this.broadcastLobby();
    return { ok: true, playerId };
  }

  removePlayer(playerId: string): void {
    const member = this.members.get(playerId);
    if (!member) return;
    if (this.phase === "lobby") {
      // Fully drop pre-game so colors/host reassign cleanly.
      this.members.delete(playerId);
      this.order = this.order.filter((id) => id !== playerId);
      if (this.hostId === playerId) this.hostId = this.order[0] ?? null;
      this.broadcastLobby();
    } else {
      // Mid-match: keep the slot (their fighter goes idle) but mark disconnected.
      member.connected = false;
      member.input = idleInput();
    }
  }

  setInput(playerId: string, input: InputCommand): void {
    const member = this.members.get(playerId);
    if (member && member.connected) member.input = input;
  }

  isHost(playerId: string): boolean {
    return this.hostId === playerId;
  }

  // ── Match lifecycle ──────────────────────────────────────────────────────

  /** Host-initiated start. Returns an error code if it can't begin. */
  requestStart(
    playerId: string,
  ): { ok: true } | { ok: false; code: "not_host" | "already_started" } {
    if (!this.isHost(playerId)) return { ok: false, code: "not_host" };
    if (this.phase !== "lobby") return { ok: false, code: "already_started" };
    if (this.members.size < MIN_PLAYERS) {
      // Not enough players yet — silently ignore at the protocol level.
      return { ok: false, code: "already_started" };
    }
    this.phase = "countdown";
    this.countdownTicksLeft = COUNTDOWN_SECONDS * TICK_RATE;
    this.lastBroadcastSecond = -1;
    return { ok: true };
  }

  /** Advance the match by one tick. No-op while in the lobby. */
  tick(): void {
    if (this.phase === "countdown") {
      this.tickCountdown();
      return;
    }
    if (this.phase === "playing") {
      this.tickPlaying();
    }
  }

  private tickCountdown(): void {
    const secondsLeft = Math.ceil(this.countdownTicksLeft / TICK_RATE);
    if (secondsLeft !== this.lastBroadcastSecond) {
      this.lastBroadcastSecond = secondsLeft;
      this.broadcast({ t: "countdown", secondsLeft });
    }
    this.countdownTicksLeft -= 1;
    if (this.countdownTicksLeft <= 0) {
      this.beginPlaying();
    }
  }

  private beginPlaying(): void {
    const seeds: PlayerSeed[] = this.order
      .map((id) => this.members.get(id))
      .filter((m): m is Member => Boolean(m))
      .map((m) => ({ id: m.id, name: m.name }));
    this.world = createWorld(seeds, DEFAULT_WORLD_CONFIG);
    this.phase = "playing";
    this.startedAtMs = Date.now();
    this.broadcast(worldToSnapshot(this.world));
  }

  private tickPlaying(): void {
    if (!this.world) return;
    const prevAlive = new Set(
      this.world.players.filter((p) => p.alive).map((p) => p.id),
    );

    const inputs: Record<string, InputCommand> = {};
    for (const member of this.members.values()) {
      inputs[member.id] = member.connected ? member.input : idleInput();
    }

    this.world = stepWorld(this.world, inputs, DEFAULT_WORLD_CONFIG);

    for (const p of this.world.players) {
      if (!p.alive && prevAlive.has(p.id)) {
        this.broadcast({ t: "eliminated", playerId: p.id });
      }
    }

    if (this.world.tick % SNAPSHOT_EVERY === 0 || this.world.phase === "over") {
      this.broadcast(worldToSnapshot(this.world));
    }

    if (this.world.phase === "over") {
      this.finish();
    }
  }

  private finish(): void {
    if (this.phase === "over" || !this.world) return;
    this.phase = "over";
    const results = worldToResults(this.world);
    const durationMs = Date.now() - this.startedAtMs;
    this.broadcast({ t: "gameover", winnerId: this.world.winnerId, results });
    this.onComplete?.(results, durationMs);
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  hostName(): string | null {
    if (!this.hostId) return null;
    return this.members.get(this.hostId)?.name ?? null;
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.order
      .map((id) => this.members.get(id))
      .filter((m): m is Member => Boolean(m))
      .map((m) => ({
        id: m.id,
        name: m.name,
        colorIndex: m.colorIndex,
        connected: m.connected,
      }));
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: "lobby",
      hostId: this.hostId ?? "",
      players: this.lobbyPlayers(),
    });
  }

  private broadcast(msg: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.connected) member.peer.send(msg);
    }
  }
}
