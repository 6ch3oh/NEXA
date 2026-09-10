'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { queryTokenRange } = require('../../src/shared/tokenRangeQuery');

const archive = { days: {
  '2026-08-01': { observations: { a: { tokens: 10, cost: 0.1, messages: 1 } } },
  '2026-09-04': { observations: { a: { tokens: 20, cost: 0.2, messages: 2 } } },
  '2026-09-05': { observations: { a: { tokens: 30, cost: 0.3, messages: 3 } } },
} };

test('today and rolling 24h remain distinct deterministic ranges', () => {
  const now = '2026-09-05T04:00:00.000Z';
  assert.equal(queryTokenRange({ dailyArchive: archive, range: 'today', now, timezone: 'Asia/Shanghai' }).tokens, 30);
  const rolling = queryTokenRange({ dailyArchive: archive, range: 'rolling24h', now, events: [
    { id: 'old', occurredAt: '2026-09-04T03:59:59.000Z', tokens: 99 },
    { id: 'inside', occurredAt: '2026-09-04T04:00:00.000Z', tokens: 7, cost: 0.07, messages: 1 },
  ] });
  assert.equal(rolling.tokens, 7); assert.equal(rolling.complete, true);
});

test('7d, 30d, 1y, all and custom expose truthful history boundary', () => {
  const common = { dailyArchive: archive, now: '2026-09-05T04:00:00Z', timezone: 'Asia/Shanghai' };
  assert.equal(queryTokenRange({ ...common, range: '7d' }).tokens, 50);
  assert.equal(queryTokenRange({ ...common, range: '30d' }).tokens, 50);
  assert.equal(queryTokenRange({ ...common, range: '1y' }).complete, false);
  assert.equal(queryTokenRange({ ...common, range: 'all' }).tokens, 60);
  assert.equal(queryTokenRange({ ...common, range: 'custom', startAt: '2026-09-04T00:00:00+08:00', endAt: '2026-09-05T23:59:59+08:00' }).tokens, 50);
});
