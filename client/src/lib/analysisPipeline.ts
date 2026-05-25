import { processVideoStream } from "./mediapipe";
import { analyzeSwing } from "./swingAnalyzer";
import type { AnalysisResult, FrameLandmarks } from "@shared/types";
import type { CreateAnalysisInput } from "@shared/schema";
import {
  enqueueTrackingTuples,
  flushTrackingQueue,
  frameToTrackingTuple,
} from "./trackingSyncQueue";
import { uploadVideoForAnalysis } from "./mobileUpload";

export type PipelineInput = {
  videoBlob: Blob;
  fileName: string;
};

/** Co-operative cancellation — checked between major steps and pose frames. */
export type PipelineRunOptions = {
  signal?: AbortSignal;
  trackingSessionId?: string;
};

export type PipelineEvent =
  | { type: "status"; message: string }
  | { type: "pose_progress"; percent: number; frame?: FrameLandmarks }
  | { type: "sync_status"; message: string; pendingTuples: number };

export type PipelineOutput = {
  fileName: string;
  videoStorageKey: string | undefined;
  analysisResult: AnalysisResult;
  qualityWarning?: "low_detection";
};

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function toVideoFile(blob: Blob, fileName: string): File {
  return blob instanceof File
    ? blob
    : new File([blob], fileName, { type: "video/mp4" });
}

function poseCenter(frame: FrameLandmarks): { x: number; y: number } | null {
  const visible = frame.landmarks.filter((lm) => lm.visibility >= 0.4);
  if (!visible.length) return null;
  const sum = visible.reduce(
    (acc, lm) => ({ x: acc.x + lm.x, y: acc.y + lm.y }),
    { x: 0, y: 0 }
  );
  return {
    x: Number((sum.x / visible.length).toFixed(4)),
    y: Number((sum.y / visible.length).toFixed(4)),
  };
}

/**
 * End-to-end ML orchestration: optional server upload, MediaPipe pose extraction, swing analysis.
 * Yields status and per-frame pose progress; return value is {@link PipelineOutput}.
 */
export async function* runAnalysisPipeline(
  input: PipelineInput,
  options?: PipelineRunOptions
): AsyncGenerator<PipelineEvent, PipelineOutput> {
  const { videoBlob, fileName } = input;
  const signal = options?.signal;
  const trackingSessionId =
    options?.trackingSessionId ?? `client-${Date.now().toString(36)}`;
  const videoFile = toVideoFile(videoBlob, fileName);

  let videoStorageKey: string | undefined;

  if (fileName.startsWith("yt_")) {
    videoStorageKey = fileName;
  } else {
    yield { type: "status", message: "Saving video on server..." };
    throwIfAborted(signal);
    videoStorageKey = await uploadVideoForAnalysis(videoFile, { signal });
  }

  yield { type: "status", message: "Processing frames with AI pose detection..." };
  throwIfAborted(signal);

  const poseGen = processVideoStream(videoFile, { signal });
  let trackingSequence = 0;
  let trackingBatch: ReturnType<typeof frameToTrackingTuple>[] = [];
  let poseStep = await poseGen.next();
  while (!poseStep.done) {
    const chunk = poseStep.value;
    if (chunk.frame) {
      const center = poseCenter(chunk.frame);
      if (center) {
        trackingBatch.push(
          frameToTrackingTuple(
            chunk.frame.frameIndex,
            center.x,
            center.y,
            "detected"
          )
        );
      }
    }
    if (trackingBatch.length >= 60) {
      const syncStatus = await enqueueTrackingTuples({
        sessionId: trackingSessionId,
        source: "client-pose",
        sequence: trackingSequence,
        tuples: trackingBatch,
      });
      trackingSequence += 1;
      trackingBatch = [];
      yield {
        type: "sync_status",
        message: navigator.onLine
          ? "Tracking data queued for sync."
          : "Offline: tracking data cached on this device.",
        pendingTuples: syncStatus.pendingTuples,
      };
    }
    yield {
      type: "pose_progress",
      percent: chunk.percent,
      frame: chunk.frame,
    };
    poseStep = await poseGen.next();
  }
  const { frames, qualityWarning } = poseStep.value;

  if (trackingBatch.length > 0) {
    const syncStatus = await enqueueTrackingTuples({
      sessionId: trackingSessionId,
      source: "client-pose",
      sequence: trackingSequence,
      tuples: trackingBatch,
    });
    yield {
      type: "sync_status",
      message: navigator.onLine
        ? "Tracking data queued for sync."
        : "Offline: tracking data cached on this device.",
      pendingTuples: syncStatus.pendingTuples,
    };
  }

  const flushed = await flushTrackingQueue();
  yield {
    type: "sync_status",
    message:
      flushed.pendingTuples > 0
        ? "Tracking sync will retry when the connection recovers."
        : "Tracking data synced.",
    pendingTuples: flushed.pendingTuples,
  };

  yield {
    type: "status",
    message:
      qualityWarning === "low_detection"
        ? "Low pose detection quality detected. Finishing analysis with reduced confidence..."
        : "Analyzing swing & classifying shot...",
  };
  throwIfAborted(signal);

  const analysisResult = await analyzeSwing(frames);

  return {
    fileName,
    videoStorageKey,
    analysisResult,
    qualityWarning,
  };
}

