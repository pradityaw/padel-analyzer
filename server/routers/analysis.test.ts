import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema.js";

// Set up in-memory test database before importing routers
import { mkdirSync } from "fs";
mkdirSync("data/landmarks", { recursive: true });

// We need to monkey-patch the db module before importing routers
// Use a temp file DB so drizzle-kit schema works
const testDb = new Database(":memory:");
testDb.pragma("journal_mode = WAL");

// Create tables manually from schema
testDb.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_file_name TEXT NOT NULL,
    video_storage_key TEXT,
    thumbnail_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    overall_score REAL NOT NULL,
    dominant_side TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    frame_count INTEGER NOT NULL,
    sample_fps REAL NOT NULL,
    phases_json TEXT NOT NULL,
    landmarks_json TEXT NOT NULL,
    landmarks_path TEXT,
    shot_type TEXT,
    shot_confidence REAL,
    processing_state TEXT NOT NULL DEFAULT 'complete',
    quality_warnings TEXT
  );
  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_id INTEGER NOT NULL,
    shot_type TEXT NOT NULL,
    is_pro_reference INTEGER NOT NULL DEFAULT 0,
    annotated_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS pro_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_analysis_id INTEGER NOT NULL,
    pro_analysis_id INTEGER,
    shot_type TEXT NOT NULL,
    gap_analysis_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS pro_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shot_type TEXT NOT NULL UNIQUE,
    sample_count INTEGER NOT NULL,
    metrics_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mock the db module
import { vi } from "vitest";
vi.mock("../db.js", () => ({
  db: drizzle(testDb, { schema }),
}));

// Now import the router (after mocking)
const { appRouter } = await import("./index.js");
const caller = appRouter.createCaller({});

describe("analysis router", () => {
  let createdId: number;

  it("createPending creates a pending analysis", async () => {
    const result = await caller.analysis.createPending({
      videoFileName: "test-video.mp4",
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.videoFileName).toBe("test-video.mp4");
    expect(result.processingState).toBe("pending");
    createdId = result.id;
  });

  it("updateState transitions processing state", async () => {
    const result = await caller.analysis.updateState({
      id: createdId,
      processingState: "processing",
    });
    expect(result.success).toBe(true);
  });

  it("updateResults fills in analysis data", async () => {
    const result = await caller.analysis.updateResults({
      id: createdId,
      overallScore: 75,
      dominantSide: "right",
      durationMs: 3000,
      frameCount: 45,
      sampleFps: 15,
      phasesJson: JSON.stringify([]),
      landmarksJson: JSON.stringify([]),
      processingState: "complete",
    });
    expect(result).toBeDefined();
    expect(result!.overallScore).toBe(75);
    expect(result!.processingState).toBe("complete");
  });

  it("getById retrieves the analysis", async () => {
    const result = await caller.analysis.getById({ id: createdId });
    expect(result).toBeDefined();
    expect(result!.id).toBe(createdId);
    expect(result!.overallScore).toBe(75);
  });

  it("list returns paginated results", async () => {
    const result = await caller.analysis.list({ limit: 10, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("getById returns null for nonexistent id", async () => {
    const result = await caller.analysis.getById({ id: 999999 });
    expect(result).toBeNull();
  });

  it("delete removes an analysis", async () => {
    const result = await caller.analysis.delete({ id: createdId });
    expect(result.success).toBe(true);
    const check = await caller.analysis.getById({ id: createdId });
    expect(check).toBeNull();
  });
});
