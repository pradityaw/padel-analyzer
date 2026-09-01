# Worker Offload Decision — Analysis Pipeline (PRODUCT_BACKLOG.md Milestone 1, item 9)

> Investigated June 2026. Resolves the open question: "Decide whether full worker offload
> is actually feasible with the current MediaPipe + DOM setup, or whether the extracted
> pipeline should remain main-thread with better UX and cancellation."

## 0. Headline finding (changes the framing of the decision)

**The in-browser pipeline this decision is about is now dead code on the web client.** At commit `c59322b` ("feat: TrackNet CV pipeline…"), `Upload.tsx` was switched from the client-side ML path to **server-side analysis jobs**:

- `client/src/pages/Upload.tsx:460-463` — uses `trpc.mobileAnalysis.create` / `retry` / `getProgress` (job creation + polling), and the page copy explicitly says *"Pose extraction and phase scoring run on the server with MediaPipe — the same pipeline as the mobile app"* (`Upload.tsx:789-791`).
- Server side: `server/routers/mobileAnalysis.ts`, `server/lib/analysisJobProcessor.ts`, `server/lib/parallelAnalysisOrchestrator.ts` (Python MediaPipe via `mobileAnalysisRunner`).
- A repo-wide grep for `runAnalysisPipeline` / `processVideoStream` / `analysisPipeline` finds **zero consumers** outside `client/src/lib/{analysisPipeline,mediapipe,pipeline.worker}.ts` themselves. `probePipelineWorker` is never called. The historical Upload.tsx (`92d6d4f`) imported `processVideo`/`analyzeSwing` directly; the extracted `runAnalysisPipeline` was never wired into Upload.tsx at any commit (`git log -S runAnalysisPipeline -- client/src/pages/Upload.tsx` is empty).

So "should we offload the client pipeline to a worker?" is preceded by "does the client pipeline still need to exist?"

## 1. Current state of the client pipeline (file:line evidence)

| Concern | Location | Detail |
|---|---|---|
| DOM dependency #1 | `client/src/lib/mediapipe.ts:116-124, 140-148` | `document.createElement("video")` + `URL.createObjectURL` + `video.currentTime` seek loop (`onseeked` promise per frame, 15 fps sampling); `pose.detectForVideo(video, timestampMs)` is fed the `HTMLVideoElement` directly |
| DOM dependency #2 | `mediapipe.ts:13-15` | `FilesetResolver.forVisionTasks` loads WASM from jsDelivr CDN; `delegate: "GPU"` (`mediapipe.ts:22`) — in a worker this requires OffscreenCanvas-backed WebGL |
| ONNX | `client/src/lib/shotClassifier.ts:26-32` | `onnxruntime-web` lazily imported on main thread, wasm backend, CDN `wasmPaths`; pure TypedArray pre/post-processing (no DOM) — already worker-portable as-is |
| Worker stub | `client/src/lib/pipeline.worker.ts:25-42` | Only handles `ping`→`pong`; any `run` returns `PIPELINE_DOM_REQUIRED` error |
| Probe | `analysisPipeline.ts:242-280` | `probePipelineWorker()` — module-worker load + ping/pong with 2.5s timeout; never invoked anywhere |
| Cancellation/UX already present | `analysisPipeline.ts:17-39, 91-129` and `mediapipe.ts:135-138` | `AbortSignal` checked per pose frame and between stages; AsyncGenerator yields `status` / `pose_progress` (per-frame percent) / `sync_status` events. The per-frame `await onseeked` also naturally yields to the event loop, so the main thread is blocked only per-`detectForVideo` call, not for the whole video |

Versions (`package.json:80,102`, installed): **@mediapipe/tasks-vision `0.10.34`** (spec `^0.10.18`), **onnxruntime-web `1.24.3`**.

## 2. Verified facts (2025–2026)

