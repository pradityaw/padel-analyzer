# Privacy policy (template)

This document mirrors the in-app **Privacy** page (`/privacy`). Operators of a self-hosted instance should replace contact details and jurisdiction-specific clauses before linking this URL from a production deployment or app store listing.

## Data controller

Whoever operates the server URL you use is the data controller for that deployment.

## What we process

- **Video uploads** — stored on disk for replay and server-side analysis (mobile path).
- **Derived pose data** — numeric landmarks and phase scores; may be stored in SQLite and/or separate landmark files on disk.
- **Account data** (optional) — when `AUTH_MODE=on`, email address and session cookies for magic-link authentication.

## Legal bases (adapt per region)

For EU/UK deployments, identify your lawful basis (typically contract/legitimate interests for sports coaching feedback). Non-EU operators should still document purpose limitation and retention.

## Retention and deletion

Users can delete individual analyses from the Sessions UI where implemented. Server operators are responsible for backups, log rotation, and wiping decommissioned disks.

## Subprocessors

- **CDN / ML in browser** — MediaPipe and related assets may load from third-party CDNs when using the web client’s in-browser pipeline.
- **Error reporting** — if `SENTRY_DSN` (server) or `EXPO_PUBLIC_SENTRY_DSN` (mobile) is set, crash metadata may be sent to Sentry.

## Contact

Replace this section with a monitored email or support form for your deployment.
