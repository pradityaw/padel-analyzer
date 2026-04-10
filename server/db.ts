import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "../drizzle/schema.js";
import { mkdirSync } from "fs";
import path from "path";

const dbPath = process.env.DB_PATH || path.join("data", "padel.db");
mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

const sqlite = new Database(path.resolve(dbPath));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