export function pipelineOutputToCreateAnalysisInput(
  output: PipelineOutput
): CreateAnalysisInput {
  const r = output.analysisResult;
  return {
    videoFileName: output.fileName,
    videoStorageKey: output.videoStorageKey,
    overallScore: r.overallScore,
    dominantSide: r.dominantSide,
    durationMs: r.durationMs,
    frameCount: r.frameCount,
    sampleFps: r.sampleFps,
    phasesJson: JSON.stringify(r.phases),
    landmarksJson: JSON.stringify(r.frameLandmarks),
    shotType: r.shotType,
    shotConfidence: r.shotConfidence,
    skillLabel: r.skillLabel,
    skillConfidence: r.skillConfidence,
    qualityScore: r.qualityScore,
  };
}

/**
 * Convenience wrapper when you prefer a callback over manual generator iteration.
 */
export async function runAnalysisPipelineWithHandlers(
  input: PipelineInput,
  handlers: {
    onEvent?: (event: PipelineEvent) => void;
    signal?: AbortSignal;
  }
): Promise<PipelineOutput> {
  const gen = runAnalysisPipeline(input, { signal: handlers.signal });
  let step = await gen.next();
  while (!step.done) {
    handlers.onEvent?.(step.value);
    step = await gen.next();
  }
  return step.value;
}

// ── Worker / environment (main thread) ─────────────────────────────────────

const PIPELINE_WORKER_LIMITATION =
  "MediaPipe pose extraction and HTMLVideoElement require a DOM; ONNX sessions in this app are initialized on the main thread. " +
  "The bundled `pipeline.worker.ts` is for capability probes and future CPU-only stages, not full offload.";

/**
 * Static facts for UI or diagnostics. Does not instantiate a Worker (no bundle load).
 */
export function getPipelineWorkerEnvironment(): {
  hasWorkerConstructor: boolean;
  limitation: string;
} {
  return {
    hasWorkerConstructor: typeof Worker !== "undefined",
    limitation: PIPELINE_WORKER_LIMITATION,
  };
}

/**
 * Attempt to load the module worker and complete a ping/pong round-trip.
 * Fails gracefully (returns false) if `Worker` throws, `onerror` fires, or the probe times out.
 * Safari and other browsers may differ in module worker support; this repo does not run automated Safari tests.
 */
export function probePipelineWorker(): Promise<boolean> {
  if (typeof Worker === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    let w: Worker | null = null;
    try {
      w = new Worker(new URL("./pipeline.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, 2500);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      w?.terminate();
      w = null;
    };

    w.onmessage = (ev: MessageEvent<{ type?: string }>) => {
      if (ev.data?.type === "pong") {
        cleanup();
        resolve(true);
      }
    };
    w.onerror = () => {
      cleanup();
      resolve(false);
    };

    w.postMessage({ type: "ping" });
  });
}
