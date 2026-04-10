import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoFileName: text("video_file_name").notNull(),
  /** Filename under data/uploads (for /uploads/... playback). Null on legacy rows. */
  videoStorageKey: text("video_storage_key"),
  thumbnailPath: text("thumbnail_path"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  overallScore: real("overall_score").notNull(),
  dominantSide: text("dominant_side", { enum: ["left", "right"] }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  frameCount: integer("frame_count").notNull(),
  sampleFps: real("sample_fps").notNull(),
  phasesJson: text("phases_json").notNull(),
  landmarksJson: text("landmarks_json").notNull(),
  /** Path to landmarks JSON file on disk (data/landmarks/<id>.json). Null on legacy rows. */
  landmarksPath: text("landmarks_path"),
  shotType: text("shot_type"),
  shotConfidence: real("shot_confidence"),
  processingState: text("processing_state", {
    enum: ["pending", "processing", "complete", "failed"],
  })
    .notNull()
    .default("complete"),
  qualityWarnings: text("quality_warnings"),
}, (table) => [
  index("idx_analyses_created_at").on(table.createdAt),
  index("idx_analyses_processing_state").on(table.processingState),
]);

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisId: integer("analysis_id").notNull(),
  shotType: text("shot_type").notNull(),
  isProReference: integer("is_pro_reference", { mode: "boolean" })
    .notNull()
    .default(false),
  annotatedAt: text("annotated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  notes: text("notes"),
}, (table) => [
  index("idx_annotations_analysis_id").on(table.analysisId),
]);

export const proComparisons = sqliteTable("pro_comparisons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerAnalysisId: integer("player_analysis_id").notNull(),
  proAnalysisId: integer("pro_analysis_id"),
  shotType: text("shot_type").notNull(),
  gapAnalysisJson: text("gap_analysis_json").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  notes: text("notes"),
}, (table) => [
  index("idx_pro_comparisons_player_id").on(table.playerAnalysisId),
]);

export const proBenchmarks = sqliteTable("pro_benchmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  shotType: text("shot_type").notNull().unique(),
  sampleCount: integer("sample_count").notNull(),
  metricsJson: text("metrics_json").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  index("idx_sessions_user_id").on(table.userId),
]);

export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type ProComparison = typeof proComparisons.$inferSelect;
export type ProBenchmark = typeof proBenchmarks.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