1. **MediaPipe PoseLandmarker works in a Web Worker.** Google's official Pose Landmarker web guide recommends workers precisely because `detect()`/`detectForVideo()` block the main thread, and notes you cannot post an `HTMLVideoElement` to a worker — you send an `ImageBitmap` instead. `detectForVideo(videoFrame: ImageSource, timestamp, …)` accepts `ImageBitmap` and `VideoFrame`. Sources: [Pose landmark detection guide for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js), [PoseLandmarker API](https://developers.google.com/mediapipe/api/solutions/js/tasks-vision.poselandmarker), [worker how-to](https://ankdev.me/blog/how-to-run-mediapipe-task-vision-in-a-web-worker). Gotchas: bundler/`importScripts` friction with module workers (community-reported), and `delegate: "GPU"` inside a worker depends on OffscreenCanvas WebGL (fine in Chromium; Safari ≥16.4/17 territory — fall back to CPU delegate).
2. **WebCodecs `VideoDecoder` is worker-capable and now cross-browser, but Safari was the laggard.** Safari 16.4–18.7 had only a *partial* implementation (video interfaces only); full WebCodecs ships with **Safari 26**. WebCodecs has no demuxer — you need [Mediabunny](https://webcodecsfundamentals.org/basics/muxing/)/[web-demuxer](https://github.com/ForeverSc/web-demuxer)/mp4box.js to extract `EncodedVideoChunk`s. Sources: [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [caniuse](https://caniuse.com/webcodecs), [Remotion WebCodecs notes](https://www.remotion.dev/docs/media-parser/webcodecs). For phone-shot videos this also means handling H.264/HEVC codec-support variance per browser.
3. **onnxruntime-web runs in workers** — officially supported, and it even has a built-in `env.wasm.proxy = true` flag that moves inference off-main-thread without you writing a worker (caveats: incompatible with WebGPU EP and strict CSP). **Multithreaded WASM (`numThreads > 1`) requires `crossOriginIsolated`** — i.e., COOP `same-origin` + COEP `require-corp`/`credentialless` headers — because of SharedArrayBuffer. Single-threaded WASM in a worker needs **no** special headers. Sources: [ORT Web env flags](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html), [web.dev COOP/COEP](https://web.dev/articles/coop-coep). Note: enabling cross-origin isolation would interact badly with the app's current CDN loading of MediaPipe/ORT wasm (cross-origin subresources must satisfy CORP/CORS).
4. **Net:** full worker offload is *technically feasible* in 2026 — but it was never the cheapest path, and the seek-loop is replaceable without WebCodecs anyway (main-thread `createImageBitmap(video)` per seek, transfer to worker).

## 3. Options

| Option | Feasibility | Effort | Risk | Notes |
|---|---|---|---|---|
| (a) Full worker offload: demux (mp4box/web-demuxer) + WebCodecs decode + MediaPipe + ONNX all in worker | Feasible on Chromium/Firefox; Safari < 26 needs fallback path anyway | **High** (1–2+ wks): new demuxer dep, codec matrix, timestamp mapping, GPU-delegate-in-worker, dual code path for Safari fallback | High — most moving parts, hardest to test (repo has no Safari CI, per `pipeline.worker.ts:10-12`) | Best raw throughput (decode faster than realtime, no seek latency) — but throughput isn't the bottleneck users complain about |
| (b) Hybrid: keep main-thread `HTMLVideoElement` seek loop, `createImageBitmap(video)` per frame, transfer bitmap to worker running MediaPipe+ONNX | Fully supported by MediaPipe API today | **Medium** (3–5 days): worker protocol for frames/results/abort, FilesetResolver+ORT init in worker, GPU→CPU delegate fallback | Medium-low — no new deps, no headers needed (keep ORT single-thread) | Removes the per-frame `detectForVideo` main-thread stalls; seek loop itself is cheap/async |
| (c) Stay main-thread with existing AbortSignal + per-frame progress UX | Already done | **~0** | None | Acceptable because the seek-loop awaits between frames; only `detectForVideo` (~30-80 ms/frame) janks the UI |
| **(d) Decommission/park the client pipeline; server jobs are the product path** | Already shipped in `Upload.tsx` | **Low** (≤1 day: delete or quarantine dead code, update backlog) | Lowest — removes a second, divergent ML implementation that silently drifts from the server one | The backlog itself listed "Server-side ML processing" as the follow-on; it landed first |

## 4. Recommendation

**Close Milestone 1 item 9 as "overtaken by events": choose (d), with (b) as the documented future path if an offline/client-side mode is ever productized.**

Justification:
- The product already moved analysis to the server (`Upload.tsx:460`, `server/lib/analysisJobProcessor.ts`). The client pipeline has **zero call sites**; investing 1–2 weeks making dead code run in a worker is pure waste, and keeping two ML implementations (TS + Python) guarantees scoring drift.
- If client-side analysis returns (offline mode, privacy mode, mobile web without backend), the verified-feasible design is the **hybrid (b)**, not WebCodecs (a): MediaPipe officially supports `ImageBitmap`/`VideoFrame` inputs in workers, ONNX runs in workers with no headers needed at `numThreads = 1`, and the existing seek loop already yields per frame so it composes cleanly with `postMessage` + transferables. WebCodecs adds a demuxer dependency and a Safari-26 cliff for no user-visible benefit at 15 fps sampling.

**First implementation step:** delete (or move to an `archive/`-style quarantine with a README pointer) `client/src/lib/analysisPipeline.ts` and `client/src/lib/pipeline.worker.ts`, keep `mediapipe.ts`/`shotClassifier.ts` only if anything else still needs them (currently only `swingAnalyzer.ts:356` → `shotClassifier`, itself only reachable via the dead pipeline; `SwingCoachingPanel.tsx`/`MetricsPanel.tsx` import only the pure `getMetricFeedback` from `swingAnalyzer`), then update `PRODUCT_BACKLOG.md` Milestone 1 / item 9 to record this decision and the hybrid-worker design as the contingency. Run `npm run typecheck` + `qa:mvp` to confirm nothing else referenced the removed modules.
