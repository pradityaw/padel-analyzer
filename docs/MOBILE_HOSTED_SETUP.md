# Hosted mobile — test anywhere (laptop off)

Install a **preview build** on your phone that talks to a **cloud API** on Fly.io. No Metro, no Expo Go, no Mac required after setup.

## Architecture

```
Phone (EAS preview app)  ──HTTPS──►  https://padel-analyzer.fly.dev
                                      uploads · analysis · SQLite on Fly volume
```

Config lives in [`hosted.config.json`](../hosted.config.json). EAS bakes `EXPO_PUBLIC_API_BASE_URL` at build time (`mobile/eas.json` preview/production profiles).

## One-time manual steps (you)

### 1. Fly billing

Your Fly account must be active (trial requires a card):

**https://fly.io/dashboard/personal/billing**

### 2. Fly CLI login (if needed)

```bash
brew install flyctl   # once
fly auth login        # browser
```

### 3. Expo / EAS login

```bash
npm run hosted:login  # opens browser — create free Expo account if needed
```

### 4. Apple Developer (iOS only)

- **Android APK** — no store account; install the APK from EAS directly.
- **iOS** — Apple Developer Program ($99/yr) for TestFlight or internal device builds. EAS will prompt for credentials on first iOS build.

## Automated setup (agent or you)

From repo root:

```bash
npm run hosted:check          # readiness report
npm run hosted:deploy-api     # Fly volume + secrets + deploy + healthz
npm run hosted:setup          # eas init — links project in app.json
npm run hosted:build:android  # recommended first — APK install link
npm run hosted:build:ios      # TestFlight / internal when Apple creds ready
npm run hosted:build:status   # list recent EAS builds
```

## After the Android build

1. Open the build URL from the terminal (or `npm run hosted:build:status`).
2. Download the **APK** on your phone (or scan QR).
3. Allow install from unknown sources (Android).
4. Open **Padel Analyzer Mobile** — Home should show `API: https://padel-analyzer.fly.dev`.
5. Upload a short `.mp4` and confirm job → analysis completes on **cellular** (away from home Wi‑Fi).

## After the iOS build

1. EAS offers **internal distribution** or **TestFlight** depending on credentials.
2. Install the build on your iPhone.
3. Same API URL check on Home.

## Changing the API URL

1. Edit `hostedApiBaseUrl` in `hosted.config.json`.
2. Update `env.EXPO_PUBLIC_API_BASE_URL` in `mobile/eas.json` to match.
3. Re-run `npm run hosted:build:android` (or ios).

## Auth

Default deploy uses `AUTH_MODE=off` so testers can upload without magic-link email. For production:

```bash
AUTH_MODE=on npm run hosted:deploy-api -- --secrets-only
```

Configure outbound email before requiring sign-in on hosted (see `docs/DEPLOY.md`).

## Troubleshooting

| Symptom | Fix |
| -------- | ----- |
| `trial has ended` on deploy | Add card on Fly billing |
| `Not logged in` EAS | `npm run hosted:login` |
| `not linked` EAS project | `npm run hosted:setup` |
| API unreachable on phone | `curl https://padel-analyzer.fly.dev/healthz` → 200 |
| Upload fails | Fly machine running; volume mounted; Python deps in Docker image |
| Old API URL in app | Rebuild EAS preview — env is compile-time |

## Local dev vs hosted

| Mode | Command | When |
|------|---------|------|
| Expo Go + Mac | `npm run daemon:start` | Same Wi‑Fi, Mac on |
| Hosted preview app | This doc | Anywhere, laptop off |

## Related

- [DEPLOY.md](./DEPLOY.md) — Fly details, secrets, uptime
- [mobile/BACKEND_CONTRACT.md](../mobile/BACKEND_CONTRACT.md) — API surface
- [mobile/STORE_READINESS.md](../mobile/STORE_READINESS.md) — App Store path later
