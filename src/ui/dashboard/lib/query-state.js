export function readQueryState(input, schema) {
  const searchParams = toSearchParams(input);
  const state = {};

  for (const [key, rule] of Object.entries(schema)) {
    state[key] = parseQueryValue(searchParams.get(key), rule);
  }

  return state;
}

export function writeQueryState(state, schema, baseInput = '') {
  const nextSearchParams = toSearchParams(baseInput);

  for (const [key, rule] of Object.entries(schema)) {
    nextSearchParams.delete(key);

    const serializedValue = serializeQueryValue(state[key], rule);

    if (serializedValue !== null) {
      nextSearchParams.set(key, serializedValue);
    }
  }

  return nextSearchParams;
}

export function patchQueryState(input, patch, schema) {
  const currentState = readQueryState(input, schema);
  const nextState = typeof patch === 'function'
    ? patch(currentState)
    : { ...currentState, ...patch };

  return writeQueryState(nextState, schema, input);
}

function parseQueryValue(rawValue, rule = {}) {
  const normalizedRule = normalizeRule(rule);

  if (rawValue === null || rawValue === '') {
    return normalizedRule.defaultValue;
  }

  switch (normalizedRule.type) {
    case 'number': {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : normalizedRule.defaultValue;
    }
    case 'boolean':
      if (['1', 'true', 'yes', 'on'].includes(rawValue)) {
        return true;
      }

      if (['0', 'false', 'no', 'off'].includes(rawValue)) {
        return false;
      }

      return normalizedRule.defaultValue;
    default:
      return rawValue;
  }
}

function serializeQueryValue(value, rule = {}) {
  const normalizedRule = normalizeRule(rule);

  if (
    value === normalizedRule.defaultValue
    || value === ''
    || value === null
    || value === undefined
  ) {
    return null;
  }

  switch (normalizedRule.type) {
    case 'number':
      return Number.isFinite(Number(value)) ? String(value) : null;
    case 'boolean':
      return value ? '1' : '0';
    default:
      return String(value);
  }
}

function normalizeRule(rule = {}) {
  return {
    defaultValue: Object.hasOwn(rule, 'defaultValue')
      ? rule.defaultValue
      : '',
    type: rule.type || 'string',
  };
}

function toSearchParams(input) {
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input);
  }

  if (typeof input === 'string') {
    return new URLSearchParams(input);
  }

  if (input && typeof input === 'object' && 'toString' in input) {
    return new URLSearchParams(String(input));
  }

  return new URLSearchParams();
}
