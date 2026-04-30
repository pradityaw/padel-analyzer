import { processVideoStream } from "./mediapipe";
import { analyzeSwing } from "./swingAnalyzer";
import type { AnalysisResult, FrameLandmarks } from "@shared/types";
import type { CreateAnalysisInput } from "@shared/schema";

export type PipelineInput = {
  videoBlob: Blob;
  fileName: string;
};

/** Co-operative cancellation — checked between major steps and pose frames. */
export type PipelineRunOptions = {
  signal?: AbortSignal;
};

export type PipelineEvent =
  | { type: "status"; message: string }
  | { type: "pose_progress"; percent: number; frame?: FrameLandmarks };

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
  const videoFile = toVideoFile(videoBlob, fileName);

  let videoStorageKey: string | undefined;

  if (fileName.startsWith("yt_")) {
    videoStorageKey = fileName;
  } else {
    yield { type: "status", message: "Saving video on server..." };
    throwIfAborted(signal);
    const fd = new FormData();
    fd.append("file", videoFile, fileName);
    const up = await fetch("/api/upload", { method: "POST", body: fd });
    if (!up.ok) {
      const err = await up.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? "Failed to save video on server"
      );
    }
    const { storageKey } = (await up.json()) as { storageKey: string };
    videoStorageKey = storageKey;
  }

  yield { type: "status", message: "Processing frames with AI pose detection..." };
  throwIfAborted(signal);

  const poseGen = processVideoStream(videoFile, { signal });
  let poseStep = await poseGen.next();
  while (!poseStep.done) {
    const chunk = poseStep.value;
    yield {
      type: "pose_progress",
      percent: chunk.percent,
      frame: chunk.frame,
    };
    poseStep = await poseGen.next();
  }
  const { frames, qualityWarning } = poseStep.value;

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
