import { useCallback, useEffect, useRef, useState } from "react";
import type { FrameLandmarks } from "@shared/types";
import type { OverlayLayerFlags } from "@shared/overlayTypes";
import { drawOverlayFrame } from "@/lib/overlay/drawOverlay";
import { OverlayFrameBudget } from "@/lib/overlay/overlayFrameBudget";
import { isOverlayStressMode } from "@/lib/overlay/stressTest";
import { resolveOverlayRenderMode } from "@/lib/overlay/overlayCapability";
import {
  getOverlayPayloadTransferables,
  packOverlayPayload,
} from "@/lib/overlay/packOverlayPayload";
import type { PackedOverlayPayload } from "@shared/overlayTypes";

export type OverlayPaintOptions = {
  visible: boolean;
  highlightContact?: boolean;
};

type UseVideoOverlayWorkerOptions = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  frames: FrameLandmarks[];
  dimensions: { w: number; h: number };
  showSkeleton: boolean;
  /** Optional normalized ball positions per frame (x,y pairs). */
  ballPositions?: Float32Array;
  layers?: Partial<OverlayLayerFlags>;
};

function cloneCanvasElement(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const next = document.createElement("canvas");
  next.className = canvas.className;
  next.style.cssText = canvas.style.cssText;
  next.width = width;
  next.height = height;
  canvas.parentElement?.replaceChild(next, canvas);
  return next;
}

