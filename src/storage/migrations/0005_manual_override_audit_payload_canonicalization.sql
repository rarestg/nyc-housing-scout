CREATE TEMP TABLE temp_manual_override_audit_repairs AS
SELECT
  ae.id AS audit_event_id,
  mo.id AS manual_override_id,
  mo.field_path AS field_path
FROM audit_events ae
JOIN manual_overrides mo
  ON mo.target_kind = ae.target_kind
 AND mo.target_id = ae.target_id
 AND mo.field_path = TRIM(COALESCE(json_extract(ae.payload_json, '$.fieldPath'), ''))
WHERE ae.event_kind IN ('manual_override_set', 'manual_override_updated', 'manual_override_cleared')
  AND LENGTH(TRIM(COALESCE(json_extract(ae.payload_json, '$.fieldPath'), ''))) > 0;

UPDATE audit_events
SET payload_json = json_set(
  payload_json,
  '$.fieldPath', (SELECT field_path FROM temp_manual_override_audit_repairs WHERE audit_event_id = audit_events.id),
  '$.manualOverrideId', (SELECT manual_override_id FROM temp_manual_override_audit_repairs WHERE audit_event_id = audit_events.id)
)
WHERE id IN (SELECT audit_event_id FROM temp_manual_override_audit_repairs);

UPDATE audit_events
SET payload_json = json_set(
  payload_json,
  '$.previous.id', (SELECT manual_override_id FROM temp_manual_override_audit_repairs WHERE audit_event_id = audit_events.id)
)
WHERE id IN (SELECT audit_event_id FROM temp_manual_override_audit_repairs)
  AND json_type(payload_json, '$.previous') = 'object';

UPDATE audit_events
SET payload_json = json_set(
  payload_json,
  '$.next.id', (SELECT manual_override_id FROM temp_manual_override_audit_repairs WHERE audit_event_id = audit_events.id)
)
WHERE id IN (SELECT audit_event_id FROM temp_manual_override_audit_repairs)
  AND json_type(payload_json, '$.next') = 'object';

DROP TABLE temp_manual_override_audit_repairs;
