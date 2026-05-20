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
npx tsx scripts/ball-tracking.test.ts   # ball helper smoke tests
```

From the repo root:

```bash
npm run mobile:start           # Start Metro in /mobile
npm run mobile:typecheck       # Type-check /mobile
npm run test:mobile-ball-tracking
npm run release:beta-gates     # full beta gate suite (includes mobile typecheck)
```

**iOS gotcha**: Expo requires full Xcode, not just Command Line Tools. If the simulator fails to launch, run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`. The `npm run ios` script already sets `DEVELOPER_DIR` to work around this automatically.

## Environment

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_BASE_URL`:
- iOS Simulator: `http://localhost:3001`
- Physical device: `http://192.168.x.x:3001` (use machine's local IP)
- Production: `https://api.your-domain.com`

`app.json` allows cleartext HTTP to LAN hosts on iOS (`NSAllowsLocalNetworking`) and Android (`usesCleartextTraffic`). After Expo config changes, run a native rebuild or `npx expo prebuild --clean` before retesting uploads on hardware (Metro alone is insufficient).

## Architecture

### Mobile is a thin client

All ML and analysis logic runs server-side (Python + MediaPipe via `scripts/analyze_video.py` and CV agents). The mobile app uploads video, polls for job status, and renders results. There is no on-device inference — intentional for v1.

### Beta scope (see `docs/BETA_SCOPE.md`)

**In scope:** upload, job progress, skeleton replay, ball marker + relative speed when `ballTracking` is present.

**Out of scope for this beta:** mobile racket overlay, match/rally CV UI (`MATCH_CV_ENABLED = false`), metric km/h without calibration.

### Screens and navigation

React Navigation native-stack (`src/screens/`):

1. **HomeScreen** — video picker, recent analyses, demo entry
2. **UploadScreen** / **RecordScreen** — capture or pick video
3. **JobStatusScreen** — polls `mobileAnalysis.getById` until completed/failed
4. **AnalysisScreen** — `analysis.getById`, video replay, skeleton + ball SVG overlay
5. **HistoryScreen**, **CompareScreen**, **ProCompareScreen**, **LoginScreen**, **PrivacyScreen**

Navigation types: `src/lib/navigation.ts` (`RootStackParamList`).

### API layer

- **tRPC client** (`src/lib/trpc.ts`): untyped `@trpc/client` with `httpBatchLink` + superjson. No imports from `shared/` (build independence).
- **REST upload** (`src/lib/api.ts`): `POST /api/upload` → `mobileAnalysis.create`
- **Base URL**: `EXPO_PUBLIC_API_BASE_URL` via `src/lib/config.ts`

### Tracking helpers

- `src/lib/ballTracking.ts` — parse tuples, frame map, speed label
- `src/lib/types.ts` — `BallTrackSample`, optional `ballTracking` on `AnalysisDetail`
- Demo: `getDemoAnalysisDetail()` includes synthetic `ballTracking`

### State management

TanStack React Query v5. Server-derived state only.

### Styling

React Native `StyleSheet`. Dark theme: `#0f172a` bg, `#a3e635` accent.

## Monorepo context

| Directory | Purpose |
|---|---|
| `server/` | Express + tRPC + SQLite |
| `shared/` | Zod schemas (not imported by mobile) |
| `client/` | Web app with full ball/racket overlays |
| `scripts/cv/` | Python CV agents |
| `data/` | SQLite, uploads, `analysis-agents/` job artifacts |

Device QA checklist: `docs/MOBILE_DEVICE_QA.md`.
