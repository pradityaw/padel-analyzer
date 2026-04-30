# TypeScript Baseline

Current baseline captured with `npx tsc --noEmit` on April 2026 after the architectural hardening/UI/pipeline fixes in this chat.

## 1. tRPC client typing is broken

Primary symptoms:
- `client/src/lib/trpc.ts` cannot resolve `../../server/routers/index.js`
- `createTRPCReact<AppRouter>()` collapses into collision error strings, so downstream properties like `trpc.analysis`, `trpc.youtube`, `trpc.annotation`, `trpc.proCompare`, `trpc.useUtils`, and `trpc.Provider` all fail

Affected files:
- `client/src/lib/trpc.ts`
- `client/src/main.tsx`
- `client/src/pages/Analysis.tsx`
- `client/src/pages/Annotate.tsx`
- `client/src/pages/Compare.tsx`
- `client/src/pages/History.tsx`
- `client/src/pages/ProCompare.tsx`
- `client/src/pages/Upload.tsx`

Representative errors:
- `client/src/lib/trpc.ts(4,32): Cannot find module '../../server/routers/index.js'`
- `client/src/lib/trpc.ts(9,15): Property 'createClient' does not exist ...`
- `client/src/main.tsx(13,11): Property 'Provider' does not exist ...`

Recommended next step:
- Fix the client-side `AppRouter` type import path / project reference boundary first. Until that is resolved, most frontend tRPC errors are noise.

## 2. Implicit `any` debt in page components

Affected files:
- `client/src/pages/Annotate.tsx`
- `client/src/pages/Compare.tsx`
- `client/src/pages/History.tsx`
- `client/src/pages/ProCompare.tsx`

Representative errors:
- `client/src/pages/Annotate.tsx(160,41): Parameter 's' implicitly has an 'any' type`
- `client/src/pages/Compare.tsx(81,31): Parameter 'a' implicitly has an 'any' type`
- `client/src/pages/History.tsx(42,59): Parameter 'acc' implicitly has an 'any' type`
- `client/src/pages/ProCompare.tsx(355,32): Parameter 'p' implicitly has an 'any' type`

Recommended next step:
- Once the tRPC type import issue is fixed, add explicit types to the page-level array callbacks and reducer accumulators.

## 3. Unknown sorting values in history

Affected file:
- `client/src/pages/History.tsx`

Representative errors:
- `client/src/pages/History.tsx(51,23): 'b' is of type 'unknown'`
- `client/src/pages/History.tsx(51,27): 'a' is of type 'unknown'`

Recommended next step:
- Type the sort inputs before comparing them.

## Build note

`npm run build` currently fails after the Vite client build completes because the server esbuild step hits a native dependency issue:

- `No loader is configured for ".node" files: node_modules/fsevents/fsevents.node`

This appears unrelated to the fixes from this chat and should be handled as a separate tooling task.
