/**
 * Thin WebSocket wrapper for the Arena Royale realtime channel. Sends typed
 * ClientMessages and decodes inbound ServerMessages, using the built-in React
 * Native `WebSocket` (no native dependency).
 */

import type {
  ClientMessage,
  ServerMessage,
} from "../../../../shared/game/protocol/types";

export interface TransportHandlers {
  onOpen?: () => void;
  onMessage: (msg: ServerMessage) => void;
  onClose?: () => void;
  onError?: () => void;
}

export class OnlineTransport {
  private ws: WebSocket | null = null;

  constructor(private readonly url: string) {}

  connect(handlers: TransportHandlers): void {
    const ws = new WebSocket(this.url);
    ws.onopen = () => handlers.onOpen?.();
    ws.onmessage = (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;
      try {
        handlers.onMessage(JSON.parse(data) as ServerMessage);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => handlers.onClose?.();
    ws.onerror = () => handlers.onError?.();
    this.ws = ws;
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
