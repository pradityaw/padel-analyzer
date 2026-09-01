/**
 * Idempotent boot-time schema for SQLite volumes.
 *
 * Fly's padel_data volume has historically been empty (`no such table: analyses`).
 * drizzle-kit push is a manual operator step; this module creates missing tables
 * and columns so the API can start on a fresh disk.
 */
import { eq, isNull } from "drizzle-orm";
import { sqlite, db } from "../db.js";
import { users, analyses, analysisJobs, annotations, proComparisons } from "../../drizzle/schema.js";
import { logger } from "./logger.js";

function execIgnore(sql: string): void {
  try {
    sqlite.exec(sql);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate column name|already exists/i.test(message)) return;
    throw err;
  }
}

function createCoreTables(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER,
      video_file_name TEXT NOT NULL,
      video_storage_key TEXT,
      thumbnail_path TEXT,
      created_at TEXT NOT NULL,
      overall_score REAL NOT NULL,
      dominant_side TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      frame_count INTEGER NOT NULL,
      sample_fps REAL NOT NULL,
      phases_json TEXT NOT NULL,
      landmarks_json TEXT NOT NULL,
      shot_type TEXT,
      shot_confidence REAL,
      skill_label TEXT,
      skill_confidence REAL,
      quality_score REAL,
      pose_detection_rate REAL,
      quality_warning TEXT,
      landmarks_path TEXT,
      court_corners_json TEXT,
      mode TEXT NOT NULL DEFAULT 'match'
    );
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER,
      video_file_name TEXT NOT NULL,
      video_storage_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      status_message TEXT,
      error_message TEXT,
      analysis_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      court_corners_json TEXT,
      mode TEXT NOT NULL DEFAULT 'match'
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER,
      analysis_id INTEGER NOT NULL,
      shot_type TEXT NOT NULL,
      is_pro_reference INTEGER NOT NULL DEFAULT 0,
      reference_tier TEXT NOT NULL DEFAULT 'none',
      quality_band TEXT,
      source_type TEXT,
      source_url TEXT,
      annotated_at TEXT NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS pro_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER,
      player_analysis_id INTEGER NOT NULL,
      pro_analysis_id INTEGER,
      reference_tier TEXT NOT NULL DEFAULT 'pro',
      shot_type TEXT NOT NULL,
      gap_analysis_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS pro_benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      shot_type TEXT NOT NULL,
      reference_tier TEXT NOT NULL DEFAULT 'pro',
      sample_count INTEGER NOT NULL,
      metrics_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS magic_link_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id INTEGER,
      analysis_id INTEGER,
      rating INTEGER NOT NULL,
      comment TEXT,
      tag TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

const OPTIONAL_COLUMNS: Array<[string, string]> = [
  ["analyses", "user_id INTEGER"],
  ["analyses", "video_storage_key TEXT"],
  ["analyses", "skill_label TEXT"],
  ["analyses", "skill_confidence REAL"],
  ["analyses", "quality_score REAL"],
  ["analyses", "pose_detection_rate REAL"],
  ["analyses", "quality_warning TEXT"],
  ["analyses", "landmarks_path TEXT"],
  ["analyses", "court_corners_json TEXT"],
  ["analyses", "mode TEXT NOT NULL DEFAULT 'match'"],
  ["analysis_jobs", "user_id INTEGER"],
  ["analysis_jobs", "court_corners_json TEXT"],
  ["analysis_jobs", "mode TEXT NOT NULL DEFAULT 'match'"],
  ["annotations", "user_id INTEGER"],
  ["annotations", "reference_tier TEXT NOT NULL DEFAULT 'none'"],
  ["annotations", "quality_band TEXT"],
  ["annotations", "source_type TEXT"],
  ["annotations", "source_url TEXT"],
  ["pro_comparisons", "user_id INTEGER"],
  ["pro_comparisons", "reference_tier TEXT NOT NULL DEFAULT 'pro'"],
  ["pro_benchmarks", "reference_tier TEXT NOT NULL DEFAULT 'pro'"],
];

export function seedAdminUser(): { id: number; email: string } {
  const email = (process.env.AUTH_ADMIN_EMAIL ?? "operator@localhost")
    .trim()
    .toLowerCase();
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return { id: existing.id, email: existing.email };
  const inserted = db
    .insert(users)
    .values({ email, createdAt: new Date().toISOString() })
    .returning()
    .get();
  if (!inserted) throw new Error("Failed to seed admin user");
  return { id: inserted.id, email: inserted.email };
}

function backfillOwner(adminId: number): void {
  db.update(analyses).set({ userId: adminId }).where(isNull(analyses.userId)).run();
  db.update(analysisJobs).set({ userId: adminId }).where(isNull(analysisJobs.userId)).run();
  db.update(annotations).set({ userId: adminId }).where(isNull(annotations.userId)).run();
  db.update(proComparisons).set({ userId: adminId }).where(isNull(proComparisons.userId)).run();
}

export function ensureSchema(): void {
  createCoreTables();
  for (const [table, columnDef] of OPTIONAL_COLUMNS) {
    const col = columnDef.split(/\s+/)[0];
    execIgnore(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    logger.debug({ table, col }, "ensureSchema column");
  }
  const admin = seedAdminUser();
  backfillOwner(admin.id);
  logger.info({ adminEmail: admin.email, adminId: admin.id }, "schema ready");
}
