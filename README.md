# Padel Swing Analyzer

AI-powered padel swing analysis using MediaPipe pose estimation. Upload a video of your swing and get detailed biomechanical feedback with scoring.

## Features

- **Video upload** — drag & drop or file picker (.mp4, .mov, .webm)
- **AI pose detection** — MediaPipe BlazePose tracks 33 body landmarks in-browser
- **Swing phase detection** — automatically segments Ready, Backswing, Forward Swing, Contact, Follow-Through
- **Biomechanical scoring** — per-phase scoring based on ideal angle ranges
- **Visual overlay** — skeleton drawn on top of your video with frame-by-frame stepping
- **History tracking** — view past analyses and track score progress over time
- **Side-by-side comparison** — compare two swing analyses with metric diffs
- **PWA ready** — installable on iOS/Android from the browser

## Tech Stack

- React 19 + Vite + TypeScript
- MediaPipe Tasks Vision (BlazePose)
- Tailwind CSS v4 + Radix UI
- Express + tRPC
- Drizzle ORM + SQLite
- Recharts, Framer Motion

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser (default port is 3001)
open http://localhost:3001
```

## Mobile app (Expo)

Native clients use **server-side** analysis (Python + MediaPipe on the machine running the API). See [`mobile/README.md`](mobile/README.md).

Competitor UX research (SwingVision agent-device QA) is indexed at [`docs/competitor_qa.md`](docs/competitor_qa.md).

```bash
npm run mobile:start    # Metro in /mobile
npm run mobile:typecheck
```

**Always-on Expo Go (physical device, same Wi‑Fi):** `npm run daemon:start` — see **[docs/EXPO_GO_ALWAYS_ON.md](./docs/EXPO_GO_ALWAYS_ON.md)** for PM2 setup, `.env` rules, and reboot persistence.

Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` (see `mobile/.env.example`). After pulling, apply DB migrations: `npm run db:push` (or `db:migrate`).

## Physical iPhone QA (agent-device)

For Cursor-driven verification on a real iPhone (e.g. Swing Vision competitive analysis), see **[docs/AGENT_DEVICE_SETUP.md](./docs/AGENT_DEVICE_SETUP.md)** and run `./scripts/check-agent-device-prereqs.sh` before `./scripts/agent-device-swing-vision-smoke.sh`. To halt an in-progress QA agent: `./scripts/stop-agent-device-qa.sh`.

## Parallel work (multiple agents / chats)

See **[AGENTS.md](./AGENTS.md)** for workstream ownership (client vs server vs tooling), merge order, branch naming, and optional git worktrees.

## UI design (MagicPath + Cursor)

To explore or redesign web screens with [MagicPath](https://magicpath.ai) connected to Cursor via MCP, see **[docs/MAGICPATH.md](./docs/MAGICPATH.md)** (setup checklist, scope, and first-session workflow).

## Build for Production

```bash
npm run build
npm start
```
