DELETE FROM evidence_fragments
WHERE LENGTH(TRIM(field_path)) = 0;

UPDATE evidence_fragments
SET field_path = TRIM(field_path)
WHERE field_path <> TRIM(field_path);

DELETE FROM resolved_fields
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY target_kind, target_id, TRIM(field_path)
        ORDER BY updated_at DESC, created_at DESC, id DESC
      ) AS row_number
    FROM resolved_fields
    WHERE LENGTH(TRIM(field_path)) > 0
  )
  WHERE row_number > 1
);

DELETE FROM resolved_fields
WHERE LENGTH(TRIM(field_path)) = 0;

UPDATE resolved_fields
SET field_path = TRIM(field_path)
WHERE field_path <> TRIM(field_path);

DELETE FROM manual_overrides
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY target_kind, target_id, TRIM(field_path)
        ORDER BY updated_at DESC, created_at DESC, id DESC
      ) AS row_number
    FROM manual_overrides
    WHERE LENGTH(TRIM(field_path)) > 0
  )
  WHERE row_number > 1
);

DELETE FROM manual_overrides
WHERE LENGTH(TRIM(field_path)) = 0;

UPDATE manual_overrides
SET field_path = TRIM(field_path)
WHERE field_path <> TRIM(field_path);

CREATE TRIGGER IF NOT EXISTS trg_evidence_fragments_field_path_guard_insert
BEFORE INSERT ON evidence_fragments
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'evidence_fragments.field_path must be trimmed and non-empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_evidence_fragments_field_path_guard_update
BEFORE UPDATE OF field_path ON evidence_fragments
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'evidence_fragments.field_path must be trimmed and non-empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_resolved_fields_field_path_guard_insert
BEFORE INSERT ON resolved_fields
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'resolved_fields.field_path must be trimmed and non-empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_resolved_fields_field_path_guard_update
BEFORE UPDATE OF field_path ON resolved_fields
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'resolved_fields.field_path must be trimmed and non-empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_manual_overrides_field_path_guard_insert
BEFORE INSERT ON manual_overrides
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'manual_overrides.field_path must be trimmed and non-empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_manual_overrides_field_path_guard_update
BEFORE UPDATE OF field_path ON manual_overrides
FOR EACH ROW
WHEN LENGTH(TRIM(COALESCE(NEW.field_path, ''))) = 0 OR NEW.field_path <> TRIM(NEW.field_path)
BEGIN
  SELECT RAISE(ABORT, 'manual_overrides.field_path must be trimmed and non-empty');
END;
