import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatConfidence,
  formatCount,
  formatLabel,
  formatPrice,
  formatRelativeTime,
} from '../src/ui/dashboard/lib/formatters.js';

test('dashboard formatters humanize time and core listing values', () => {
  assert.equal(
    formatRelativeTime('2026-03-15T19:30:00.000Z', { now: '2026-03-15T20:00:00.000Z' }),
    '30 minutes ago',
  );
  assert.equal(
    formatRelativeTime('2026-03-15T20:00:20.000Z', { now: '2026-03-15T20:00:00.000Z' }),
    'in moments',
  );
  assert.equal(formatPrice(2400, { period: 'month' }), '$2,400/mo');
  assert.equal(formatConfidence(0.86), '86%');
  assert.equal(formatCount(2, 'ambiguity'), '2 ambiguities');
  assert.equal(formatLabel('low-confidence'), 'Low Confidence');
});
