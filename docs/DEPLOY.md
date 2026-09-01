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
fly secrets set PUBLIC_APP_URL="https://<your-app>.fly.dev"
fly secrets set EMAIL_PROVIDER=resend
fly secrets set EMAIL_FROM="Padel Analyzer <noreply@yourdomain>"
fly secrets set RESEND_API_KEY="re_..."
fly secrets set AUTH_ADMIN_EMAIL="you@yourdomain"
# Optional: error reporting
fly secrets set SENTRY_DSN="https://...@sentry.io/..."
# Optional: Postgres instead of SQLite on the volume (see docs/POSTGRES.md)
# fly secrets set DATABASE_URL="postgres://..."

# Real-time Slack feedback (easiest: all keys from .env.feedback)
npm run feedback:fly-secrets
# or secrets + build + deploy:
npm run feedback:fly-deploy
```

`BALL_TRACKING_ENABLED=false` is set in `fly.toml` `[env]` for the pose-only beta. Do not commit secrets in `fly.toml`. See `.env.example` for the local template.

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

1. **Schema is created at boot.** `ensureSchema()` in `server/lib/ensureSchema.ts` creates missing SQLite tables/columns when the process starts, seeds `AUTH_ADMIN_EMAIL`, and backfills null `user_id` rows. You do **not** need `drizzle-kit push` as the only path on a fresh Fly volume. Optional: still run `npx drizzle-kit push` if you want Drizzle's migrator as a second check.
2. Persist **`data/analysis-agents/`** on the same Fly volume as SQLite and uploads. Pose-only beta leaves ball/racket artifacts empty on purpose (`BALL_TRACKING_ENABLED=false`).
3. Open the app URL; with `AUTH_MODE=on`, use **Sign in** (magic link via Resend). Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL`. In development, `EMAIL_PROVIDER=console` logs the URL after `auth.requestMagicLink`.

`fly.toml` sets `swap_size_mb = 1024` so MediaPipe pose can survive a 1 GB VM. Do not `fly deploy` from Cloud Agent pilot sessions.

## Cursor SDK deploy gate

With `CURSOR_API_KEY` set locally:

```bash
npm run cursor-sdk -- --task deploy-check
```

Review the generated notes in `.cursor-sdk-runs/` for provider-specific tweaks.
