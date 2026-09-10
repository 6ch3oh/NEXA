import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LocalCommandHandler } from '../src/commands/local-command-handler.mjs';
import { TaskService } from '../src/services/task-service.mjs';
import { CalendarService } from '../src/services/calendar-service.mjs';
import {
  createInMemoryEventStore,
  createInMemoryTaskStore,
} from '../src/storage/in-memory-store.mjs';

const CONTEXT = Object.freeze({
  now: '2026-08-10T09:00:00+08:00',
  timezone: 'Asia/Shanghai',
});

function setup() {
  const taskService = new TaskService(createInMemoryTaskStore(), { idFactory: () => 'generated_task' });
  const calendarService = new CalendarService(createInMemoryEventStore(), { idFactory: () => 'generated_event' });
  return { taskService, calendarService, handler: new LocalCommandHandler({ taskService, calendarService }) };
}

test('local handler routes task create update complete and list through TaskService', () => {
  const { handler } = setup();
  const created = handler.execute({
    command_type: 'task.create',
    payload: { id: 'task_1', title: 'Local task' },
  }, CONTEXT);
  assert.equal(created.timezone, 'Asia/Shanghai');

  const updated = handler.execute({
    command_type: 'task.update',
    payload: { task_id: 'task_1', patch: { title: 'Updated task' } },
  }, { ...CONTEXT, now: '2026-08-10T09:01:00+08:00' });
  assert.equal(updated.title, 'Updated task');

  const completed = handler.execute({
    command_type: 'task.complete',
    payload: { task_id: 'task_1' },
  }, { ...CONTEXT, now: '2026-08-10T09:02:00+08:00' });
  assert.equal(completed.status, 'completed');

  const listed = handler.execute({
    command_type: 'task.list',
    payload: { options: { status: 'completed' } },
  }, CONTEXT);
  assert.deepEqual(listed.map((task) => task.id), ['task_1']);
});

test('local handler routes calendar create update and list through CalendarService', () => {
  const { handler } = setup();
  const created = handler.execute({
    command_type: 'calendar.create',
    payload: {
      id: 'event_1',
      title: 'Local event',
      start_at: '2026-08-10T10:00:00+08:00',
      end_at: '2026-08-10T11:00:00+08:00',
    },
  }, CONTEXT);
  assert.equal(created.timezone, 'Asia/Shanghai');

  const updated = handler.execute({
    command_type: 'calendar.update',
    payload: { event_id: 'event_1', patch: { location: 'Room B' } },
  }, { ...CONTEXT, now: '2026-08-10T09:01:00+08:00' });
  assert.equal(updated.location, 'Room B');

  const listed = handler.execute({
    command_type: 'calendar.list',
    payload: { options: { start_at: '2026-08-10', end_at: '2026-08-10' } },
  }, CONTEXT);
  assert.deepEqual(listed.map((event) => event.id), ['event_1']);
});

test('local handler rejects unsupported commands and malformed payloads before service invocation', () => {
  const { handler } = setup();
  assert.throws(
    () => handler.validate({ command_type: 'calendar.complete', payload: {} }),
    /Unsupported local command/,
  );
  assert.throws(
    () => handler.validate({ command_type: 'task.update', payload: { task_id: 'task_1', patch: {} } }),
    /must not be empty/,
  );
  assert.throws(
    () => handler.validate({ command_type: 'task.list', payload: { secret: 'not allowed' } }),
    /unsupported field/,
  );
});

test('local handler requires explicit now and timezone', () => {
  const { handler } = setup();
  const command = { command_type: 'task.list', payload: {} };
  assert.throws(() => handler.execute(command, { timezone: 'Asia/Shanghai' }), /now/);
  assert.throws(() => handler.execute(command, { now: CONTEXT.now }), /timezone/);
});
