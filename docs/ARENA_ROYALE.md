# Arena Royale — multiplayer battle game

A cute, top-down **last-one-standing** battle built into the mobile app. 2–4
players, joystick to move + tap to fire, a shrinking storm forces fights, last
fighter alive wins. Rounds last ~1–3 minutes.

## Modes

- **Vs bots (offline):** single device, no network. The shared simulation runs
  locally; you're `p1`, the rest are client-side bots.
- **Online (invite-based):** any player creates a battle → gets a short room
  code + shareable link → friends join → host taps **Start**. The server is the
  single authority; clients send input and render interpolated snapshots.

> LAN/same-WiFi play is intentionally **not** included — online uses the
> server, and the bots mode covers offline play.

## Architecture

```
shared/game/
  sim/        pure, deterministic fixed-timestep simulation (the authority core)
  protocol/   wire types (pure TS, mobile-safe) + zod validators (server only)
server/game/  ws server on /game + in-memory match registry (authoritative host)
server/routers/game.ts   tRPC lobby (createSession / checkSession / getResult)
mobile/src/game/   Skia renderer, touch controls, online transport, screens
```

- The **simulation** (`shared/game/sim`) is a pure reducer
  `stepWorld(state, inputs, config)` at 30 Hz — no I/O, no `Math.random`, no
  wall-clock. Determinism is covered by `shared/game/sim/world.test.ts`.
- The **server** runs the authoritative match (`LiveMatch`), ticks at 30 Hz and
  broadcasts snapshots at 20 Hz over a `ws` server sharing the HTTP port at
  `/game`. Only the lobby row and final results are persisted
  (`game_sessions`, `game_results`); live state stays in memory.
- The **client** renders with `@shopify/react-native-skia` on a
  requestAnimationFrame loop and interpolates ~100 ms behind the snapshot
  stream. Input is read from Reanimated shared values (joystick) and a ref
  (fire) so the loop never blocks on React re-renders.

## Requires an Expo dev build

`@shopify/react-native-skia` is a native module, so this runs in an **Expo dev
build**, not Expo Go:

```bash
cd mobile
npx expo prebuild --clean      # or: eas build --profile development
npm run ios                    # / npm run android  (after the dev build is installed)
```

Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to your server
(e.g. `http://192.168.x.x:3001`). The WebSocket URL is derived from it
(`ws(s)://…/game`). Deep-link invites use the app scheme:
`padelanalyzer://join/<CODE>`.

## Tests

```bash
npm run test:game        # sim determinism + full match lifecycle (no device needed)
npm run typecheck        # server + shared
npm run mobile:typecheck # mobile
```

## How to verify end-to-end on devices

1. Start the server: `npm run dev` (listens on `:3001`, `/game` WS attached).
2. Build + launch the mobile dev build on two phones (or a phone + simulator).
3. On Home → **Play Arena Royale**.
   - **Vs bots:** tap *Play vs bots* — confirm movement, firing, storm shrink,
     and a win/lose overlay.
   - **Online:** on phone A tap *Create online battle*, share/read the code; on
     phone B *Join with a code* (or open the shared link). Host taps *Start* and
     both phones play the same synced match to a winner + results.