export function useVideoOverlayWorker({
  canvasRef,
  frames,
  dimensions,
  showSkeleton,
  ballPositions,
  layers: layerOverrides,
}: UseVideoOverlayWorkerOptions) {
  const [usingWorker, setUsingWorker] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const workerReadyRef = useRef(false);
  const transferredRef = useRef(false);
  const payloadRef = useRef<PackedOverlayPayload | null>(null);
  const fallbackCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fallbackRafRef = useRef(0);
  const forceMainThreadRef = useRef(false);
  const frameBudgetRef = useRef(new OverlayFrameBudget());

  const layersRef = useRef<OverlayLayerFlags>({
    skeleton: true,
    ball: false,
  });
  layersRef.current = {
    skeleton: layerOverrides?.skeleton ?? true,
    ball: layerOverrides?.ball ?? Boolean(ballPositions),
  };

  const showSkeletonRef = useRef(showSkeleton);
  showSkeletonRef.current = showSkeleton;

  const dimensionsRef = useRef(dimensions);
  dimensionsRef.current = dimensions;

  const lastPaintKeyRef = useRef("");
  const pendingPaintRef = useRef<{
    arrayIdx: number;
    options: OverlayPaintOptions;
  } | null>(null);

  const cancelFallbackRaf = useCallback(() => {
    if (fallbackRafRef.current) {
      cancelAnimationFrame(fallbackRafRef.current);
      fallbackRafRef.current = 0;
    }
  }, []);

  const sendPayloadToWorker = useCallback((worker: Worker) => {
    const payload = payloadRef.current;
    if (!payload) return;
    worker.postMessage(
      {
        type: "setPayload",
        payload,
        layers: layersRef.current,
      },
      getOverlayPayloadTransferables(payload)
    );
  }, []);

  const flushPendingPaint = useCallback((worker: Worker) => {
    const pending = pendingPaintRef.current;
    if (!pending) return;
    pendingPaintRef.current = null;
    lastPaintKeyRef.current = `${pending.arrayIdx}:${pending.options.visible}:${pending.options.highlightContact ?? false}`;
    worker.postMessage({
      type: "paint",
      arrayIdx: pending.arrayIdx,
      visible: pending.options.visible,
      highlightContact: pending.options.highlightContact ?? false,
    });
  }, []);

  const disposeWorker = useCallback(() => {
    cancelFallbackRaf();
    const worker = workerRef.current;
    if (worker) {
      if (workerReadyRef.current) {
        try {
          worker.postMessage({ type: "dispose" });
        } catch {
          /* worker may already be torn down */
        }
      }
      worker.terminate();
      workerRef.current = null;
    }
    workerReadyRef.current = false;
    transferredRef.current = false;
    frameBudgetRef.current.reset();
    setUsingWorker(false);
  }, [cancelFallbackRaf]);

  const recoverCanvasAfterTransfer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !transferredRef.current) return;
    const { w, h } = dimensionsRef.current;
    const replacement = cloneCanvasElement(canvas, w, h);
    (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current =
      replacement;
    transferredRef.current = false;
    fallbackCtxRef.current = null;
  }, [canvasRef]);

  const getFallbackContext = useCallback(() => {
    if (transferredRef.current) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (!fallbackCtxRef.current) {
      fallbackCtxRef.current = canvas.getContext("2d");
    }
    return fallbackCtxRef.current;
  }, [canvasRef]);

  const paintFallback = useCallback(
    (arrayIdx: number, options: OverlayPaintOptions) => {
      const ctx = getFallbackContext();
      const payload = payloadRef.current;
      const { w, h } = dimensionsRef.current;
      if (!ctx || !payload) return;

      if (!options.visible) {
        ctx.clearRect(0, 0, w, h);
        return;
      }

      const degrade = frameBudgetRef.current.degradeForFrame();
      const t0 = performance.now();

      drawOverlayFrame(ctx, payload, arrayIdx, w, h, {
        layers: layersRef.current,
        highlightContact: options.highlightContact,
        degrade,
      });

      frameBudgetRef.current.record(performance.now() - t0);
    },
    [getFallbackContext]
  );

  const scheduleFallbackPaint = useCallback(
    (arrayIdx: number, options: OverlayPaintOptions) => {
      pendingPaintRef.current = { arrayIdx, options };
      if (fallbackRafRef.current) return;

      fallbackRafRef.current = requestAnimationFrame(() => {
        fallbackRafRef.current = 0;
        const pending = pendingPaintRef.current;
        if (!pending) return;

        const paintKey = `${pending.arrayIdx}:${pending.options.visible}:${pending.options.highlightContact ?? false}`;
        lastPaintKeyRef.current = paintKey;
        paintFallback(pending.arrayIdx, pending.options);
      });
    },
    [paintFallback]
  );

  const postPaint = useCallback(
    (arrayIdx: number, options: OverlayPaintOptions) => {
      const paintKey = `${arrayIdx}:${options.visible}:${options.highlightContact ?? false}`;
      if (paintKey === lastPaintKeyRef.current) return;

      const worker = workerRef.current;
      if (transferredRef.current && worker && !workerReadyRef.current) {
        pendingPaintRef.current = { arrayIdx, options };
        return;
      }

      if (usingWorker && worker && workerReadyRef.current) {
        lastPaintKeyRef.current = paintKey;
        worker.postMessage({
          type: "paint",
          arrayIdx,
          visible: options.visible,
          highlightContact: options.highlightContact ?? false,
        });
        return;
      }

      scheduleFallbackPaint(arrayIdx, options);
    },
    [scheduleFallbackPaint, usingWorker]
  );

  const resetRenderCache = useCallback(() => {
    lastPaintKeyRef.current = "";
  }, []);

  const clearOverlay = useCallback(() => {
    resetRenderCache();
    postPaint(0, { visible: false, highlightContact: false });
  }, [postPaint, resetRenderCache]);

  const paintOverlay = useCallback(
    (arrayIdx: number, options?: Partial<OverlayPaintOptions>) => {
      postPaint(arrayIdx, {
        visible: options?.visible ?? showSkeletonRef.current,
        highlightContact: options?.highlightContact ?? false,
      });
    },
    [postPaint]
  );

  const handleWorkerFailure = useCallback(
    (reason: string, err?: unknown) => {
      console.warn("[overlay-worker]", reason, err);
      forceMainThreadRef.current = true;
      const pending = pendingPaintRef.current;
      recoverCanvasAfterTransfer();
      disposeWorker();
      lastPaintKeyRef.current = "";
      if (pending) {
        scheduleFallbackPaint(pending.arrayIdx, pending.options);
      }
    },
    [disposeWorker, recoverCanvasAfterTransfer, scheduleFallbackPaint]
  );

  // Bootstrap worker + transfer canvas once capability probe succeeds.
  useEffect(() => {
    let cancelled = false;

    if (isOverlayStressMode()) return;

    void resolveOverlayRenderMode().then((mode) => {
      if (cancelled || forceMainThreadRef.current || mode !== "worker") return;

      const canvas = canvasRef.current;
      if (!canvas || transferredRef.current) return;

      let worker: Worker | null = null;
      try {
        worker = new Worker(
          new URL("../lib/overlay/overlay.worker.ts", import.meta.url),
          { type: "module" }
        );
      } catch (err) {
        handleWorkerFailure("module worker construction failed", err);
        return;
      }

      workerRef.current = worker;

      worker.onmessage = (ev: MessageEvent) => {
        const data = ev.data;
        if (!data || typeof data !== "object") return;

        if (data.type === "ready") {
          if (cancelled) return;
          workerReadyRef.current = true;
          setUsingWorker(true);
          sendPayloadToWorker(worker!);
          flushPendingPaint(worker!);
          return;
        }

        if (data.type === "error") {
          handleWorkerFailure(data.code, data.message);
        }
      };

      worker.onerror = (err) => {
        handleWorkerFailure("runtime error", err.message);
      };

      try {
        if (typeof canvas.transferControlToOffscreen !== "function") {
          throw new Error("transferControlToOffscreen is not available");
        }

        const offscreen = canvas.transferControlToOffscreen();
        if (!(offscreen instanceof OffscreenCanvas)) {
          throw new Error("transferControlToOffscreen did not return OffscreenCanvas");
        }

        transferredRef.current = true;
        fallbackCtxRef.current = null;

        try {
          worker.postMessage(
            {
              type: "init",
              width: dimensionsRef.current.w,
              height: dimensionsRef.current.h,
              canvas: offscreen,
            },
            [offscreen]
          );
        } catch (err) {
          transferredRef.current = false;
          throw err;
        }
      } catch (err) {
        handleWorkerFailure("OffscreenCanvas transfer failed", err);
      }
    });

    return () => {
      cancelled = true;
      disposeWorker();
    };
  }, [
    canvasRef,
    disposeWorker,
    flushPendingPaint,
    handleWorkerFailure,
    sendPayloadToWorker,
  ]);

  // Push packed payload when frames or ball data change.
  useEffect(() => {
    payloadRef.current = packOverlayPayload(frames, ballPositions);
    frameBudgetRef.current.reset();
    resetRenderCache();

    const worker = workerRef.current;
    if (usingWorker && worker && workerReadyRef.current) {
      sendPayloadToWorker(worker);
    }
  }, [frames, ballPositions, usingWorker, resetRenderCache, sendPayloadToWorker]);

  // Resize worker canvas when video dimensions change.
  useEffect(() => {
    resetRenderCache();
    const worker = workerRef.current;
    if (usingWorker && worker && workerReadyRef.current) {
      worker.postMessage({
        type: "resize",
        width: dimensions.w,
        height: dimensions.h,
      });
      return;
    }

    const ctx = getFallbackContext();
    const canvas = canvasRef.current;
    if (ctx && canvas && !transferredRef.current) {
      canvas.width = dimensions.w;
      canvas.height = dimensions.h;
    }
  }, [
    canvasRef,
    dimensions.h,
    dimensions.w,
    getFallbackContext,
    resetRenderCache,
    usingWorker,
  ]);

  // Visibility toggle forces a repaint even at the same frame index.
  useEffect(() => {
    resetRenderCache();
  }, [showSkeleton, resetRenderCache]);

  return {
    paintOverlay,
    clearOverlay,
    resetRenderCache,
    usingWorker,
  };
}
