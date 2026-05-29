/**
 * Drives an online Arena Royale session over a single WebSocket: joins the
 * room, tracks the lobby, sends the local player's input at a fixed rate, and
 * renders authoritative snapshots with ~100ms interpolation for smooth motion
 * from a ~20Hz snapshot stream.
 *
 * Client-side prediction is intentionally omitted for v1 (interpolation alone
 * is smooth enough for 2-4 nearby players).
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { DEFAULT_WORLD_CONFIG, SNAPSHOT_RATE } from "../../../../shared/game/sim/constants";
import type {
  LobbyPlayer,
  ResultEntry,
  ServerMessage,
  SnapshotMessage,
} from "../../../../shared/game/protocol/types";
import { getGameWebSocketUrl } from "../../lib/config";
import type { RenderState } from "../types";
import { OnlineTransport } from "./onlineTransport";

const INTERP_DELAY_MS = 100;
const MAX_HP = DEFAULT_WORLD_CONFIG.playerMaxHp;

export type OnlineStatus =
  | "connecting"
  | "lobby"
  | "countdown"
  | "playing"
  | "over"
  | "error";

export interface UseOnlineMatch {
  status: OnlineStatus;
  lobby: LobbyPlayer[];
  hostId: string;
  selfId: string;
  isHost: boolean;
  countdownSeconds: number;
  render: RenderState | null;
  results: ResultEntry[] | null;
  winnerId: string | null;
  error: string | null;
  moveX: SharedValue<number>;
  moveY: SharedValue<number>;
  fireRef: MutableRefObject<boolean>;
  start: () => void;
}

interface Buffered {
  receivedAt: number;
  snap: SnapshotMessage;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function useOnlineMatch(code: string, name: string): UseOnlineMatch {
  const [status, setStatus] = useState<OnlineStatus>("connecting");
  const [lobby, setLobby] = useState<LobbyPlayer[]>([]);
  const [hostId, setHostId] = useState("");
  const [selfId, setSelfId] = useState("");
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [render, setRender] = useState<RenderState | null>(null);
  const [results, setResults] = useState<ResultEntry[] | null>(null);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moveX = useSharedValue(0);
  const moveY = useSharedValue(0);
  const fireRef = useRef(false);

  const transportRef = useRef<OnlineTransport | null>(null);
  const snapshotsRef = useRef<Buffered[]>([]);
  const rosterRef = useRef<Map<string, number>>(new Map());
  const selfIdRef = useRef("");
  const statusRef = useRef<OnlineStatus>("connecting");

  const setStatusBoth = (s: OnlineStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    const transport = new OnlineTransport(getGameWebSocketUrl());
    transportRef.current = transport;

    const handleMessage = (msg: ServerMessage) => {
      switch (msg.t) {
        case "joined":
          selfIdRef.current = msg.playerId;
          setSelfId(msg.playerId);
          setHostId(msg.hostId);
          rosterRef.current = new Map(msg.players.map((p) => [p.id, p.colorIndex]));
          setLobby(msg.players);
          setStatusBoth("lobby");
          break;
        case "lobby":
          setHostId(msg.hostId);
          rosterRef.current = new Map(msg.players.map((p) => [p.id, p.colorIndex]));
          setLobby(msg.players);
          if (statusRef.current === "connecting") setStatusBoth("lobby");
          break;
        case "countdown":
          setCountdownSeconds(msg.secondsLeft);
          setStatusBoth("countdown");
          break;
        case "snapshot":
          snapshotsRef.current.push({ receivedAt: Date.now(), snap: msg });
          if (snapshotsRef.current.length > 12) snapshotsRef.current.shift();
          if (statusRef.current !== "over") setStatusBoth("playing");
          break;
        case "eliminated":
          break; // visual flash could hook in here later
        case "gameover":
          setResults(msg.results);
          setWinnerId(msg.winnerId);
          setStatusBoth("over");
          break;
        case "error":
          setError(msg.message);
          setStatusBoth("error");
          break;
        case "pong":
          break;
      }
    };

    transport.connect({
      onOpen: () => transport.send({ t: "join", roomCode: code, name }),
      onMessage: handleMessage,
      onClose: () => {
        if (statusRef.current !== "over" && statusRef.current !== "error") {
          setError("Disconnected from the battle.");
          setStatusBoth("error");
        }
      },
      onError: () => {
        if (statusRef.current !== "over") {
          setError("Couldn't reach the battle server.");
          setStatusBoth("error");
        }
      },
    });

    // Send local input at the snapshot rate while playing.
    const inputTimer = setInterval(() => {
      if (statusRef.current !== "playing") return;
      transport.send({
        t: "input",
        tick: 0,
        moveX: moveX.value,
        moveY: moveY.value,
        aimX: 0,
        aimY: 0,
        fire: fireRef.current,
      });
    }, 1000 / SNAPSHOT_RATE);

    // Render loop: interpolate ~100ms behind the latest snapshot.
    let raf: number;
    const renderFrame = () => {
      const buf = snapshotsRef.current;
      if (buf.length > 0) {
        const target = Date.now() - INTERP_DELAY_MS;
        let a = buf[0];
        let b = buf[buf.length - 1];
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i].receivedAt <= target && target <= buf[i + 1].receivedAt) {
            a = buf[i];
            b = buf[i + 1];
            break;
          }
        }
        const span = b.receivedAt - a.receivedAt;
        const t = span > 0 ? Math.max(0, Math.min(1, (target - a.receivedAt) / span)) : 1;
        setRender(interpolate(a.snap, b.snap, t, rosterRef.current, selfIdRef.current));
      }
      raf = requestAnimationFrame(renderFrame);
    };
    raf = requestAnimationFrame(renderFrame);

    return () => {
      clearInterval(inputTimer);
      cancelAnimationFrame(raf);
      transport.close();
      transportRef.current = null;
    };
  }, [code, name, moveX, moveY]);

  return {
    status,
    lobby,
    hostId,
    selfId,
    isHost: selfId !== "" && selfId === hostId,
    countdownSeconds,
    render,
    results,
    winnerId,
    error,
    moveX,
    moveY,
    fireRef,
    start: () => transportRef.current?.send({ t: "start" }),
  };
}

function interpolate(
  a: SnapshotMessage,
  b: SnapshotMessage,
  t: number,
  roster: Map<string, number>,
  selfId: string,
): RenderState {
  const prev = new Map(a.players.map((p) => [p.id, p]));
  return {
    storm: { ...b.storm },
    projectiles: b.projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y })),
    players: b.players.map((p, index) => {
      const before = prev.get(p.id) ?? p;
      return {
        id: p.id,
        x: lerp(before.x, p.x, t),
        y: lerp(before.y, p.y, t),
        facingX: lerp(before.facingX, p.facingX, t),
        facingY: lerp(before.facingY, p.facingY, t),
        hp: p.hp,
        maxHp: MAX_HP,
        alive: p.alive,
        colorIndex: roster.get(p.id) ?? index,
        isSelf: p.id === selfId,
      };
    }),
  };
}
