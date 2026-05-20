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
