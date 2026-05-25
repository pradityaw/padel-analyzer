# Mobile device QA checklist (beta)

Run after `npm run release:beta-gates` passes and the API is reachable from the device network.

## Setup

1. Start server: `npm run dev` (default `http://localhost:3001`).
2. Mobile `.env`: `EXPO_PUBLIC_API_BASE_URL`
   - iOS Simulator: `http://localhost:3001`
   - Physical device: `http://<LAN-IP>:3001` (same Wi‑Fi, firewall allows 3001).
3. `npm run mobile:start` (or `npm run dev:mobile` from repo root).

## Checklist

| # | Step | Pass criteria |
|---|------|----------------|
| 1 | Demo analysis | Home → open demo / sample analysis → skeleton + orange ball visible without crash |
| 2 | Upload short clip | Upload completes; JobStatus shows stages including ball trajectory when CV deps installed |
| 3 | Completed job → Analysis | Skeleton syncs with video scrub; ball marker appears when `ballTracking` non-empty |
| 4 | Missing tracking | Session with empty `ballTracking` shows hint text, no crash |
| 5 | Backend down | Turn off server → upload shows network error (no hang) |
| 6 | Physical device | Repeat 2–4 on one iOS and one Android device against LAN API |

## Record results

- Date / build:
- iOS device or simulator:
- Android device or emulator:
- Ball overlay on real upload: yes / no / N/A
- Notes:

See also [BETA_SCOPE.md](./BETA_SCOPE.md) for in-scope vs out-of-scope features.
