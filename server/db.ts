import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "../drizzle/schema.js";
import { mkdirSync } from "fs";
import path from "path";

const dbDir = path.resolve("data");
mkdirSync(dbDir, { recursive: true });

const sqlite = new Database(path.join(dbDir, "padel.db"));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
