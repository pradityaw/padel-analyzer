# Deploy Padel Analyzer (Fly.io)

Recommended MVP hosting: **[Fly.io](https://fly.io)** — long-lived Node process, persistent volumes for SQLite + uploads + landmark files, and straightforward `yt-dlp` / `ffmpeg` via Dockerfile.

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed (`brew install flyctl`) and logged in (`npm run feedback:fly-login`)
- A Fly app name (update `app` in [`fly.toml`](../fly.toml) if you fork)
- **`.env.feedback`** at repo root with Slack + Cursor keys (see `.env.feedback.example`)

## One-time setup

```bash
cd /path/to/padel-analyzer
fly launch --no-deploy --copy-config   # or: fly apps create your-app-name
fly volumes create padel_data --region ams --size 3
```

Attach the volume in `fly.toml` under `[mounts]` (see repo `fly.toml`).

## Secrets & env

```bash
fly secrets set NODE_ENV=production
fly secrets set AUTH_MODE=on
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
# Optional: error reporting
fly secrets set SENTRY_DSN="https://...@sentry.io/..."
# Optional: Postgres instead of SQLite on the volume (see docs/POSTGRES.md)
# fly secrets set DATABASE_URL="postgres://..."

# Real-time Slack feedback (easiest: all keys from .env.feedback)
npm run feedback:fly-secrets
# or secrets + build + deploy:
npm run feedback:fly-deploy
```

After deploy, set Slack **Event Subscriptions** request URL to:

`https://<your-app>.fly.dev/api/slack/events`

`fly.toml` keeps `min_machines_running = 1` so the webhook is reachable without cold-start delay.

## Deploy

```bash
npm ci
npm run build
fly deploy
```

## Health checks

- **Fly**: HTTP checks hit `/healthz` (configured in `fly.toml`).
- **UptimeRobot** (or similar): add a monitor on `https://<your-app>.fly.dev/healthz`, interval 5 min, alert on non-200.

## Post-deploy

1. Run DB push once on the machine (or bake into release command): `fly ssh console -C "cd /app && npx drizzle-kit push"` when using SQLite on the volume.
2. Persist **`data/analysis-agents/`** on the same Fly volume as SQLite and uploads. Ball/racket overlays read `job-{id}.json` from this directory; wiping the volume without re-running jobs yields empty tracking on `analysis.getById`.
3. Open the app URL; with `AUTH_MODE=on`, use **Sign in** (magic link). In development, the sign-in URL is printed in server logs after `auth.requestMagicLink`. Configure outbound email for production magic links when you add an email provider.

## Cursor SDK deploy gate

With `CURSOR_API_KEY` set locally:

```bash
npm run cursor-sdk -- --task deploy-check
```

Review the generated notes in `.cursor-sdk-runs/` for provider-specific tweaks.
