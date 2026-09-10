import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  externalTaskToTask,
  taskToExternalPayload,
  externalEventToCalendarEvent,
  calendarEventToExternalPayload,
  notionCapabilities,
  toLocalTaskId,
  toLocalEventId,
  NotionUnsupportedFieldError,
  NotionMissingFieldError,
  NotionInvalidValueError,
  NOTION_SOURCE,
} from '../src/adapters/notion/contract.mjs';
import { TASK_STATUSES, TASK_PRIORITIES, createTask } from '../src/domain/task.mjs';

test('capability contract is explicit about offline boundary', () => {
  assert.equal(notionCapabilities.supportsNetwork, false);
  assert.equal(notionCapabilities.requiresSdk, false);
  assert.equal(notionCapabilities.externalIdField, 'id');
  assert.equal(notionCapabilities.task.supportsDependencies, false);
  assert.ok(notionCapabilities.task.supportedStatuses.includes('In progress'));
});

test('externalTaskToTask maps id to external_id and generates a distinct local id', () => {
  const result = externalTaskToTask(
    { id: 'page_42', title: 'Buy milk', status: 'In progress', priority: 'High' },
    { defaultTimezone: 'Asia/Shanghai' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.task.id, toLocalTaskId('page_42'));
  assert.equal(result.task.external_id, 'page_42');
  assert.notEqual(result.task.id, result.task.external_id);
  assert.equal(result.task.source, NOTION_SOURCE);
  assert.equal(result.task.status, TASK_STATUSES.IN_PROGRESS);
  assert.equal(result.task.priority, TASK_PRIORITIES.HIGH);
  assert.equal(result.task.time_state, 'unscheduled');
});

test('externalTaskToTask maps external status and dates', () => {
  const result = externalTaskToTask(
    {
      id: 'page_7',
      title: 'Ship release',
      status: 'Done',
      due: '2026-08-10T14:30:00',
      completed_at: '2026-08-10T15:00:00',
    },
    { defaultTimezone: 'Asia/Shanghai' },
  );
  assert.equal(result.task.status, TASK_STATUSES.COMPLETED);
  assert.equal(result.task.due_at, '2026-08-10T14:30:00');
  assert.equal(result.task.completed_at, '2026-08-10T15:00:00');
});

test('externalTaskToTask rejects missing id/title and unknown status', () => {
  assert.throws(() => externalTaskToTask({ title: 'x' }), NotionMissingFieldError);
  assert.throws(() => externalTaskToTask({ id: 'p', title: '' }), NotionMissingFieldError);
  assert.throws(
    () => externalTaskToTask({ id: 'p', title: 'x', status: 'Random status' }),
    NotionInvalidValueError,
  );
});

test('unsupported fields warn by default and throw in strict mode', () => {
  const external = {
    id: 'p9',
    title: 'With deps',
    dependencies: ['local_task_x'],
    reminders: ['day'],
  };
  const result = externalTaskToTask(external, { defaultTimezone: 'Asia/Shanghai' });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w instanceof NotionUnsupportedFieldError));
  assert.ok(result.warnings.some((w) => w.field.includes('dependencies')));
  assert.throws(
    () => externalTaskToTask(external, { defaultTimezone: 'Asia/Shanghai', strict: true }),
    NotionUnsupportedFieldError,
  );
});

test('taskToExternalPayload maps local task back to external payload and omits dependencies', () => {
  const local = createTask({
    id: 'local_task_p1',
    title: 'Do thing',
    status: TASK_STATUSES.PENDING,
    priority: TASK_PRIORITIES.NORMAL,
    source: NOTION_SOURCE,
    external_id: 'p1',
    dependencies: ['local_task_p0'],
  });
  const result = taskToExternalPayload(local);
  assert.equal(result.ok, true);
  assert.equal(result.payload.id, 'p1');
  assert.equal(result.payload.status, 'To do');
  assert.equal(result.payload.priority, 'Normal');
  assert.ok(result.warnings.some((w) => w instanceof NotionUnsupportedFieldError));
  assert.ok(!('dependencies' in result.payload));
  assert.throws(() => taskToExternalPayload(local, { strict: true }), NotionUnsupportedFieldError);
});

test('local task without external_id maps with null external id', () => {
  const local = createTask({ id: 'local_only', title: 'Local' });
  const result = taskToExternalPayload(local);
  assert.equal(result.payload.id, null);
  assert.equal(result.warnings.length, 0);
});

test('externalEventToCalendarEvent maps timed and all-day events', () => {
  const timed = externalEventToCalendarEvent(
    { id: 'evt_1', title: 'Standup', start: '2026-08-10T10:00:00+08:00', end: '2026-08-10T10:15:00+08:00' },
    {},
  );
  assert.equal(timed.ok, true);
  assert.equal(timed.event.id, toLocalEventId('evt_1'));
  assert.equal(timed.event.external_id, 'evt_1');
  assert.equal(timed.event.start_at, '2026-08-10T10:00:00+08:00');
  assert.equal(timed.event.all_day, false);

  const allDay = externalEventToCalendarEvent(
    { id: 'evt_2', title: 'Holiday', start: '2026-08-15', end: '2026-08-15', all_day: true },
    { defaultTimezone: 'Asia/Shanghai' },
  );
  assert.equal(allDay.event.all_day, true);
  assert.equal(allDay.event.start_at, '2026-08-15');
});

test('externalEventToCalendarEvent rejects end before start', () => {
  assert.throws(
    () =>
      externalEventToCalendarEvent(
        { id: 'evt_3', title: 'Bad', start: '2026-08-10T11:00:00+08:00', end: '2026-08-10T10:00:00+08:00' },
        {},
      ),
    /earlier than start/,
  );
});

test('calendarEventToExternalPayload maps event back with external id', () => {
  const event = externalEventToCalendarEvent(
    { id: 'evt_9', title: 'Review', start: '2026-08-12T14:00:00+08:00', end: '2026-08-12T15:00:00+08:00', location: 'Room A' },
    {},
  ).event;
  const result = calendarEventToExternalPayload(event);
  assert.equal(result.payload.id, 'evt_9');
  assert.equal(result.payload.location, 'Room A');
  assert.equal(result.payload.all_day, false);
});
