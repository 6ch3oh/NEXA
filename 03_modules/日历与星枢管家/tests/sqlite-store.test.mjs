import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  SQLITE_SCHEMA_VERSION,
  UnsupportedSchemaVersionError,
  initializeSchema,
  getSchemaVersion,
} from '../src/storage/sqlite-schema.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';
import { assertRepositoryContract } from '../src/storage/contracts.mjs';
import { TaskService } from '../src/services/task-service.mjs';
import { CalendarService } from '../src/services/calendar-service.mjs';
import { ScheduleQueryService } from '../src/services/schedule-query-service.mjs';

const CREATED = '2026-08-10T08:00:00+08:00';

function task(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'pending',
    priority: 'normal',
    start_at: null,
    due_at: null,
    completed_at: null,
    timezone: 'Asia/Shanghai',
    source: 'local',
    external_id: null,
    dependencies: [],
    time_state: 'unscheduled',
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

function event(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    description: '',
    start_at: '2026-08-10T10:00:00+08:00',
    end_at: '2026-08-10T11:00:00+08:00',
    all_day: false,
    timezone: 'Asia/Shanghai',
    location: '',
    status: 'confirmed',
    source: 'local',
    external_id: null,
    created_at: CREATED,
    updated_at: CREATED,
    ...overrides,
  };
}

test('SQLite schema fresh init is version 1, repeatable, and contains required columns', () => {
  const database = new DatabaseSync(':memory:');
  try {
    assert.equal(getSchemaVersion(database), 0);
    assert.equal(initializeSchema(database), SQLITE_SCHEMA_VERSION);
    database.prepare('INSERT INTO tasks (id,title,description,status,priority,source,time_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run('kept', 'Kept', '', 'pending', 'normal', 'local', 'unscheduled', CREATED, CREATED);
    assert.equal(initializeSchema(database), SQLITE_SCHEMA_VERSION);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
    const taskColumns = database.prepare('PRAGMA table_info(tasks)').all().map((row) => row.name);
    const dependencyColumns = database.prepare('PRAGMA table_info(task_dependencies)').all().map((row) => row.name);
    const eventColumns = database.prepare('PRAGMA table_info(calendar_events)').all().map((row) => row.name);
    for (const column of ['id', 'title', 'status', 'priority', 'start_at', 'due_at', 'completed_at', 'timezone', 'source', 'external_id', 'time_state', 'created_at', 'updated_at']) {
      assert.ok(taskColumns.includes(column), column);
    }
    assert.ok(dependencyColumns.includes('task_id'));
    assert.ok(dependencyColumns.includes('blocked_by_task_id'));
    for (const column of ['id', 'title', 'start_at', 'end_at', 'all_day', 'timezone', 'location', 'status', 'source', 'external_id', 'created_at', 'updated_at']) {
      assert.ok(eventColumns.includes(column), column);
    }
  } finally {
    database.close();
  }
});

test('unknown higher schema version fails closed without destructive reset', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA user_version = 99');
    assert.throws(() => initializeSchema(database), UnsupportedSchemaVersionError);
    assert.equal(getSchemaVersion(database), 99);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").all();
    assert.equal(tables.length, 0);
  } finally {
    database.close();
  }
});

test('SQLite Task repository CRUD round-trips dependencies, external id, and temporal state', () => {
  const store = openSQLiteStore();
  try {
    assertRepositoryContract(store.taskRepository);
    store.taskRepository.create(task('dep_a'));
    store.taskRepository.create(task('dep_b'));
    const created = store.taskRepository.create(task('main', {
      priority: 'high',
      due_at: '2026-08-12',
      source: 'notion',
      external_id: 'notion_task_1',
      dependencies: ['dep_a', 'dep_b'],
      time_state: 'date_only',
    }));
    assert.deepEqual(created.dependencies, ['dep_a', 'dep_b']);
    assert.equal(created.external_id, 'notion_task_1');
    assert.equal(created.time_state, 'date_only');

    const updated = store.taskRepository.update('main', {
      title: 'Updated', dependencies: ['dep_b'], priority: 'urgent',
    });
    assert.equal(updated.title, 'Updated');
    assert.equal(updated.priority, 'urgent');
    assert.deepEqual(updated.dependencies, ['dep_b']);
    assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM task_dependencies WHERE task_id = ?').get('main').count, 1);
    assert.throws(() => store.taskRepository.create(task('main')), /already exists/);

    assert.equal(store.taskRepository.delete('main'), true);
    assert.equal(store.taskRepository.delete('main'), false);
    assert.equal(store.taskRepository.getById('main'), null);
    assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM task_dependencies WHERE task_id = ?').get('main').count, 0);
    assert.throws(() => store.taskRepository.update('missing', {}), /not found/);
  } finally {
    store.close();
  }
});

