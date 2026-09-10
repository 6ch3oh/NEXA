import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LEGACY_CACHE_SOURCE,
  LegacyCacheContractError,
  createLegacyCacheSnapshot,
} from '../src/adapters/notion/legacy-cache-contract.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-todo-legacy-cases.json', import.meta.url),
  'utf8',
));
const options = { observedAt: fixture.observed_at };

test('normal Legacy display cache becomes a read-only NEXA consumption snapshot', () => {
  const snapshot = createLegacyCacheSnapshot(fixture.snapshots.normal, options);
  assert.equal(snapshot.source, LEGACY_CACHE_SOURCE);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.refreshed_at, new Date(1786320000000).toISOString());
  assert.equal(snapshot.observed_at, fixture.observed_at);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.error, null);
  assert.ok(Object.isFrozen(snapshot));
});

test('failed refresh with retained items is normalized as stale cache', () => {
  const snapshot = createLegacyCacheSnapshot(fixture.snapshots.stale, options);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.items.length, 1);
  assert.equal(snapshot.error.code, 'STALE_CACHE');
  assert.equal(snapshot.error.cause_code, 'NETWORK_FAILED');
  assert.equal(snapshot.counts.later, 1);
});

test('cache miss remains distinct from an empty authentication failure', () => {
  const miss = createLegacyCacheSnapshot(null, options);
  const error = createLegacyCacheSnapshot(fixture.snapshots.error, options);
  assert.equal(miss.items.length, 0);
  assert.equal(miss.error.code, 'CACHE_MISS');
  assert.equal(miss.refreshed_at, null);
  assert.equal(error.stale, false);
  assert.equal(error.error.code, 'AUTH_FAILED');
});

test('malformed cache items and implicit observation clocks fail closed', () => {
  assert.throws(
    () => createLegacyCacheSnapshot(fixture.snapshots.malformed, options),
    LegacyCacheContractError,
  );
  assert.throws(
    () => createLegacyCacheSnapshot(fixture.snapshots.normal),
    /observedAt/,
  );
  assert.throws(
    () => createLegacyCacheSnapshot({ ...fixture.snapshots.normal, updatedAt: 'yesterday' }, options),
    /updatedAt/,
  );
});
