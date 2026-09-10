import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryTaskStore, createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const CREATED = '2026-08-10T08:00:00+08:00';

function task(id, overrides = {}) {
  return {
    id, title: `Task ${id}`, description: '', status: 'pending', priority: 'normal',
    start_at: null, due_at: null, completed_at: null, timezone: 'Asia/Shanghai',
    source: 'local', external_id: null, dependencies: [], time_state: 'unscheduled',
    created_at: CREATED, updated_at: CREATED, ...overrides,
  };
}

function event(id, overrides = {}) {
  return {
    id, title: `Event ${id}`, description: '',
    start_at: '2026-08-10T10:00:00+08:00', end_at: '2026-08-10T11:00:00+08:00',
    all_day: false, timezone: 'Asia/Shanghai', location: '', status: 'confirmed',
    source: 'local', external_id: null, created_at: CREATED, updated_at: CREATED, ...overrides,
  };
}

function withoutUpdateTime(entity) {
  const { updated_at, ...business } = entity;
  return business;
}

function ids(rows) {
  return rows.map((row) => row.id);
}

test('InMemory and SQLite Task repositories have business-result parity', () => {
  const sqlite = openSQLiteStore();
  const repositories = [createInMemoryTaskStore(), sqlite.taskRepository];
  try {
    const results = repositories.map((repository) => {
      repository.create(task('dependency'));
      repository.create(task('main', {
        due_at: '2026-08-12', time_state: 'date_only', dependencies: ['dependency'],
        source: 'notion', external_id: 'notion_main',
      }));
      repository.create(task('future', {
        start_at: '2026-08-20T09:00:00+08:00', due_at: '2026-08-20T18:00:00+08:00',
        time_state: 'exact', status: 'in_progress',
      }));
      const created = repository.getById('main');
      const updated = repository.update('main', { title: 'Updated', priority: 'high', dependencies: ['dependency'] });
      const range = ids(repository.list({ start_at: '2026-08-12', end_at: '2026-08-12' }));
      const source = ids(repository.list({ source: 'notion' }));
      const status = ids(repository.list({ status: 'in_progress' }));
      repository.delete('dependency');
      const missingReference = repository.getById('main').dependencies;
      const deleted = repository.delete('main');
      return {
        created: withoutUpdateTime(created),
        updated: withoutUpdateTime(updated),
        range, source, status, missingReference, deleted,
        afterDelete: repository.getById('main'),
      };
    });
    assert.deepEqual(results[1], results[0]);
  } finally {
    sqlite.close();
  }
});

test('InMemory and SQLite Event repositories have business-result parity', () => {
  const sqlite = openSQLiteStore();
  const repositories = [createInMemoryEventStore(), sqlite.eventRepository];
  try {
    const results = repositories.map((repository) => {
      repository.create(event('overnight', {
        start_at: '2026-08-10T23:00:00+08:00', end_at: '2026-08-11T01:00:00+08:00',
        source: 'notion', external_id: 'external_overnight',
      }));
      repository.create(event('all_day', {
        start_at: '2026-08-12', end_at: '2026-08-12', all_day: true,
      }));
      const created = repository.getById('overnight');
      const updated = repository.update('overnight', { location: 'Room B', status: 'tentative' });
      const overlap = ids(repository.list({ start_at: '2026-08-11', end_at: '2026-08-11' }));
      const source = ids(repository.list({ source: 'notion' }));
      const deleted = repository.delete('overnight');
      return {
        created: withoutUpdateTime(created),
        updated: withoutUpdateTime(updated),
        overlap, source, deleted,
        afterDelete: repository.getById('overnight'),
      };
    });
    assert.deepEqual(results[1], results[0]);
  } finally {
    sqlite.close();
  }
});
