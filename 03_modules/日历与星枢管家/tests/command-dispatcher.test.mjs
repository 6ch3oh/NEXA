import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCommand } from '../src/commands/contract.mjs';
import { CommandDispatcher } from '../src/commands/dispatcher.mjs';
import { InMemoryCommandReceiptStore } from '../src/commands/receipt-store.mjs';
import { TaskService } from '../src/services/task-service.mjs';
import { CalendarService } from '../src/services/calendar-service.mjs';
import {
  createInMemoryEventStore,
  createInMemoryTaskStore,
} from '../src/storage/in-memory-store.mjs';
import { openSQLiteStore } from '../src/storage/sqlite-store.mjs';

const NOW = '2026-08-10T09:00:00+08:00';
const CONTEXT = Object.freeze({ now: NOW, timezone: 'Asia/Shanghai' });

function command(input) {
  return createCommand({ created_at: NOW, ...input });
}

function setup({ handler = null, taskRepository = null, eventRepository = null } = {}) {
  const taskService = new TaskService(taskRepository ?? createInMemoryTaskStore(), {
    idFactory: () => 'generated_task',
  });
  const calendarService = new CalendarService(eventRepository ?? createInMemoryEventStore(), {
    idFactory: () => 'generated_event',
  });
  const receiptStore = new InMemoryCommandReceiptStore();
  let receiptSequence = 0;
  const dispatcher = new CommandDispatcher({
    taskService,
    calendarService,
    handler,
    receiptStore,
    receiptIdFactory: () => `receipt_test_${receiptSequence += 1}`,
  });
  return { dispatcher, receiptStore, taskService, calendarService };
}

test('dispatcher routes task and calendar commands through their services', () => {
  const { dispatcher } = setup();
  const taskCreate = dispatcher.dispatch(command({
    command_id: 'route_task_create',
    command_type: 'task.create',
    payload: { id: 'task_1', title: 'Task one' },
  }), CONTEXT);
  assert.equal(taskCreate.status, 'executed');
  assert.equal(taskCreate.data.timezone, 'Asia/Shanghai');

  const taskGet = dispatcher.dispatch(command({
    command_id: 'route_task_get',
    command_type: 'task.get',
    payload: { id: 'task_1' },
  }), CONTEXT);
  assert.equal(taskGet.status, 'executed');
  assert.equal(taskGet.data.id, 'task_1');

  const taskUpdate = dispatcher.dispatch(command({
    command_id: 'route_task_update',
    command_type: 'task.update',
    payload: { task_id: 'task_1', patch: { title: 'Updated task' } },
  }), { ...CONTEXT, now: '2026-08-10T09:01:00+08:00' });
  assert.equal(taskUpdate.data.title, 'Updated task');

  const taskComplete = dispatcher.dispatch(command({
    command_id: 'route_task_complete',
    command_type: 'task.complete',
    payload: { task_id: 'task_1' },
  }), { ...CONTEXT, now: '2026-08-10T09:02:00+08:00' });
  assert.equal(taskComplete.data.status, 'completed');

  const taskList = dispatcher.dispatch(command({
    command_id: 'route_task_list',
    command_type: 'task.list',
    payload: { options: { status: 'completed' } },
  }), CONTEXT);
  assert.deepEqual(taskList.data.map((task) => task.id), ['task_1']);

  const eventCreate = dispatcher.dispatch(command({
    command_id: 'route_event_create',
    command_type: 'calendar.create',
    payload: {
      id: 'event_1',
      title: 'Event one',
      start_at: '2026-08-10T10:00:00+08:00',
      end_at: '2026-08-10T11:00:00+08:00',
    },
  }), CONTEXT);
  assert.equal(eventCreate.status, 'executed');

  const eventGet = dispatcher.dispatch(command({
    command_id: 'route_event_get',
    command_type: 'calendar.get',
    payload: { id: 'event_1' },
  }), CONTEXT);
  assert.equal(eventGet.status, 'executed');
  assert.equal(eventGet.data.id, 'event_1');

  const eventUpdate = dispatcher.dispatch(command({
    command_id: 'route_event_update',
    command_type: 'calendar.update',
    payload: { event_id: 'event_1', patch: { location: 'Room C' } },
  }), { ...CONTEXT, now: '2026-08-10T09:03:00+08:00' });
  assert.equal(eventUpdate.data.location, 'Room C');

  const eventList = dispatcher.dispatch(command({
    command_id: 'route_event_list',
    command_type: 'calendar.list',
    payload: {},
  }), CONTEXT);
  assert.deepEqual(eventList.data.map((event) => event.id), ['event_1']);
});

