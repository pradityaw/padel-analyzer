/**
 * Wire protocol for Arena Royale sessions — PURE TypeScript types (no zod, no
 * runtime deps) so the React Native client can import them freely. The server
 * additionally validates inbound frames with the zod schemas in `./messages`,
 * which are derived from these same shapes.
 *
 * Transport is a single WebSocket per client. Every frame is JSON with a
 * discriminant field `t`.
 */

export interface LobbyPlayer {
  id: string;
  name: string;
  /** Assigned color index (0..MAX_PLAYERS-1). */
  colorIndex: number;
  connected: boolean;
}

export interface SnapshotPlayer {
  id: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  hp: number;
  alive: boolean;
}

export interface SnapshotProjectile {
  id: number;
  x: number;
  y: number;
}

export interface ResultEntry {
  id: string;
  name: string;
  /** 1 = winner. */
  placement: number;
  kills: number;
}

// ── Client → Server ──────────────────────────────────────────────────────────

export interface JoinMessage {
  t: "join";
  roomCode: string;
  name: string;
}

export interface StartMessage {
  t: "start";
}

export interface InputMessage {
  t: "input";
  tick: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

export interface LeaveMessage {
  t: "leave";
}

export interface PingMessage {
  t: "ping";
  ts: number;
}

export type ClientMessage =
  | JoinMessage
  | StartMessage
  | InputMessage
  | LeaveMessage
  | PingMessage;

// ── Server → Client ──────────────────────────────────────────────────────────

export interface JoinedMessage {
  t: "joined";
  playerId: string;
  roomCode: string;
  hostId: string;
  players: LobbyPlayer[];
}

export interface LobbyMessage {
  t: "lobby";
  hostId: string;
  players: LobbyPlayer[];
}

export interface CountdownMessage {
  t: "countdown";
  secondsLeft: number;
}

export interface SnapshotMessage {
  t: "snapshot";
  tick: number;
  phase: "playing" | "over";
  storm: { cx: number; cy: number; radius: number };
  players: SnapshotPlayer[];
  projectiles: SnapshotProjectile[];
}

export interface EliminatedMessage {
  t: "eliminated";
  playerId: string;
}

export interface GameOverMessage {
  t: "gameover";
  winnerId: string | null;
  results: ResultEntry[];
}

export interface ErrorMessage {
  t: "error";
  code:
    | "room_not_found"
    | "room_full"
    | "already_started"
    | "not_host"
    | "bad_message"
    | "internal";
  message: string;
}

export interface PongMessage {
  t: "pong";
  ts: number;
}

export type ServerMessage =
  | JoinedMessage
  | LobbyMessage
  | CountdownMessage
  | SnapshotMessage
  | EliminatedMessage
  | GameOverMessage
  | ErrorMessage
  | PongMessage;
