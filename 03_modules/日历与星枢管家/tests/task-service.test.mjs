import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryTaskStore } from '../src/storage/in-memory-store.mjs';
import { TaskService, TaskNotFoundError } from '../src/services/task-service.mjs';

const T0 = '2026-08-10T08:00:00+08:00';
const T1 = '2026-08-10T09:00:00+08:00';
const T2 = '2026-08-10T10:00:00+08:00';

function service(options) {
  return new TaskService(createInMemoryTaskStore(), options);
}

test('TaskService creates, gets, and generates a local id with explicit timestamps', () => {
  const tasks = service({ idFactory: () => 'task_generated' });
  const created = tasks.createTask({
    title: 'Generated task', external_id: 'external_1', source: 'notion',
    created_at: '2000-01-01T00:00:00Z', updated_at: '2000-01-01T00:00:00Z',
  }, { now: T0 });
  assert.equal(created.id, 'task_generated');
  assert.equal(created.external_id, 'external_1');
  assert.notEqual(created.id, created.external_id);
  assert.equal(created.created_at, T0);
  assert.equal(created.updated_at, T0);
  assert.equal(tasks.getTask(created.id), created);
});

test('TaskService update preserves id/created_at and uses only explicit now', () => {
  const tasks = service();
  tasks.createTask({ id: 'task_update', title: 'Before' }, { now: T0 });
  const updated = tasks.updateTask('task_update', { title: 'After', priority: 'high' }, { now: T1 });
  assert.equal(updated.id, 'task_update');
  assert.equal(updated.created_at, T0);
  assert.equal(updated.updated_at, T1);
  assert.equal(updated.title, 'After');
  assert.equal(tasks.getTask('task_update').updated_at, T1);
});

test('TaskService preserves ambiguous and relative states without fabricating time', () => {
  const tasks = service();
  const ambiguous = tasks.createTask({ id: 'ambiguous', title: 'Ambiguous', time_state: 'ambiguous' }, { now: T0 });
  assert.equal(ambiguous.time_state, 'ambiguous');
  assert.equal(ambiguous.start_at, null);
  assert.equal(ambiguous.due_at, null);
  const relative = tasks.updateTask('ambiguous', { time_state: 'relative_unresolved' }, { now: T1 });
  assert.equal(relative.time_state, 'relative_unresolved');
  assert.equal(relative.start_at, null);
  assert.equal(relative.due_at, null);
});

test('TaskService complete is deterministic and idempotent', () => {
  const tasks = service();
  tasks.createTask({ id: 'task_complete', title: 'Complete me' }, { now: T0 });
  const completed = tasks.completeTask('task_complete', { now: T1 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.completed_at, T1);
  assert.equal(completed.updated_at, T1);
  const again = tasks.completeTask('task_complete', { now: T2 });
  assert.equal(again, completed);
  assert.equal(again.completed_at, T1);
  assert.equal(again.updated_at, T1);
});

test('TaskService delete and missing-entity behavior are explicit', () => {
  const tasks = service();
  tasks.createTask({ id: 'task_delete', title: 'Delete me' }, { now: T0 });
  assert.equal(tasks.deleteTask('task_delete'), true);
  assert.equal(tasks.deleteTask('task_delete'), false);
  assert.equal(tasks.getTask('task_delete'), null);
  assert.throws(() => tasks.updateTask('missing', {}, { now: T1 }), TaskNotFoundError);
  assert.throws(() => tasks.completeTask('missing', { now: T1 }), TaskNotFoundError);
  assert.throws(() => tasks.isBlocked('missing'), TaskNotFoundError);
});

test('TaskService list supports status, source, and due-only date ranges', () => {
  const tasks = service();
  tasks.createTask({ id: 'due', title: 'Due only', due_at: '2026-08-12', source: 'local' }, { now: T0 });
  tasks.createTask({ id: 'other', title: 'Other', due_at: '2026-08-20', source: 'notion', external_id: 'n_1' }, { now: T0 });
  tasks.createTask({ id: 'unscheduled', title: 'Unscheduled' }, { now: T0 });
  assert.deepEqual(tasks.listTasks({ start_at: '2026-08-12', end_at: '2026-08-12' }).map((task) => task.id), ['due']);
  assert.deepEqual(tasks.listTasks({ source: 'notion' }).map((task) => task.id), ['other']);
  assert.equal(tasks.listTasks({ status: 'pending' }).length, 3);
});

test('TaskService dependency checks cover none, incomplete, missing, and completed', () => {
  const tasks = service();
  tasks.createTask({ id: 'dependency', title: 'Dependency' }, { now: T0 });
  tasks.createTask({ id: 'blocked', title: 'Blocked', dependencies: ['dependency'] }, { now: T0 });
  tasks.createTask({ id: 'missing_blocker', title: 'Missing', dependencies: ['not_found'] }, { now: T0 });
  tasks.createTask({ id: 'free', title: 'Free' }, { now: T0 });
  assert.equal(tasks.isBlocked('free'), false);
  assert.equal(tasks.isBlocked('blocked'), true);
  assert.equal(tasks.isBlocked('missing_blocker'), true);
  tasks.completeTask('dependency', { now: T1 });
  assert.equal(tasks.isBlocked('blocked'), false);
});

test('TaskService rejects invalid domain values and requires explicit now', () => {
  const tasks = service();
  assert.throws(() => tasks.createTask({ id: 'bad', title: 'Bad', priority: 'impossible' }, { now: T0 }), /priority/);
  assert.throws(() => tasks.createTask({ id: 'bad', title: 'Bad', status: 'done' }, { now: T0 }), /status/);
  assert.throws(() => tasks.createTask({ id: 'same', title: 'Bad', external_id: 'same' }, { now: T0 }), /external_id/);
  assert.throws(() => tasks.createTask({ id: 'clock', title: 'No clock' }), /now/);
  tasks.createTask({ id: 'update_clock', title: 'Clock' }, { now: T0 });
  assert.throws(() => tasks.updateTask('update_clock', { title: 'No clock' }), /now/);
});
