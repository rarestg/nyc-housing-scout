CREATE TABLE IF NOT EXISTS storage_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_type TEXT NOT NULL,
  display_name TEXT,
  external_url TEXT,
  browser_profile TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, source_key)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  run_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  capture_limit INTEGER,
  target_fresh INTEGER,
  max_scrolls INTEGER,
  browser_profile TEXT,
  capture_method TEXT,
  summary_json TEXT,
  collected_export_path TEXT,
  listings_export_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stable_posts (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  platform_post_id TEXT NOT NULL,
  canonical_post_url TEXT,
  first_seen_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  first_seen_at TEXT NOT NULL,
  last_seen_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  last_seen_at TEXT NOT NULL,
  times_seen INTEGER NOT NULL,
  latest_observation_id TEXT,
  UNIQUE(source_id, platform_post_id)
);

CREATE TABLE IF NOT EXISTS post_observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  step_index INTEGER,
  source_id TEXT NOT NULL REFERENCES sources(id),
  stable_post_id TEXT REFERENCES stable_posts(id),
  platform_post_id TEXT,
  provisional_dedupe_key TEXT,
  freshness TEXT NOT NULL,
  identity_confidence TEXT NOT NULL,
  source_key TEXT,
  group_name TEXT,
  post_url TEXT,
  author_name TEXT,
  posted_at_text TEXT,
  body_text TEXT NOT NULL,
  comments_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT NOT NULL DEFAULT '[]',
  capture_method TEXT,
  capture_run_id TEXT,
  captured_at TEXT NOT NULL,
  raw_artifact_path TEXT,
  raw_artifact_id TEXT,
  derived_location_json TEXT,
  capture_hints_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_refs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT,
  artifact_kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS listing_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  ordinal INTEGER NOT NULL,
  listing_type TEXT NOT NULL,
  post_intent TEXT,
  borough TEXT,
  neighborhood TEXT,
  price_amount REAL,
  price_period TEXT,
  confidence_overall REAL NOT NULL DEFAULT 0,
  extractor_version TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  step_index INTEGER,
  expanded_count INTEGER,
  visible_posts INTEGER,
  added_count INTEGER,
  fresh_count INTEGER,
  seen_count INTEGER,
  unidentified_count INTEGER,
  fresh_collected INTEGER,
  seen_collected INTEGER,
  unidentified_collected INTEGER,
  scroll_y INTEGER,
  body_height INTEGER,
  page_href TEXT,
  page_title TEXT,
  stopped_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_crawl_runs_source_started_at
  ON crawl_runs (source_id, started_at);

CREATE INDEX IF NOT EXISTS idx_stable_posts_source_post_id
  ON stable_posts (source_id, platform_post_id);

CREATE INDEX IF NOT EXISTS idx_post_observations_run_id
  ON post_observations (run_id);

CREATE INDEX IF NOT EXISTS idx_post_observations_source_post_id
  ON post_observations (source_id, platform_post_id);

CREATE INDEX IF NOT EXISTS idx_post_observations_stable_post_id
  ON post_observations (stable_post_id);

CREATE INDEX IF NOT EXISTS idx_artifact_refs_run_id
  ON artifact_refs (run_id);

CREATE INDEX IF NOT EXISTS idx_artifact_refs_observation_id
  ON artifact_refs (observation_id);

CREATE INDEX IF NOT EXISTS idx_listing_records_run_id
  ON listing_records (run_id);

CREATE INDEX IF NOT EXISTS idx_listing_records_observation_id
  ON listing_records (observation_id);

CREATE INDEX IF NOT EXISTS idx_crawl_run_steps_run_step
  ON crawl_run_steps (run_id, step_index);
