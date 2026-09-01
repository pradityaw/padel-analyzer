import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "../drizzle/schema.js";
import { mkdirSync } from "fs";
import { getDataRoot, getDbFilePath } from "./lib/paths.js";

mkdirSync(getDataRoot(), { recursive: true });

export const sqlite = new Database(getDbFilePath());
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
