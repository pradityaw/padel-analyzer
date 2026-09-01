-- Postgres translation of drizzle/0000–0004 for Ghost migration dry-run.
-- Source: padel-analyzer drizzle/*.sql (sqlite dialect)

-- 0000_steady_bulldozer.sql
CREATE TABLE analyses (
  id SERIAL PRIMARY KEY,
  video_file_name TEXT NOT NULL,
  thumbnail_path TEXT,
  created_at TEXT NOT NULL,
  overall_score DOUBLE PRECISION NOT NULL,
  dominant_side TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  frame_count INTEGER NOT NULL,
  sample_fps DOUBLE PRECISION NOT NULL,
  phases_json TEXT NOT NULL,
  landmarks_json TEXT NOT NULL,
  shot_type TEXT,
  shot_confidence DOUBLE PRECISION
);

CREATE TABLE annotations (
  id SERIAL PRIMARY KEY,
  analysis_id INTEGER NOT NULL,
  shot_type TEXT NOT NULL,
  is_pro_reference BOOLEAN DEFAULT false NOT NULL,
  annotated_at TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE pro_benchmarks (
  id SERIAL PRIMARY KEY,
  shot_type TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pro_comparisons (
  id SERIAL PRIMARY KEY,
  player_analysis_id INTEGER NOT NULL,
  pro_analysis_id INTEGER,
  shot_type TEXT NOT NULL,
  gap_analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notes TEXT
);

-- 0001_busy_mindworm.sql
ALTER TABLE analyses ADD COLUMN video_storage_key TEXT;
ALTER TABLE analyses ADD COLUMN skill_label TEXT;
ALTER TABLE analyses ADD COLUMN skill_confidence DOUBLE PRECISION;
ALTER TABLE analyses ADD COLUMN quality_score DOUBLE PRECISION;
ALTER TABLE annotations ADD COLUMN reference_tier TEXT DEFAULT 'none' NOT NULL;
ALTER TABLE annotations ADD COLUMN quality_band TEXT;
ALTER TABLE annotations ADD COLUMN source_type TEXT;
ALTER TABLE annotations ADD COLUMN source_url TEXT;

UPDATE annotations
SET
  reference_tier = CASE
    WHEN is_pro_reference = true THEN 'pro'
    ELSE 'none'
  END,
  quality_band = CASE
    WHEN is_pro_reference = true AND quality_band IS NULL THEN 'pro'
    ELSE quality_band
  END;

ALTER TABLE pro_comparisons ADD COLUMN reference_tier TEXT DEFAULT 'pro' NOT NULL;
ALTER TABLE pro_benchmarks ADD COLUMN reference_tier TEXT DEFAULT 'pro' NOT NULL;
CREATE UNIQUE INDEX pro_benchmarks_shot_type_reference_tier_unique
  ON pro_benchmarks (shot_type, reference_tier);

-- 0002_nappy_gauntlet.sql
CREATE TABLE analysis_jobs (
  id SERIAL PRIMARY KEY,
  video_file_name TEXT NOT NULL,
  video_storage_key TEXT NOT NULL,
  status TEXT DEFAULT 'queued' NOT NULL,
  progress INTEGER DEFAULT 0 NOT NULL,
  status_message TEXT,
  error_message TEXT,
  analysis_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 0003_analysis_quality_landmarks.sql
ALTER TABLE analyses ADD COLUMN pose_detection_rate DOUBLE PRECISION;
ALTER TABLE analyses ADD COLUMN quality_warning TEXT;
ALTER TABLE analyses ADD COLUMN landmarks_path TEXT;

-- 0004_court_corners.sql
ALTER TABLE analyses ADD COLUMN court_corners_json TEXT;
ALTER TABLE analyses ADD COLUMN mode TEXT DEFAULT 'match' NOT NULL;
ALTER TABLE analysis_jobs ADD COLUMN court_corners_json TEXT;
ALTER TABLE analysis_jobs ADD COLUMN mode TEXT DEFAULT 'match' NOT NULL;

-- Sanity: mirror drizzle journal version
CREATE TABLE IF NOT EXISTS drizzle_migrations (
  id SERIAL PRIMARY KEY,
  tag TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO drizzle_migrations (tag) VALUES
  ('0000_steady_bulldozer'),
  ('0001_busy_mindworm'),
  ('0002_nappy_gauntlet'),
  ('0003_analysis_quality_landmarks'),
  ('0004_court_corners');