test('deleting a dependency target preserves references as deterministic missing dependencies', () => {
  const store = openSQLiteStore();
  try {
    store.taskRepository.create(task('target'));
    store.taskRepository.create(task('dependent', { dependencies: ['target'] }));
    assert.equal(store.taskRepository.delete('target'), true);
    assert.deepEqual(store.taskRepository.getById('dependent').dependencies, ['target']);
  } finally {
    store.close();
  }
});

test('SQLite Task list supports status, source, range overlap, and excludes unscheduled', () => {
  const store = openSQLiteStore();
  try {
    store.taskRepository.create(task('due_only', { due_at: '2026-08-12', time_state: 'date_only' }));
    store.taskRepository.create(task('notion', {
      start_at: '2026-08-20T09:00:00+08:00', due_at: '2026-08-20T18:00:00+08:00',
      time_state: 'exact', source: 'notion', external_id: 'n2', status: 'in_progress',
    }));
    store.taskRepository.create(task('unscheduled'));
    assert.deepEqual(store.taskRepository.list({ start_at: '2026-08-12', end_at: '2026-08-12' }).map((item) => item.id), ['due_only']);
    assert.deepEqual(store.taskRepository.list({ source: 'notion' }).map((item) => item.id), ['notion']);
    assert.deepEqual(store.taskRepository.list({ status: 'in_progress' }).map((item) => item.id), ['notion']);
  } finally {
    store.close();
  }
});

test('SQLite Event repository round-trips timed/all-day values and window overlap', () => {
  const store = openSQLiteStore();
  try {
    assertRepositoryContract(store.eventRepository);
    const overnight = store.eventRepository.create(event('overnight', {
      start_at: '2026-08-10T23:00:00+08:00', end_at: '2026-08-11T01:00:00+08:00',
      source: 'notion', external_id: 'notion_event_1', location: 'Room A',
    }));
    const allDay = store.eventRepository.create(event('all_day', {
      start_at: '2026-08-12', end_at: '2026-08-12', all_day: true,
    }));
    assert.equal(overnight.all_day, false);
    assert.equal(overnight.location, 'Room A');
    assert.equal(allDay.all_day, true);
    assert.deepEqual(store.eventRepository.list({ start_at: '2026-08-11', end_at: '2026-08-11' }).map((item) => item.id), ['overnight']);
    assert.deepEqual(store.eventRepository.list({ source: 'notion' }).map((item) => item.id), ['overnight']);
    const updated = store.eventRepository.update('overnight', { location: 'Room B' });
    assert.equal(updated.location, 'Room B');
    assert.equal(store.eventRepository.delete('overnight'), true);
    assert.equal(store.eventRepository.getById('overnight'), null);
  } finally {
    store.close();
  }
});

test('TaskService, CalendarService, and ScheduleQueryService operate with SQLite repositories', () => {
  const store = openSQLiteStore();
  try {
    const tasks = new TaskService(store.taskRepository);
    const calendar = new CalendarService(store.eventRepository);
    tasks.createTask({
      id: 'service_task', title: 'Service task',
      start_at: '2026-08-10T09:00:00+08:00', due_at: '2026-08-10T18:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }, { now: CREATED });
    calendar.createEvent({
      id: 'service_event', title: 'Service event',
      start_at: '2026-08-10T11:00:00+08:00', end_at: '2026-08-10T13:00:00+08:00',
      timezone: 'Asia/Shanghai',
    }, { now: CREATED });
    const updated = tasks.updateTask('service_task', { priority: 'high' }, { now: '2026-08-10T09:00:00+08:00' });
    assert.equal(updated.priority, 'high');
    assert.equal(updated.updated_at, '2026-08-10T09:00:00+08:00');
    const schedule = new ScheduleQueryService(store.taskRepository, store.eventRepository);
    const day = schedule.getDayView('2026-08-10', {
      now: '2026-08-10T12:00:00+08:00', timezone: 'Asia/Shanghai',
    });
    assert.ok(day.tasks.some((item) => item.id === 'service_task'));
    assert.ok(day.events.some((item) => item.id === 'service_event'));
  } finally {
    store.close();
  }
});

test('SQLite store reports version and close is safely idempotent', () => {
  const store = openSQLiteStore();
  assert.equal(store.schemaVersion, 1);
  assert.equal(store.close(), true);
  assert.equal(store.close(), false);
  assert.throws(() => store.schemaVersion, /closed/);
});
