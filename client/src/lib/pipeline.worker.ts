/// <reference lib="webworker" />

/**
 * Dedicated worker entry for capability checks and future CPU-only pipeline stages.
 *
 * The current pose pipeline (`processVideoStream` / MediaPipe) depends on HTMLVideoElement
 * and loads WASM from the window context; it cannot run inside this worker without a larger
 * architectural change. ONNX in this project is also wired for the main thread.
 *
 * Safari note: module workers (`{ type: "module" }`) and WASM threading have historically
 * had more constraints than Chromium; use {@link probePipelineWorker} from the main thread
 * before assuming workers are usable — behavior is not verified in CI for Safari.
 */

export type PipelineWorkerInbound =
  | { type: "ping" }
  | { type: "run"; id: number };

export type PipelineWorkerOutbound =
  | { type: "pong" }
  | { type: "error"; code: string; message: string };

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (ev: MessageEvent<PipelineWorkerInbound>) => {
  const data = ev.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "ping") {
    const msg: PipelineWorkerOutbound = { type: "pong" };
    scope.postMessage(msg);
    return;
  }

  const err: PipelineWorkerOutbound = {
    type: "error",
    code: "PIPELINE_DOM_REQUIRED",
    message:
      "Full analysis is implemented on the main thread in this build (video + MediaPipe + ONNX).",
  };
  scope.postMessage(err);
};
