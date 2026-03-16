import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuthorName } from '../src/core/post-cleaning.js';

test('normalizeAuthorName preserves human names that happen to contain iso', () => {
  assert.equal(normalizeAuthorName('Alison Jolimet Fages', ''), 'Alison Jolimet Fages');
});

test('normalizeAuthorName still drops listing-like ISO labels', () => {
  assert.equal(normalizeAuthorName('ISO Room In Williamsburg', ''), null);
});
