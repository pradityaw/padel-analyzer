/**
 * Template — not wired into default `npm run db:push`.
 * After porting `drizzle/schema.ts` to `pgTable`, point `schema` here and run:
 *   DATABASE_URL=postgres://... npx drizzle-kit push --config drizzle.config.postgres.ts
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://padel:padel_dev_password@127.0.0.1:5432/padel_analyzer",
  },
});
