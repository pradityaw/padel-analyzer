# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

From the `/mobile` directory:

```bash
npm start           # Launch Metro + Expo Go dev server
npm run ios         # Open iOS simulator (sets DEVELOPER_DIR automatically)
npm run android     # Open Android emulator
npm run web         # Run Expo web target
npm run typecheck   # tsc --noEmit (run this to catch type errors without building)
npm run doctor      # expo-doctor: checks dependency compatibility
```

From the repo root:

```bash
npm run mobile:start      # Start Metro in /mobile
npm run mobile:typecheck  # Type-check /mobile
```

**iOS gotcha**: Expo requires full Xcode, not just Command Line Tools. If the simulator fails to launch, run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. The `npm run ios` script already sets `DEVELOPER_DIR` to work around this automatically.

## Environment

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL`:
- iOS Simulator: `http://localhost:3001`
- Physical device: `http://192.168.x.x:3001` (use machine's local IP)
- Production: `https://api.your-domain.com`

## Architecture

### Mobile is a thin client

All ML and analysis logic runs server-side (Python + MediaPipe via `scripts/analyze_video.py`). The mobile app only uploads video, polls for job status, and renders results. There is no on-device inference — this is intentional for v1.

### Screens and navigation

React Navigation native-stack with three screens (`src/screens/`):

1. **HomeScreen** — video picker + list of recent analyses
2. **JobStatusScreen** — polls `mobileAnalysis.getById(jobId)` every 1500ms until `status === "completed"` or `"failed"`, then navigates to Analysis
3. **AnalysisScreen** — fetches `analysis.getById(analysisId)` and renders phase breakdown

Navigation types are defined in `src/lib/navigation.ts` as `RootStackParamList`.

### API layer

- **tRPC client** (`src/lib/trpc.ts`): untyped `@trpc/client` with `httpBatchLink` + superjson transformer. No shared types from the server — client calls procedures by string name.
- **REST upload** (`src/lib/api.ts`): video uploaded as multipart FormData to `POST /api/upload`, returns `{ storageKey }`. Then `mobileAnalysis.create({ videoFileName, videoStorageKey })` kicks off the background job.
- **Base URL**: from `EXPO_PUBLIC_API_BASE_URL` via `src/lib/config.ts`

### State management

TanStack React Query (`@tanstack/react-query` v5). No Redux or Zustand. All state is server-derived.

### Styling

React Native `StyleSheet` only. Dark theme throughout: `#0f172a` background, `#1e293b` cards, `#a3e635` lime accent. No Tailwind, no Radix, no styled-components.

### Key types (`src/lib/types.ts`)

- `AnalysisJob`: tracks upload/processing job (`status: "queued" | "processing" | "completed" | "failed"`)
- `AnalysisDetail`: final result with `phasesJson` (stringified `AnalysisPhase[]`) and `landmarksJson`
- `AnalysisPhase`: `type`, `startFrame`, `endFrame`, `score`, and a `metrics` object (shoulderRotation, hipRotation, elbowAngle, kneeFlex, spineAngle, wristVelocity)

## Monorepo context

The mobile app lives inside a larger monorepo:

| Directory | Purpose |
|---|---|
| `server/` | Express + tRPC + SQLite (Drizzle ORM) backend |
| `shared/` | Zod schemas shared between server and tools (not imported by mobile) |
| `client/` | Original React browser app with in-browser MediaPipe + ONNX |
| `scripts/` | Python analysis pipeline (`analyze_video.py`), yt-dlp helpers |
| `drizzle/` | SQLite schema and migrations |
| `data/` | SQLite DB file and uploaded video storage |

The mobile app does **not** import from `server/` or `shared/` — the tRPC client is intentionally untyped to preserve build independence.
