/// <reference lib="webworker" />

import { drawOverlayFrame } from "./drawOverlay";
import type {
  OverlayLayerFlags,
  OverlayWorkerInboundMessage,
  OverlayWorkerOutboundMessage,
  PackedOverlayPayload,
} from "@shared/overlayTypes";

type WorkerState = {
  ctx: OffscreenCanvasRenderingContext2D | null;
  width: number;
  height: number;
  payload: PackedOverlayPayload | null;
  layers: OverlayLayerFlags;
};

const state: WorkerState = {
  ctx: null,
  width: 0,
  height: 0,
  payload: null,
  layers: { skeleton: true, ball: false },
};

const scope = self as DedicatedWorkerGlobalScope;

function post(msg: OverlayWorkerOutboundMessage): void {
  scope.postMessage(msg);
}

function postError(code: string, message: string): void {
  post({ type: "error", code, message });
}

function paintFrame(
  arrayIdx: number,
  visible: boolean,
  highlightContact: boolean
): void {
  const { ctx, width, height, payload, layers } = state;
  if (!ctx) {
    postError("NO_CONTEXT", "Overlay worker has no canvas context");
    return;
  }

  if (!visible || !payload || payload.frameCount === 0) {
    ctx.clearRect(0, 0, width, height);
    post({ type: "painted", arrayIdx });
    return;
  }

  drawOverlayFrame(ctx, payload, arrayIdx, width, height, {
    layers,
    highlightContact,
  });

  post({ type: "painted", arrayIdx });
}

scope.onmessage = (ev: MessageEvent<OverlayWorkerInboundMessage | { type: "ping" }>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "ping") {
    scope.postMessage({ type: "pong" });
    return;
  }

  switch (msg.type) {
    case "init": {
      try {
        const canvas = msg.canvas;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          postError("NO_CONTEXT", "Failed to acquire 2d context on OffscreenCanvas");
          return;
        }
        canvas.width = msg.width;
        canvas.height = msg.height;
        state.ctx = ctx;
        state.width = msg.width;
        state.height = msg.height;
        post({ type: "ready" });
      } catch (err) {
        postError(
          "INIT_FAILED",
          err instanceof Error ? err.message : "Overlay worker init failed"
        );
      }
      break;
    }

    case "setPayload": {
      state.payload = msg.payload;
      state.layers = msg.layers;
      break;
    }

    case "paint": {
      paintFrame(msg.arrayIdx, msg.visible, msg.highlightContact);
      break;
    }

    case "resize": {
      state.width = msg.width;
      state.height = msg.height;
      if (state.ctx) {
        state.ctx.canvas.width = msg.width;
        state.ctx.canvas.height = msg.height;
      }
      break;
    }

    case "dispose": {
      state.ctx = null;
      state.payload = null;
      scope.close();
      break;
    }

    default:
      postError("UNKNOWN_MESSAGE", "Unrecognized overlay worker message");
  }
};
