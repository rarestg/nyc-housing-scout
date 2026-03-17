CREATE TABLE IF NOT EXISTS evidence_fragments (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  stable_post_id TEXT REFERENCES stable_posts(id),
  run_id TEXT NOT NULL REFERENCES crawl_runs(id),
  fragment_kind TEXT NOT NULL,
  field_path TEXT NOT NULL,
  source_surface TEXT NOT NULL,
  source_ref TEXT,
  producer_kind TEXT NOT NULL,
  producer_version TEXT NOT NULL,
  raw_text TEXT,
  normalized_json TEXT,
  confidence REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resolved_fields (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  field_path TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution_kind TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  value_json TEXT,
  confidence REAL,
  ambiguity_json TEXT,
  supporting_fragment_ids_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_kind, target_id, field_path)
);

CREATE TABLE IF NOT EXISTS manual_overrides (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  field_path TEXT NOT NULL,
  value_json TEXT,
  reason TEXT,
  operator_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cleared_at TEXT,
  UNIQUE(target_kind, target_id, field_path)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  observation_id TEXT NOT NULL REFERENCES post_observations(id),
  event_kind TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_fragments_observation_field
  ON evidence_fragments (observation_id, field_path, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_fragments_run_id
  ON evidence_fragments (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_fragments_stable_post_id
  ON evidence_fragments (stable_post_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_fragments_source_field
  ON evidence_fragments (source_id, field_path, created_at);

CREATE INDEX IF NOT EXISTS idx_resolved_fields_observation_status
  ON resolved_fields (observation_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_resolved_fields_source_field
  ON resolved_fields (source_id, field_path, updated_at);

CREATE INDEX IF NOT EXISTS idx_manual_overrides_observation_status
  ON manual_overrides (observation_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_manual_overrides_source_field
  ON manual_overrides (source_id, field_path, updated_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_target_created_at
  ON audit_events (target_kind, target_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_observation_created_at
  ON audit_events (observation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_source_event_created_at
  ON audit_events (source_id, event_kind, created_at);
