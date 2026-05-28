import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoFileName: text("video_file_name").notNull(),
  /** Filename under data/uploads (for /uploads/... playback). */
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
  shotType: text("shot_type"),
  shotConfidence: real("shot_confidence"),
  skillLabel: text("skill_label"),
  skillConfidence: real("skill_confidence"),
  qualityScore: real("quality_score"),
  poseDetectionRate: real("pose_detection_rate"),
  qualityWarning: text("quality_warning"),
  landmarksPath: text("landmarks_path"),
  /** JSON: CourtCornersNormalized from mobile capture overlay. */
  courtCornersJson: text("court_corners_json"),
  mode: text("mode", { enum: ["match", "rally", "serve_practice", "drill"] })
    .notNull()
    .default("match"),
});

export const analysisJobs = sqliteTable("analysis_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoFileName: text("video_file_name").notNull(),
  videoStorageKey: text("video_storage_key").notNull(),
  status: text("status").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  statusMessage: text("status_message"),
  errorMessage: text("error_message"),
  analysisId: integer("analysis_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  courtCornersJson: text("court_corners_json"),
  mode: text("mode", { enum: ["match", "rally", "serve_practice", "drill"] })
    .notNull()
    .default("match"),
});

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  analysisId: integer("analysis_id").notNull(),
  shotType: text("shot_type").notNull(),
  isProReference: integer("is_pro_reference", { mode: "boolean" })
    .notNull()
    .default(false),
  referenceTier: text("reference_tier").notNull().default("none"),
  qualityBand: text("quality_band"),
  sourceType: text("source_type"),
  sourceUrl: text("source_url"),
  annotatedAt: text("annotated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  notes: text("notes"),
});

export const proComparisons = sqliteTable("pro_comparisons", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerAnalysisId: integer("player_analysis_id").notNull(),
  proAnalysisId: integer("pro_analysis_id"),
  referenceTier: text("reference_tier").notNull().default("pro"),
  shotType: text("shot_type").notNull(),
  gapAnalysisJson: text("gap_analysis_json").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  notes: text("notes"),
});

export const proBenchmarks = sqliteTable(
  "pro_benchmarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    shotType: text("shot_type").notNull(),
    referenceTier: text("reference_tier").notNull().default("pro"),
    sampleCount: integer("sample_count").notNull(),
    metricsJson: text("metrics_json").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("pro_benchmarks_shot_type_reference_tier_unique").on(
      table.shotType,
      table.referenceTier
    ),
  ]
);

export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type NewAnalysisJob = typeof analysisJobs.$inferInsert;
export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type ProComparison = typeof proComparisons.$inferSelect;
export type ProBenchmark = typeof proBenchmarks.$inferSelect;
