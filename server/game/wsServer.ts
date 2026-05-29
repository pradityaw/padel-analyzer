/**
 * WebSocket server for Arena Royale, attached to the existing HTTP server so
 * it shares port 3001 and Fly routing. Every frame is JSON validated against
 * the protocol schemas; a connection becomes a player after a valid `join`.
 *
 * The authoritative simulation lives in the in-memory match registry; this
 * module is a thin adapter that turns a socket into a `Peer` and routes
 * inbound frames to the right match.
 */

import type { Server } from "http";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { decodeClientMessage } from "../../shared/game/protocol/messages.js";
import type { ServerMessage } from "../../shared/game/protocol/types.js";
import { matchRegistry } from "./matchRegistry.js";

const ERROR_MESSAGES: Record<string, string> = {
  room_not_found: "That room code doesn't exist.",
  room_full: "This battle is already full (max 4).",
  already_started: "This battle has already started.",
  not_host: "Only the host can start the battle.",
  bad_message: "Could not understand that message.",
};

export function attachGameWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/game" });

  wss.on("connection", (ws: WebSocket) => {
    let code: string | null = null;
    let playerId: string | null = null;

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const fail = (codeName: keyof typeof ERROR_MESSAGES) =>
      send({ t: "error", code: codeName as never, message: ERROR_MESSAGES[codeName] });

    ws.on("message", (data: RawData) => {
      const msg = decodeClientMessage(data.toString());
      if (!msg) return fail("bad_message");

      if (msg.t === "join") {
        if (playerId) return; // ignore duplicate joins on one socket
        const match = matchRegistry.get(msg.roomCode);
        if (!match) return fail("room_not_found");
        const result = match.addPlayer(msg.name, { send });
        if (!result.ok) return fail(result.code);
        code = msg.roomCode;
        playerId = result.playerId;
        return;
      }

      if (!code || !playerId) return fail("bad_message");
      const match = matchRegistry.get(code);
      if (!match) return fail("room_not_found");

      switch (msg.t) {
        case "input":
          match.setInput(playerId, {
            moveX: msg.moveX,
            moveY: msg.moveY,
            aimX: msg.aimX,
            aimY: msg.aimY,
            fire: msg.fire,
          });
          break;
        case "start": {
          const r = match.requestStart(playerId);
          if (r.ok) matchRegistry.ensureDriver(code);
          else if (r.code === "not_host") fail("not_host");
          break;
        }
        case "leave":
          match.removePlayer(playerId);
          ws.close();
          break;
        case "ping":
          send({ t: "pong", ts: msg.ts });
          break;
      }
    });

    ws.on("close", () => {
      if (code && playerId) matchRegistry.get(code)?.removePlayer(playerId);
    });
    ws.on("error", () => {
      /* swallow socket errors; close handler does the cleanup */
    });
  });
}
