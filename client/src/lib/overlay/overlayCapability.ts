/**
 * One-time overlay render capability detection for Safari / iOS WebViews.
 * Module workers and `transferControlToOffscreen` are probed before binding the display canvas.
 */

export type OverlayRenderMode = "worker" | "main";

let cachedMode: Promise<OverlayRenderMode> | null = null;

/** Synchronous check for OffscreenCanvas transfer on HTMLCanvasElement. */
export function hasOffscreenCanvasTransfer(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function"
  );
}

const PROBE_TIMEOUT_MS = 2500;

/**
 * Load the overlay module worker and complete a ping/pong round-trip.
 * Returns false if construction throws, `onerror` fires, or the probe times out.
 */
export function probeOverlayModuleWorker(): Promise<boolean> {
  if (typeof Worker === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./overlay.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, PROBE_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker?.terminate();
      worker = null;
    };

    worker.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === "pong") {
        cleanup();
        resolve(true);
      }
    };
    worker.onerror = () => {
      cleanup();
      resolve(false);
    };

    worker.postMessage({ type: "ping" });
  });
}

/** Cached worker vs main-thread overlay render mode. */
export function resolveOverlayRenderMode(): Promise<OverlayRenderMode> {
  if (!cachedMode) {
    cachedMode = (async () => {
      if (!hasOffscreenCanvasTransfer()) return "main";
      const workerOk = await probeOverlayModuleWorker();
      return workerOk ? "worker" : "main";
    })();
  }
  return cachedMode;
}
