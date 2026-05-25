# Moving from SQLite to PostgreSQL

The production MVP uses **SQLite on a Fly volume** (`PADEL_DATA_DIR`, see `docs/DEPLOY.md`). Postgres is optional for scale-out or managed backups.

## Why migrate

- Multiple app instances behind a load balancer (SQLite on a shared volume does not scale writes).
- Managed backups / point-in-time recovery from a cloud provider.
- Operational preference for RDS / Neon / Supabase.

## Practical path

1. **Provision Postgres** and create an empty database + user with DDL rights.
2. **Schema** — reuse the same Drizzle schema file (`drizzle/schema.ts`) with a Postgres dialect adapter (replace `sqliteTable` imports with `pgTable` equivalents — this repo ships SQLite-first; expect a focused migration PR to duplicate or abstract table definitions).
3. **Environment** — set `DATABASE_URL` (or your chosen env var) on the server; stop writing to `padel.db` on the volume for application data.
4. **Data migration** — export analyses + users from SQLite (CSV or one-off script) and import into Postgres with stable IDs if you must preserve history; otherwise treat as a cutover and clear clients.
5. **Landmarks** — keep large JSON on disk (`landmarksPath`) exactly as today; only metadata moves to Postgres.

## Example compose file

See `docker-compose.postgres.yml` in the repo root for a local Postgres 16 service you can point tools at.

## Drizzle config template

`drizzle.config.postgres.ts` is a **template** — copy to `drizzle.config.pg.ts`, fill `dbCredentials.url` from env, and run `drizzle-kit push` against Postgres when your schema has been ported to `pgTable`.

Dual-driver runtime (SQLite + Postgres in one binary) is intentionally **out of scope** here to avoid a large refactor; pick one database per deployment until a shared abstraction is implemented.
