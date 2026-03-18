export function buildResolvedFieldStorageShape(input = {}, resolvedTargetScope = null) {
  const target = resolvedTargetScope || input.resolvedTargetScope || null;
  const metadataInput = input.metadata ?? {};

  return {
    targetKind: target?.targetKind || String(input.targetKind || '').trim(),
    targetId: target?.targetId || String(input.targetId || '').trim(),
    sourceId: target?.sourceId || normalizeNullableText(input.sourceId),
    observationId: target?.observationId || normalizeNullableText(input.observationId),
    fieldPath: String(input.fieldPath || '').trim(),
    status: String(input.status || '').trim(),
    resolutionKind: String(input.resolutionKind || '').trim(),
    resolverVersion: String(input.resolverVersion || '').trim(),
    value: normalizeJsonStorageValue(input.value),
    confidence: normalizeNullableNumber(input.confidence),
    ambiguity: normalizeJsonStorageValue(input.ambiguity),
    supportingFragmentIds: normalizeStringList(input.supportingFragmentIds),
    metadata: normalizeJsonStorageValue(metadataInput, {}),
  };
}

export function resolvedFieldRecordMatches(existing, input = {}, resolvedTargetScope = null) {
  if (!existing) {
    return false;
  }

  const normalized = buildResolvedFieldStorageShape(input, resolvedTargetScope);

  return existing.targetKind === normalized.targetKind
    && existing.targetId === normalized.targetId
    && existing.sourceId === normalized.sourceId
    && existing.observationId === normalized.observationId
    && existing.fieldPath === normalized.fieldPath
    && existing.status === normalized.status
    && existing.resolutionKind === normalized.resolutionKind
    && existing.resolverVersion === normalized.resolverVersion
    && existing.confidence === normalized.confidence
    && stableStringify(existing.value) === stableStringify(normalized.value)
    && stableStringify(existing.ambiguity) === stableStringify(normalized.ambiguity)
    && stableStringify(existing.supportingFragmentIds) === stableStringify(normalized.supportingFragmentIds)
    && stableStringify(existing.metadata) === stableStringify(normalized.metadata);
}

function normalizeNullableText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  const single = String(value || '').trim();
  return single ? [single] : [];
}

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function toJson(value, fallback = null) {
  const normalized = value === undefined ? fallback : value;
  return normalized === null ? null : JSON.stringify(normalized);
}

function normalizeJsonStorageValue(value, fallback = null) {
  const json = toJson(value, fallback);
  return json === null ? fallback : parseJson(json, fallback);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }

  return JSON.parse(value);
}