test('unknown, malformed, reserved-but-unimplemented, and invalid payload commands fail closed', () => {
  const { dispatcher } = setup();
  const unknown = dispatcher.dispatch({
    command_id: 'unknown_1', command_type: 'notion.write', payload: {}, created_at: NOW,
    risk_level: 'high', requires_confirmation: true, confirmation_state: 'confirmed', source: 'notion',
  }, CONTEXT);
  assert.equal(unknown.status, 'unsupported');
  assert.equal(unknown.code, 'DENY_UNSUPPORTED');

  const malformed = dispatcher.dispatch({ command_type: 'task.list', payload: {} }, CONTEXT);
  assert.equal(malformed.status, 'invalid');

  const legacyUnimplemented = dispatcher.dispatch(command({
    command_id: 'calendar_complete_1',
    command_type: 'calendar.complete',
    payload: {},
  }), CONTEXT);
  assert.equal(legacyUnimplemented.status, 'unsupported');

  const invalidPayload = dispatcher.dispatch(command({
    command_id: 'invalid_payload_1',
    command_type: 'task.update',
    payload: { task_id: 'task_1', patch: {} },
  }), CONTEXT);
  assert.equal(invalidPayload.status, 'invalid');
  assert.equal(invalidPayload.code, 'INVALID_COMMAND_PAYLOAD');
});

test('task delete pending rejected expired and confirmed preserve the required safety behavior', () => {
  const { dispatcher, taskService } = setup();
  dispatcher.dispatch(command({
    command_id: 'delete_seed', command_type: 'task.create',
    payload: { id: 'delete_task', title: 'Delete target' },
  }), CONTEXT);

  for (const [state, expected] of [
    ['pending', 'confirmation_required'],
    ['rejected', 'denied'],
    ['expired', 'denied'],
  ]) {
    const result = dispatcher.dispatch(command({
      command_id: `delete_${state}`,
      command_type: 'task.delete',
      payload: { task_id: 'delete_task' },
      confirmation_state: state,
    }), CONTEXT);
    assert.equal(result.status, expected);
    assert.notEqual(taskService.getTask('delete_task'), null);
  }

  const confirmed = dispatcher.dispatch(command({
    command_id: 'delete_confirmed',
    command_type: 'task.delete',
    payload: { task_id: 'delete_task' },
    confirmation_state: 'confirmed',
  }), CONTEXT);
  assert.equal(confirmed.status, 'executed');
  assert.equal(taskService.getTask('delete_task'), null);
});

test('calendar delete is also confirmation gated', () => {
  const { dispatcher, calendarService } = setup();
  dispatcher.dispatch(command({
    command_id: 'event_seed', command_type: 'calendar.create',
    payload: {
      id: 'delete_event', title: 'Delete event',
      start_at: '2026-08-10T10:00:00+08:00', end_at: '2026-08-10T11:00:00+08:00',
    },
  }), CONTEXT);

  const pending = dispatcher.dispatch(command({
    command_id: 'event_delete', command_type: 'calendar.delete',
    payload: { event_id: 'delete_event' }, confirmation_state: 'pending',
  }), CONTEXT);
  assert.equal(pending.status, 'confirmation_required');
  assert.notEqual(calendarService.getEvent('delete_event'), null);

  const confirmed = dispatcher.dispatch(command({
    command_id: 'event_delete', command_type: 'calendar.delete',
    payload: { event_id: 'delete_event' }, confirmation_state: 'confirmed',
  }), CONTEXT);
  assert.equal(confirmed.status, 'executed');
  assert.equal(calendarService.getEvent('delete_event'), null);
});

