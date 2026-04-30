# Reuse Audit

## Reused directly in the implemented mobile v1

- backend persistence in `server/**`
- shared analysis data model in `shared/schema.ts`
- shared config/constants in `shared/config.ts`
- analysis result storage in `drizzle/schema.ts`
- uploaded asset serving in `server/_core/index.ts`

## Reused conceptually, but not imported directly into the native client

- upload -> process -> results journey from the web app
- session/history list behavior from the web app
- analysis score and phase presentation patterns

These stayed conceptually aligned, but the React DOM/Tailwind implementation was rebuilt natively.

## Rewritten for mobile

- app shell and navigation
- upload UI
- processing/progress UI
- analysis summary UI
- networking configuration for absolute API origins

Primary files:

- `mobile/App.tsx`
- `mobile/src/screens/HomeScreen.tsx`
- `mobile/src/screens/JobStatusScreen.tsx`
- `mobile/src/screens/AnalysisScreen.tsx`

## Deferred from the web app

- `client/src/lib/mediapipe.ts`
- `client/src/lib/analysisPipeline.ts`
- `client/src/lib/shotClassifier.ts`
- `client/src/lib/skillClassifier.ts`
- `client/src/components/VideoPlayer.tsx`
- overlay replay and frame-by-frame skeleton rendering
- annotation and pro-comparison workflows

## Why these were deferred

- they rely on browser video/runtime assumptions
- `onnxruntime-web` is not the correct native runtime layer
- native v1 is intentionally server-analysis-first to reduce platform risk
