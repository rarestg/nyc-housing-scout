import assert from 'node:assert/strict';
import test from 'node:test';
import {
  patchQueryState,
  readQueryState,
  writeQueryState,
} from '../src/ui/dashboard/lib/query-state.js';

const TEST_SCHEMA = {
  detail: { defaultValue: 'open' },
  hasAmbiguities: { defaultValue: false, type: 'boolean' },
  priceMax: { defaultValue: null, type: 'number' },
  q: { defaultValue: '' },
};

test('dashboard query state parses and serializes stable URL filters', () => {
  const parsedState = readQueryState(
    'q=astoria&priceMax=2800&hasAmbiguities=1&detail=closed',
    TEST_SCHEMA,
  );

  assert.deepEqual(parsedState, {
    detail: 'closed',
    hasAmbiguities: true,
    priceMax: 2800,
    q: 'astoria',
  });

  assert.equal(
    writeQueryState({
      detail: 'open',
      hasAmbiguities: true,
      priceMax: 2800,
      q: 'astoria',
    }, TEST_SCHEMA).toString(),
    'hasAmbiguities=1&priceMax=2800&q=astoria',
  );

  assert.equal(
    patchQueryState(
      'page=2&q=astoria&detail=closed',
      { hasAmbiguities: true },
      TEST_SCHEMA,
    ).toString(),
    'page=2&detail=closed&hasAmbiguities=1&q=astoria',
  );
});
