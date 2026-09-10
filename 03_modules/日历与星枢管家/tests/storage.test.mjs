import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryTaskStore, createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import {
  REPOSITORY_METHODS,
  assertRepositoryContract,
  normalizeListOptions,
  matchesListFilters,
} from '../src/storage/contracts.mjs';
import { completeTask } from '../src/domain/task.mjs';

test('repository contract requires the five core methods', () => {
  for (const method of REPOSITORY_METHODS) {
    assert.ok(typeof createInMemoryTaskStore()[method] === 'function', method);
  }
  assert.throws(() => assertRepositoryContract({}, 'bad'), /missing required repository method/);
});

test('task store: create/getById/update/delete/list round trip', () => {
  const store = createInMemoryTaskStore();
  const a = store.create({ id: 't1', title: 'One', priority: 'high' });
  assert.equal(store.getById('t1').title, 'One');

  const updated = store.update('t1', { title: 'One updated' });
  assert.equal(updated.title, 'One updated');
  assert.equal(store.getById('t1').title, 'One updated');

  assert.equal(store.list().length, 1);
  assert.equal(store.delete('t1'), true);
  assert.equal(store.getById('t1'), null);
  assert.equal(store.list().length, 0);
});

test('task store: duplicate create and missing update are rejected', () => {
  const store = createInMemoryTaskStore();
  store.create({ id: 't1', title: 'One' });
  assert.throws(() => store.create({ id: 't1', title: 'Duplicate' }), /already exists/);
  assert.throws(() => store.update('missing', { title: 'x' }), /not found/);
});

test('task store: list filters by status, source and date range', () => {
  const store = createInMemoryTaskStore();
  store.create({ id: 't1', title: 'A', status: 'pending', start_at: '2026-08-10T09:00:00+08:00' });
  store.create({ id: 't2', title: 'B', status: 'completed', completed_at: '2026-08-10T10:00:00+08:00', start_at: '2026-08-11T09:00:00+08:00' });
  store.create({ id: 't3', title: 'C', source: 'notion', external_id: 'p1', status: 'pending', start_at: '2026-08-12T09:00:00+08:00' });

  assert.deepEqual(store.list({ status: 'pending' }).map((t) => t.id), ['t1', 't3']);
  assert.deepEqual(store.list({ source: 'notion' }).map((t) => t.id), ['t3']);
  assert.deepEqual(store.list({ start_at: '2026-08-11T00:00:00+08:00' }).map((t) => t.id), ['t2', 't3']);
  assert.deepEqual(store.list({ end_at: '2026-08-11T23:59:59+08:00' }).map((t) => t.id), ['t1', 't2']);
  assert.equal(store.list({ status: 'cancelled' }).length, 0);
});

test('task store: completed entity can be persisted and updated via repository', () => {
  const store = createInMemoryTaskStore();
  const created = store.create({ id: 't9', title: 'Finish' });
  const done = completeTask(created, { now: '2026-08-10T12:00:00+08:00' });
  store.update('t9', { status: done.status, completed_at: done.completed_at }, { now: done.updated_at });
  assert.equal(store.getById('t9').status, 'completed');
});

test('event store: create/getById/update/delete/list round trip', () => {
  const store = createInMemoryEventStore();
  store.create({ id: 'e1', title: 'Meet', start_at: '2026-08-10T10:00:00+08:00', end_at: '2026-08-10T11:00:00+08:00' });
  assert.equal(store.getById('e1').title, 'Meet');
  store.create({ id: 'e2', title: 'All day', start_at: '2026-08-15', end_at: '2026-08-15', all_day: true });

  const updated = store.update('e1', { location: 'Room C' });
  assert.equal(updated.location, 'Room C');

  assert.deepEqual(store.list({ start_at: '2026-08-15' }).map((e) => e.id), ['e2']);
  assert.equal(store.delete('e2'), true);
  assert.equal(store.getById('e2'), null);
  assert.equal(store.list().length, 1);
});

test('event store: rejects invalid events on create', () => {
  const store = createInMemoryEventStore();
  assert.throws(
    () => store.create({ id: 'eBad', title: 'Bad', start_at: '2026-08-10T11:00:00+08:00', end_at: '2026-08-10T10:00:00+08:00' }),
    /earlier than start/,
  );
});

test('list options normalization keeps only known filters', () => {
  assert.deepEqual(normalizeListOptions({ status: 'pending', source: 'local', start_at: '2026-08-01', bogus: 1 }), {
    start_at: '2026-08-01',
    end_at: null,
    status: 'pending',
    source: 'local',
  });
  assert.deepEqual(normalizeListOptions(), { start_at: null, end_at: null, status: null, source: null });
});

test('matchesListFilters applies date range on entity start_at', () => {
  const entity = { status: 'pending', source: 'local', start_at: '2026-08-10T09:00:00+08:00' };
  assert.equal(matchesListFilters(entity, { start_at: '2026-08-09' }), true);
  assert.equal(matchesListFilters(entity, { start_at: '2026-08-11' }), false);
  assert.equal(matchesListFilters(entity, { end_at: '2026-08-09' }), false);
  assert.equal(matchesListFilters(entity, { status: 'completed' }), false);
  assert.equal(matchesListFilters({ ...entity, start_at: null }, { start_at: '2026-08-01' }), false);
});
