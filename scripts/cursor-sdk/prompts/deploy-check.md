# Deployment Check

You are preparing Padel Analyzer for a first live MVP deployment.

Do not assume a hosting provider unless the repo already documents one. Inspect the app shape and recommend the simplest viable deployment path.

Investigate:
- Build output and server entrypoint.
- Runtime requirements: Node version, SQLite file location, upload storage, model assets, `yt-dlp`, `ffmpeg`, environment variables.
- Whether the current server can run as a long-lived Node process.
- Whether the app relies on local filesystem writes that serverless hosts may not support.
- Whether PWA/mobile browser testing needs special production headers or asset paths.

Return:
- Recommended MVP hosting path.
- Required environment variables.
- Required build/start commands.
- Data persistence risks.
- Upload/video storage risks.
- A pre-deploy checklist.
- A rollback plan.

Do not change deployment configuration unless explicitly instructed in a follow-up run.
# Deployment Check

You are preparing Padel Analyzer for a first live MVP deployment.

Do not assume a hosting provider unless the repo already documents one. Inspect the app shape and recommend the simplest viable deployment path.

Investigate:
- Build output and server entrypoint.
- Runtime requirements: Node version, SQLite file location, upload storage, model assets, `yt-dlp`, `ffmpeg`, environment variables.
- Whether the current server can run as a long-lived Node process.
- Whether the app relies on local filesystem writes that serverless hosts may not support.
- Whether PWA/mobile browser testing needs special production headers or asset paths.

Return:
- Recommended MVP hosting path.
- Required environment variables.
- Required build/start commands.
- Data persistence risks.
- Upload/video storage risks.
- A pre-deploy checklist.
- A rollback plan.

Do not change deployment configuration unless explicitly instructed in a follow-up run.
