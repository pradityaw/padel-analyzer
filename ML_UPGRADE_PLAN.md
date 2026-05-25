# ML Upgrade Plan — SwingVision-Quality Padel Analyzer

> Research compiled: May 2026  
> Goal: Elevate the ML pipeline to SwingVision quality — proper ball tracking, court calibration, and stroke classification.  
> **See also:** [`TECH_STRATEGY.md`](./TECH_STRATEGY.md) for architectural milestones · [`AGENTS.md`](./AGENTS.md) for workstream rules.

---

## Reality Check

This repo already has server-side analysis orchestration, OpenCV ball tracking, court homography, and padel-specific shot classification paths. The minimal-intervention TrackNet drop-in is therefore not a broad client rewrite: add TrackNet as a server-side ball tracker behind `PADEL_BALL_BACKEND=tracknet`, keep the existing OpenCV path as the fallback, and compare both on the same labeled eval fixture before changing downstream contracts.

---

## The Gap: Where We Are vs SwingVision

| Capability | Current App | SwingVision Quality |
|---|---|---|
| **Ball tracking** | None (YOLO bounding box or absent) | Heatmap regression (TrackNet) — handles 5–15px motion-blurred balls |
| **Player pose** | MediaPipe BlazePose | YOLO11-pose ONNX + WebGPU — better accuracy, same latency |
| **Court calibration** | None | ResNet50 keypoint detector → OpenCV homography → 2D bird's-eye view |
| **Stroke classification** | Basic ONNX classifier | Padel-specific: bandeja, vibora, smash, forehand/backhand volley |
| **Inference backend** | ONNX (WASM) | ONNX + WebGPU (80% of native GPU speed in Chrome 113+) |
| **Heavy processing** | All on main browser thread | Hybrid: browser real-time preview + server async post-processing |

**The single biggest quality jump**: replacing any YOLO-based ball detection with **TrackNet** (heatmap regression). Padel balls are too small and motion-blurred for bounding box detection.

---

## Key Reference Repositories

### Ball Tracking (highest priority)