test('confirmation-required command can execute once and then becomes duplicate', () => {
  const { dispatcher, taskService, receiptStore } = setup();
  dispatcher.dispatch(command({
    command_id: 'idem_seed', command_type: 'task.create',
    payload: { id: 'idem_task', title: 'Idempotent target' },
  }), CONTEXT);
  const pendingCommand = command({
    command_id: 'idem_delete', command_type: 'task.delete',
    payload: { task_id: 'idem_task' }, confirmation_state: 'pending',
  });
  assert.equal(dispatcher.dispatch(pendingCommand, CONTEXT).status, 'confirmation_required');

  const confirmedCommand = command({
    command_id: 'idem_delete', command_type: 'task.delete',
    payload: { task_id: 'idem_task' }, confirmation_state: 'confirmed',
  });
  assert.equal(dispatcher.dispatch(confirmedCommand, CONTEXT).status, 'executed');
  assert.equal(taskService.getTask('idem_task'), null);

  const duplicate = dispatcher.dispatch(confirmedCommand, CONTEXT);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.code, 'DUPLICATE_COMMAND');
  assert.equal(receiptStore.list({ command_id: 'idem_delete' }).length, 3);
});

test('same command_id cannot change payload between confirmation and execution', () => {
  const { dispatcher } = setup();
  const pending = command({
    command_id: 'digest_delete', command_type: 'task.delete',
    payload: { task_id: 'task_a' }, confirmation_state: 'pending',
  });
  assert.equal(dispatcher.dispatch(pending, CONTEXT).status, 'confirmation_required');
  const changed = command({
    command_id: 'digest_delete', command_type: 'task.delete',
    payload: { task_id: 'task_b' }, confirmation_state: 'confirmed',
  });
  const result = dispatcher.dispatch(changed, CONTEXT);
  assert.equal(result.status, 'invalid');
  assert.equal(result.code, 'COMMAND_ID_CONFLICT');
});

test('service errors are isolated and sensitive tokens are redacted', () => {
  const handler = {
    supports: () => true,
    validate: () => true,
    execute: () => { throw new Error('service failed token=super-secret'); },
  };
  const { dispatcher } = setup({ handler });
  const result = dispatcher.dispatch(command({
    command_id: 'service_error', command_type: 'task.list', payload: {},
  }), CONTEXT);
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'SERVICE_ERROR');
  assert.equal(result.error.message.includes('super-secret'), false);
  assert.match(result.error.message, /REDACTED/);
});

test('dispatcher requires explicit now and timezone before processing', () => {
  const { dispatcher, receiptStore } = setup();
  const list = command({ command_id: 'context_list', command_type: 'task.list', payload: {} });
  assert.throws(() => dispatcher.dispatch(list, { timezone: 'Asia/Shanghai' }), /now/);
  assert.throws(() => dispatcher.dispatch(list, { now: NOW }), /timezone/);
  assert.equal(receiptStore.list().length, 0);
});

test('execution fixtures cover and satisfy the frozen cases', () => {
  const fixtures = JSON.parse(readFileSync(
    new URL('../fixtures/command-execution-cases.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(fixtures.map((fixture) => fixture.name), [
    'list allowed', 'create allowed', 'delete pending', 'delete confirmed',
    'delete rejected', 'delete expired', 'unknown command', 'malformed command',
    'duplicate command', 'unsupported external command',
  ]);
  for (const fixture of fixtures) {
    const { dispatcher } = setup();
    let result;
    for (let index = 0; index < (fixture.dispatch_count ?? 1); index += 1) {
      result = dispatcher.dispatch(fixture.command, CONTEXT);
    }
    assert.equal(result.status, fixture.expected_status, fixture.name);
  }
});

test('dispatcher operates unchanged with SQLite repositories', () => {
  const store = openSQLiteStore(':memory:');
  try {
    const { dispatcher } = setup({
      taskRepository: store.taskRepository,
      eventRepository: store.eventRepository,
    });
    const created = dispatcher.dispatch(command({
      command_id: 'sqlite_create', command_type: 'task.create',
      payload: { id: 'sqlite_command_task', title: 'SQLite command task' },
    }), CONTEXT);
    assert.equal(created.status, 'executed');
    const listed = dispatcher.dispatch(command({
      command_id: 'sqlite_list', command_type: 'task.list', payload: {},
    }), CONTEXT);
    assert.deepEqual(listed.data.map((task) => task.id), ['sqlite_command_task']);
  } finally {
    store.close();
  }
});
