import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.PADEL_DATA_DIR
      ? `${process.env.PADEL_DATA_DIR}/padel.db`
      : "./data/padel.db",
  },
});
