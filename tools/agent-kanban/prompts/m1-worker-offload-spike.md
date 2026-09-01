# Milestone 1 — Worker offload spike (backlog #9, partial)

Workstream **A** (Pipeline). Goal: honestly assess whether full MediaPipe/ONNX execution can run in `client/src/lib/pipeline.worker.ts`, or document why main-thread fallback remains required.

## Scope

1. Read `client/src/lib/pipeline.worker.ts`, `client/src/lib/analysisPipeline.ts`, and `Upload.tsx` integration.
2. Spike Safari + Chrome worker capability for MediaPipe Tasks Vision and ONNX runtime constraints.
3. If offload is not feasible, improve cancellation UX and document the limitation in code comments (not a new markdown doc).
4. Do not rewrite the entire pipeline — narrow, evidence-based change only.

## Out of scope

- Server-side Python analysis path (`mobile/`)
- Unrelated UI redesign

## Verification

- `npm run typecheck`
- Manual: start an upload analysis in the browser; confirm no regression in progress/cancel flow
