CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  stable_post_id TEXT REFERENCES stable_posts(id),
  status TEXT NOT NULL,
  processor_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by TEXT,
  lease_expires_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(observation_id, processor_version, schema_version, model_name),
  UNIQUE(dedupe_key)
);

CREATE TABLE IF NOT EXISTS processed_payloads (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES processing_jobs(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  stable_post_id TEXT REFERENCES stable_posts(id),
  processor_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  post_url TEXT NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_available
  ON processing_jobs (status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_source_status_available
  ON processing_jobs (source_id, status, available_at);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_observation_id
  ON processing_jobs (observation_id);

CREATE INDEX IF NOT EXISTS idx_processed_payloads_observation_id
  ON processed_payloads (observation_id);
