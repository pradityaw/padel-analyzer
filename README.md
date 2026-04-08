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

## Parallel work (multiple agents / chats)

See **[AGENTS.md](./AGENTS.md)** for workstream ownership (client vs server vs tooling), merge order, branch naming, and optional git worktrees.

## Build for Production

```bash
npm run build
npm start
```