| Repo | Stars | What to use |
|---|---|---|
| [TrackNetV4/TrackNetV4](https://github.com/TrackNetV4/TrackNetV4) | Research | SOTA architecture (ICASSP 2025) — study the architecture |
| [yastrebksv/TrackNet](https://github.com/yastrebksv/TrackNet) | ~300 | **PyTorch TrackNetV2 — directly ONNX-exportable. Use this.** |
| [ArtLabss/tennis-tracking](https://github.com/ArtLabss/tennis-tracking) | ~1.5k | Full pipeline using TrackNet — good reference for wiring it end-to-end |

**How TrackNet works:**
- Input: 3 consecutive frames stacked as a 9-channel tensor (RGB × 3 frames)
- Output: Heatmap per frame — Gaussian peak at ball position
- Model size: ~3M params (TrackNetV2) — feasible for ONNX + WebGPU in browser
- Export: `torch.onnx.export()` from the PyTorch V2 repo, then quantize to fp16

### Padel-Specific (directly reusable)

| Repo | Stars | What to use |
|---|---|---|
| [Joao-M-Silva/padel_analytics](https://github.com/Joao-M-Silva/padel_analytics) | 226 | **Stroke classification model** — bandeja, vibora, topspin smash, forehand/backhand volley. Copy the architecture. |
| [AlvaroNovillo/DS_Padel](https://github.com/AlvaroNovillo/DS_Padel) | ~50 | **Court homography pipeline** specifically for padel — copy the court detection + 2D projection approach |
| [Juild/padel-project-tfm](https://github.com/Juild/padel-project-tfm) | ~20 | Padel ball + player detection thesis — additional reference |

### Full Reference Pipeline

| Repo | Stars | What to use |
|---|---|---|
| [abdullahtarek/tennis_analysis](https://github.com/abdullahtarek/tennis_analysis) | ~3k | **Best end-to-end reference** — mini-court overlay, player/ball speed, shot count. Study the architecture. |
| [BimsaraS99/tennis-analyzer-YOLOv8](https://github.com/BimsaraS99/tennis-analyzer-YOLOv8) | ~200 | YOLOv8 + real-time 2D court view |
| [ameynarwadkar/Tennis-Analysis-System](https://github.com/ameynarwadkar/Tennis-Analysis-System) | ~100 | Player/ball speed calculation approach |

### Court Detection

| Repo | Stars | What to use |
|---|---|---|
| [yastrebksv/TennisCourtDetector](https://github.com/yastrebksv/TennisCourtDetector) | ~200 | **14 court keypoints with deep learning** — adapt for padel court |
| [abdullahtarek/tennis_analysis](https://github.com/abdullahtarek/tennis_analysis) | ~3k | ResNet50 fine-tuned for court keypoints → `cv2.findHomography()` |

### Browser-Side Inference Reference

| Repo | Stars | What to use |
|---|---|---|
| [nomi30701/yolo-object-detection-onnxruntime-web](https://github.com/nomi30701/yolo-object-detection-onnxruntime-web) | ~200 | **Complete ONNX + WebGPU browser demo** — use as the template for wiring YOLO11-pose and TrackNet in browser |

### Training Data

| Repo | What it is |
|---|---|
| [UPC-ViRVIG/PadelVic](https://github.com/UPC-ViRVIG/PadelVic) | Multicamera padel dataset + MoCap ground truth — use for fine-tuning models |
| [ChristianIngwersen/SportsPose](https://github.com/ChristianIngwersen/SportsPose) | 176k+ 3D sports poses across 5 sports — use for pose model fine-tuning |

---

## Upgrade Phases

### Phase 1 — WebGPU Backend + Better Pose (drop-in, browser-only)

**Goal:** Replace WASM ONNX backend with WebGPU for 5–10× speedup. Replace BlazePose with YOLO11-pose.

**Files to touch (Workstream A):**
- `client/src/lib/mediapipe.ts` — swap BlazePose for YOLO11-pose ONNX
- `client/src/lib/shotClassifier.ts` — enable WebGPU backend in `ort.env`
- `vite.config.ts` — add ONNX WASM/WebGPU asset headers (COOP/COEP)

**Steps:**
1. Install `onnxruntime-web@latest` (WebGPU support is in 1.18+)
2. Set `ort.env.wasm.wasmPaths` and `executionProviders: ['webgpu', 'wasm']` fallback
3. Download YOLO11n-pose ONNX from Ultralytics (17 COCO keypoints, 6MB)
4. Map COCO keypoints → existing `PoseLandmark` type in `shared/types.ts`
5. Add `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers in Express (required for SharedArrayBuffer/WebGPU)

**Reference:** Use `nomi30701/yolo-object-detection-onnxruntime-web` as the exact WebGPU wiring template.

**Acceptance criteria:** 1080p video frame processed in <50ms on Chrome with WebGPU; falls back to WASM on Safari/Firefox.

---

### Phase 2 — Ball Tracking via TrackNet

**Goal:** Add real ball tracking. This is the single biggest quality delta vs SwingVision.

**Files to touch (Workstream A):**
- `client/src/lib/analysisPipeline.ts` (new or existing) — add TrackNet inference step
- `shared/types.ts` — add `BallPosition { x: number; y: number; confidence: number; frame: number }[]` to `AnalysisResult`
- `server/routers/analysis.ts` — persist ball trajectory alongside landmarks

**Steps:**
1. Clone `yastrebksv/TrackNet` (PyTorch V2)
2. Export to ONNX: `torch.onnx.export(model, dummy_input_9ch, "tracknet.onnx", opset_version=11)`
3. Quantize to fp16 with `onnxruntime.quantization` (reduces model from ~12MB to ~6MB)
4. Place the browser preview model in `client/public/models/tracknet.onnx`; place the server-side analysis model at `scripts/cv/models/tracknet-v2.onnx` when `PADEL_BALL_BACKEND=tracknet`
5. In `analysisPipeline.ts`, for each 3-frame window:
   - Stack frames as 9-channel Float32 tensor `[1, 9, H, W]`
   - Run TrackNet ONNX → heatmap `[1, 1, H, W]`
   - `argmax` the heatmap → `(x, y)` pixel position
   - Apply Kalman filter (simple 2D constant-velocity model) for smoothing
6. Add Kalman filter implementation in `client/src/lib/kalmanFilter.ts` (copy standard 2D tracking impl)
7. Detect contact moments: sharp velocity change in ball trajectory → shot boundary

**Schema addition (Workstream B, coordinate first):**
```typescript
// shared/types.ts addition
export interface BallTrajectory {
  frames: Array<{ frame: number; x: number; y: number; confidence: number }>;
  contactFrames: number[]; // frame indices where ball-racket contact detected
}
```

**Acceptance criteria:** Ball tracked across >80% of visible frames in a test padel rally clip; contact frames align with visually obvious hits.

---

### Phase 3 — Court Calibration + 2D Bird's-Eye View

**Goal:** Map player and ball positions to a standardized 2D padel court for shot charts and heatmaps.

**Files to touch (Workstream A + B):**
- `client/src/lib/courtCalibration.ts` (new) — keypoint detection + homography
- `client/src/components/CourtView.tsx` (new) — 2D SVG court overlay
- `shared/types.ts` — add `CourtHomography` type
- `server/db` — cache homography matrix per analysis

**Steps:**
1. Fine-tune a ResNet50 (or EfficientNet-B0) on padel court keypoints using images from `DS_Padel` + `PadelVic` datasets
   - Label 12–16 court keypoints per image (corners, service boxes, center line intersections)
   - Export to ONNX
2. In `courtCalibration.ts`:
   - Run keypoint model once on first video frame
   - Map detected keypoints to known real-world padel court coordinates (in meters: 10m × 20m)
   - `cv2.findHomography(detectedPoints, realWorldPoints, RANSAC)` — implement in JS using a homography library (e.g., `homography` npm package or implement 4-point DLT)
3. Apply homography matrix per frame to project ball/player positions to 2D court space
4. Render as SVG court in `CourtView.tsx` with dot trails

**Reference:** Directly follow the `abdullahtarek/tennis_analysis` mini-court implementation pattern.

**Padel court real-world coords (use these as anchor points):**
```
Court: 10m wide × 20m long
Baseline: y=0, y=20
Sidelines: x=0, x=10
Service line: y=6.95 (from net), y=13.05
Net: y=10
```

**Acceptance criteria:** A test video shows ball trajectory plotted on a flat 2D court with <0.5m positional error vs manual measurement.

---

### Phase 4 — Stroke Classification (Padel-Specific)

**Goal:** Automatically label each shot: forehand drive, backhand drive, bandeja, vibora, topspin smash, forehand volley, backhand volley, lob.

**Files to touch (Workstream A):**
- `client/src/lib/strokeClassifier.ts` (replaces/extends `shotClassifier.ts`)
- `shared/types.ts` — add `PadelStrokeType` enum
- `client/src/components/ShotTimeline.tsx` (new) — shot-by-shot breakdown

**Architecture (from `padel_analytics` repo):**
1. Segment video into shots using `contactFrames` from Phase 2
2. For each shot segment, extract a 30-frame window centered on contact
3. For each frame, extract 17 pose keypoints (from Phase 1 YOLO-pose)
4. Stack keypoints into a `[30, 34]` tensor (17 keypoints × 2 coords per frame)
5. Run through a 1D-CNN or lightweight transformer
6. Output: stroke type + confidence

**Model to train:**
- Architecture: 3-layer 1D-CNN with temporal pooling (small enough to ONNX-export for browser)
- Training data: label shots from `padel_analytics` dataset + your own videos
- Export: PyTorch → ONNX → `client/public/models/stroke-classifier.onnx`

**New shared type:**
```typescript
export type PadelStrokeType =
  | 'forehand_drive'
  | 'backhand_drive'
  | 'bandeja'
  | 'vibora'
  | 'topspin_smash'
  | 'forehand_volley'
  | 'backhand_volley'
  | 'lob'
  | 'unknown';
```

**Reference:** `Joao-M-Silva/padel_analytics` has this exact pipeline working — copy the model architecture, retrain on more data.

---

### Phase 5 — Server-Side Heavy Processing (hybrid architecture)

**Goal:** Move TrackNetV4 (full video, high quality) and batch stroke classification to the server. Browser does real-time preview; server does definitive post-processing.

**Files to touch (Workstream B):**
- `server/_core/mlPipeline.ts` (new) — Python subprocess wrapper for TrackNetV4
- `server/routers/analysis.ts` — add async job status polling
- `shared/types.ts` — add `AnalysisStatus: 'processing' | 'complete' | 'failed'`

**Architecture:**
```
Browser (real-time, per-frame):
  → YOLO11-pose ONNX (WebGPU) → player keypoints
  → TrackNetV2 ONNX (WebGPU) → ball positions (preview quality)
  → Show results immediately

Server (async, post-upload):
  → Python: TrackNetV4 on full video → high-quality ball trajectory
  → Python: Stroke classification on full rally
  → Store enriched JSON in SQLite
  → Notify client via tRPC polling → update UI with upgraded results
```

**Note:** This requires a Python environment on the server. Use a virtualenv in `server/ml/` with `torch`, `onnxruntime`, `opencv-python`. The Express server calls it via `child_process.spawn`.

---

## Recommended Implementation Order

```
Week 1:  Phase 1 (WebGPU + YOLO-pose) — biggest speedup, least risk
Week 2:  Export TrackNetV2 to ONNX, integrate Phase 2 ball tracking
Week 3:  Phase 3 court calibration (hardest — model training required)
Week 4:  Phase 4 stroke classifier (needs labeled data)
Later:   Phase 5 server pipeline (after auth/deployment is resolved)
```

---

## Workstream Assignment

Add a new workstream to `AGENTS.md`:

| ID | Scope | Primary paths | Typical tasks |
|---|---|---|---|
| **D — ML Models** | ONNX model assets, inference libs, training scripts | `client/public/models/`, `client/src/lib/analysisPipeline.ts`, `client/src/lib/tracknet.ts`, `client/src/lib/courtCalibration.ts`, `training/` | Export/quantize ONNX models, implement inference wrappers, Kalman filter, homography |

**Shared contracts to coordinate before parallel edits:**
- `shared/types.ts` — `BallTrajectory`, `PadelStrokeType`, `CourtHomography` must be agreed before Workstreams A and D diverge
- `server/routers/analysis.ts` — schema additions for ball trajectory storage

---

## Model Files Checklist

When ready to implement, these ONNX models need to be exported and placed in `client/public/models/`:

| File | Source | Size (est.) |
|---|---|---|
| `yolo11n-pose.onnx` | Ultralytics official release | ~6MB |
| `tracknet-v2.onnx` | Export from `yastrebksv/TrackNet` | ~6MB fp16 |
| `court-keypoints.onnx` | Fine-tune ResNet50 → export | ~25MB (or EfficientNet-B0 ~20MB) |
| `stroke-classifier.onnx` | Train 1D-CNN from `padel_analytics` | ~1MB |

All models should be served with `Cache-Control: max-age=31536000, immutable` and loaded lazily (only when analysis starts).

Server-side TrackNet is opt-in via `PADEL_BALL_BACKEND=tracknet`. If `scripts/cv/models/tracknet-v2.onnx` is missing, the server falls back to the OpenCV ball tracker so uploads and pose analysis still complete. Runtime tuning is environment-driven:

```
PADEL_BALL_BACKEND=tracknet
TRACKNET_MODEL_PATH=scripts/cv/models/tracknet-v2.onnx
TRACKNET_INPUT_WIDTH=512
TRACKNET_INPUT_HEIGHT=288
TRACKNET_MIN_CONFIDENCE=0.25
TRACKNET_EXECUTION_PROVIDERS=CPUExecutionProvider
CV_BALL_TIMEOUT_MS=900000
CV_PROCESS_SIGKILL_GRACE_MS=5000
```

---

## Key Papers for Reference

- **TrackNetV4** (ICASSP 2025): [arxiv.org/abs/2409.14543](https://arxiv.org/abs/2409.14543)
- **RacketVision benchmark** (Nov 2024): [arxiv.org/abs/2511.17045](https://arxiv.org/abs/2511.17045) — ball + racket pose + trajectory forecasting
- **BST Stroke Transformer** (2025): [arxiv.org/abs/2502.21085](https://arxiv.org/abs/2502.21085) — skeleton-based shot classification
- **Court line detection** (amateur footage): [arxiv.org/pdf/2404.06977](https://arxiv.org/pdf/2404.06977)

---

## Agent Brief Template for ML Work

Paste at the top of a new Cursor chat when working on this upgrade:

```
Workstream: D — ML Models
Branch: feat/ml-<topic>
Goal: <one sentence, e.g. "Integrate TrackNetV2 ONNX for ball tracking in analysisPipeline.ts">
Out of scope: UI components, tRPC routers, DB schema (coordinate shared types first)
Depends on: shared/types.ts BallTrajectory type agreed + merged

Context docs:
- ML_UPGRADE_PLAN.md (this file) — full upgrade roadmap
- TECH_STRATEGY.md — architectural milestones and patterns to follow
- AGENTS.md — workstream rules and merge order
- client/src/lib/analysisPipeline.ts — existing pipeline to extend
- shared/types.ts — shared contracts (do not duplicate)
```
