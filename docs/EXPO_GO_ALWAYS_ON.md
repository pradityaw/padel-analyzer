# Expo Go always-on dev stack

Keep the API and Metro running in the background so you can open **Expo Go** on a physical device anytime (same Wi‑Fi), without starting terminals in Cursor.

## What runs

| PM2 name     | Port | Role                                      |
| ------------ | ---- | ----------------------------------------- |
| `padel-api`  | 3001 | Express + tRPC (listens on `0.0.0.0`)     |
| `padel-expo` | 8081 | Metro + Expo Go (`expo-live`, LAN mode)   |

Managed by [ecosystem.config.cjs](../ecosystem.config.cjs) via PM2 (`autorestart` on crash).

## One-time setup

```bash
cd /path/to/padel-analyzer
npm install
cd mobile && npm install && cd ..
```

PM2 is included as a dev dependency — use `npx pm2` or the `npm run daemon:*` scripts.

### Mobile `.env` (physical device)

Copy `mobile/.env.example` to `mobile/.env`.

**Recommended for Expo Go on Wi‑Fi:** leave `EXPO_PUBLIC_API_BASE_URL` unset (or commented out). The app derives `http://<your-mac-lan-ip>:3001` from the Metro bundle URL when you open the project in Expo Go.

Do **not** use `http://localhost:3001` on a physical phone — uploads and API calls will fail.

Optional explicit URL (update if your Mac’s DHCP IP changes):

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3001
```

PM2 sets `EXPO_PUBLIC_API_PORT=3001` for the auto-LAN fallback in `mobile/src/lib/config.ts`.

### Python (real uploads)

Install server analysis deps on the Mac running the API:

```bash
pip install -r scripts/requirements-server-analysis.txt
```

## Start / stop

```bash
npm run daemon:start      # start API + Expo
npm run daemon:status     # both should be "online"
npm run daemon:logs       # follow logs
npm run daemon:restart    # after .env or config changes
npm run daemon:stop       # stop both
```

## Persist across reboot (optional)

```bash
npm run daemon:startup    # copy the printed sudo launchctl command and run it
npm run daemon:save       # snapshot process list for resurrection on login
```

After login, PM2 should restore `padel-api` and `padel-expo` without manual steps.

## Daily phone workflow

1. Mac awake on the **same Wi‑Fi** as the phone.
2. Confirm daemons: `npm run daemon:status`.
3. Open **Expo Go** → recent project **Padel Analyzer Mobile**, or scan the QR from `npm run daemon:logs` (look for `exp://192.168.x.x:8081`).
4. On **Home**, confirm the API line shows a LAN IP (`192.168.*`), not `localhost`.
5. Shake device → **Reload** after pulling JS changes.

Interactive dev (terminal attached, auto git-pull): `npm run dev:mobile` or `npm run mobile:start:live`.

## macOS firewall

If uploads fail but demo works, allow **Node** incoming on ports **3001** and **8081** (System Settings → Network → Firewall).

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Expo Go “Could not connect” | Same Wi‑Fi; `daemon:status`; Mac not sleeping; retry `daemon:restart` |
| API shows `localhost` on phone | Remove `EXPO_PUBLIC_API_BASE_URL=localhost` from `mobile/.env`; reload bundle |
| Upload network error | Firewall; API URL must be Mac LAN IP; `padel-api` online |
| Port in use | `daemon:restart` (scripts free 3001/8081 on start) |
| Mac IP changed | Set explicit `EXPO_PUBLIC_API_BASE_URL` or reload after DHCP change |
| Stale JS after `.env` edit | `daemon:restart` (expo-live watches `.env` and nudges Metro reload) |

## Related

- [mobile/README.md](../mobile/README.md) — Expo setup and simulator notes
- [MOBILE_DEVICE_QA.md](./MOBILE_DEVICE_QA.md) — beta QA checklist
