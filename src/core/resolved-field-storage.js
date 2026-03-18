export function normalizeFieldPath(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function normalizeFieldPathList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFieldPath(entry)).filter(Boolean);
  }

  const single = normalizeFieldPath(value);
  return single ? [single] : [];
}

export function normalizeSupportingFragmentIds(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [value])
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

export function buildResolvedFieldStorageShape(input = {}, resolvedTargetScope = null) {
  const target = resolvedTargetScope || input.resolvedTargetScope || null;
  const metadataInput = input.metadata ?? {};

  return {
    targetKind: target?.targetKind || String(input.targetKind || '').trim(),
    targetId: target?.targetId || String(input.targetId || '').trim(),
    sourceId: target?.sourceId || normalizeNullableText(input.sourceId),
    observationId: target?.observationId || normalizeNullableText(input.observationId),
    fieldPath: normalizeFieldPath(input.fieldPath),
    status: String(input.status || '').trim(),
    resolutionKind: String(input.resolutionKind || '').trim(),
    resolverVersion: String(input.resolverVersion || '').trim(),
    value: normalizeJsonStorageValue(input.value),
    confidence: normalizeNullableNumber(input.confidence),
    ambiguity: normalizeJsonStorageValue(input.ambiguity),
    supportingFragmentIds: normalizeSupportingFragmentIds(input.supportingFragmentIds),
    metadata: normalizeJsonStorageValue(metadataInput, {}),
  };
}

export function resolvedFieldRecordMatches(existing, input = {}, resolvedTargetScope = null) {
  if (!existing) {
    return false;
  }

  const normalizedExisting = buildResolvedFieldStorageShape(existing, {
    targetKind: existing.targetKind,
    targetId: existing.targetId,
    sourceId: existing.sourceId,
    observationId: existing.observationId,
  });
  const normalized = buildResolvedFieldStorageShape(input, resolvedTargetScope);

  return normalizedExisting.targetKind === normalized.targetKind
    && normalizedExisting.targetId === normalized.targetId
    && normalizedExisting.sourceId === normalized.sourceId
    && normalizedExisting.observationId === normalized.observationId
    && normalizedExisting.fieldPath === normalized.fieldPath
    && normalizedExisting.status === normalized.status
    && normalizedExisting.resolutionKind === normalized.resolutionKind
    && normalizedExisting.resolverVersion === normalized.resolverVersion
    && normalizedExisting.confidence === normalized.confidence
    && stableStringify(normalizedExisting.value) === stableStringify(normalized.value)
    && stableStringify(normalizedExisting.ambiguity) === stableStringify(normalized.ambiguity)
    && stableStringify(normalizedExisting.supportingFragmentIds) === stableStringify(normalized.supportingFragmentIds)
    && stableStringify(normalizedExisting.metadata) === stableStringify(normalized.metadata);
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
