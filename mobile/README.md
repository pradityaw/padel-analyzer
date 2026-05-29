# Padel Analyzer Mobile

Expo / React Native client for the native mobile v1 flow:

1. Pick a video on-device.
2. Upload it to the existing backend.
3. Start a server-side analysis job.
4. Poll for completion and view the analysis summary (skeleton replay + best-effort ball overlay).

**Beta scope:** see [../docs/BETA_SCOPE.md](../docs/BETA_SCOPE.md). Racket-head tracking and match analytics are web-only for now.

## Setup

```bash
cd mobile
cp .env.example .env
npm install
```

Set `EXPO_PUBLIC_API_BASE_URL` to your backend.

- Simulator example: `http://localhost:3001`
- Physical device example: `http://192.168.x.x:3001`

## iOS Simulator (one-time Mac setup)

Expo needs the **full Xcode** toolchain (not Command Line Tools only). If `xcode-select -p` shows `CommandLineTools`, run once (password prompt):

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

The `npm run ios` script sets `DEVELOPER_DIR` so `xcrun simctl` uses full Xcode even when the default `xcode-select` path is still Command Line Tools—useful if you can’t change the global path yet.

## Run

```bash
npm start
```

### iOS Simulator

```bash
npm run ios
# or: ./scripts/ios-simulator.sh
```

If `expo start --ios` times out while opening `exp://` in Expo Go (rare on a cold Simulator), keep Metro running and open the dev URL manually:

```bash
# Terminal 1
npm run start

# Terminal 2 (after Metro shows "Waiting on http://localhost:8081")
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun simctl launch booted host.exp.Exponent
xcrun simctl openurl booted "exp://127.0.0.1:8081"
```

You can also use the repo-root helpers:

```bash
npm run mobile:start
npm run mobile:typecheck
```

## iOS native warning noise (Expo prebuild-safe)

To reduce third-party warning noise in Debug simulator builds, this app enables a config plugin at `mobile/plugins/withPodfileWarningSuppressions.js` via `app.json`.

- It patches the generated `ios/Podfile` `post_install` block during `expo prebuild`.
- It applies warning suppression at the Pods project level (`GCC_WARN_INHIBIT_ALL_WARNINGS`, `SWIFT_SUPPRESS_WARNINGS`, plus `-Wno-nonportable-include-path`) to reduce third-party warning noise.
- It does **not** disable warnings on the app target (`PadelAnalyzerMobile`), so app-source warnings still surface normally.

Run a clean iOS native regenerate when needed:

```bash
npm run ios:prebuild:clean
```

Remaining warnings are mostly emitted while compiling app target sources that include third-party headers, or upstream warnings outside pod-target build settings control.

## Native iOS build & CI

`mobile/ios` is a generated Expo prebuild output and is intentionally not committed. Regenerate it whenever native config/plugins change.

From the repo root:

```bash
npm run mobile:ios:prebuild      # expo prebuild --platform ios
npm run mobile:ios:setup-tests   # add unit/UI test targets to generated xcodeproj
npm run mobile:ios:build         # xcodebuild clean + build (Debug simulator)
npm run mobile:ios:test          # xcodebuild test (also runs setup hook if present)
npm run mobile:ios:qa            # prebuild + setup-tests + build + test
```

Equivalent commands are available from `mobile/package.json` as `ios:prebuild`, `ios:setup-tests`, `ios:build`, `ios:test`, and `ios:qa`.

Test source templates live in `mobile/ios-native-tests/` and are applied into generated `mobile/ios/` by `mobile/scripts/setup-ios-test-targets.mjs`.

CI mirrors the same flow in `.github/workflows/mobile-ios.yml`:

1. `npm ci` (root and `mobile/`)
2. `expo prebuild --platform ios`
3. `pod install`
4. `setup-ios-test-targets.mjs`
5. `xcodebuild clean build`
6. `xcodebuild test` (starts Metro on `:8081` when needed, then runs UI smoke tests; fails if no tests are executed)

### Always-on Expo Go (physical device)

From the repo root, keep API + Metro running in the background:

```bash
npm run daemon:start
npm run daemon:status
```

See [../docs/EXPO_GO_ALWAYS_ON.md](../docs/EXPO_GO_ALWAYS_ON.md) for `.env` (avoid `localhost` on a real phone), firewall, and `daemon:startup` / `daemon:save` after reboot.

## Server-side analysis dependency

The backend job runner calls:

- `python3`
- `scripts/analyze_video.py`

Install the Python packages in `scripts/requirements-server-analysis.txt` on the machine running the backend.

## Current v1 scope

- Included: upload, server job status, sessions list, analysis summary
- Not yet included: native video overlay replay, annotation tools, pro comparison flows

## Reference docs

- `MOBILE_ARCHITECTURE.md`
- `BACKEND_CONTRACT.md`
- `STORE_READINESS.md`
- `REUSE_AUDIT.md`
