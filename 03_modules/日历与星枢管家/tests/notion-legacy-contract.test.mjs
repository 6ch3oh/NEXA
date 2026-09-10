import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_CAPABILITY_STATES,
  LEGACY_FAILURE_CODES,
  LEGACY_RUNTIME_MODE,
  createLegacyMutationIntent,
  legacyNotionTodoCapabilities,
  normalizeLegacyFailure,
} from '../src/adapters/notion/legacy-capability-contract.mjs';
import {
  LEGACY_NOTION_TODO_IPC,
  createLegacyNotionTodoPort,
} from '../src/adapters/notion/legacy-todo-port.mjs';
import { createTask } from '../src/domain/task.mjs';

test('capability matrix reflects the actual read-only Legacy runtime', () => {
  assert.equal(legacyNotionTodoCapabilities.runtime_mode, LEGACY_RUNTIME_MODE);
  for (const capability of ['get', 'refresh', 'test', 'open']) {
    assert.equal(legacyNotionTodoCapabilities[capability], LEGACY_CAPABILITY_STATES.REUSED);
  }
  for (const capability of ['create', 'update', 'complete', 'reopen']) {
    assert.equal(legacyNotionTodoCapabilities[capability], LEGACY_CAPABILITY_STATES.CONTRACT_ONLY);
  }
  assert.equal(legacyNotionTodoCapabilities.mutation_executable, false);
});

test('IPC contract records the exact Legacy main/preload channels', () => {
  assert.deepEqual(LEGACY_NOTION_TODO_IPC, {
    get: 'notionTodo:get', refresh: 'notionTodo:refresh', test: 'notionTodo:test',
    open: 'notionTodo:open', push: 'notionTodo:push',
  });
});

test('Port delegates get refresh test open and push to an injected bridge only', async () => {
  const calls = [];
  let push;
  const port = createLegacyNotionTodoPort({
    get: async () => { calls.push('get'); return { ok: true, items: [] }; },
    refresh: async () => { calls.push('refresh'); return { ok: true, items: [] }; },
    test: async () => { calls.push('test'); return { ok: true }; },
    open: async (url) => { calls.push(`open:${url}`); return { ok: true }; },
    onPush: (callback) => { push = callback; return () => calls.push('unsubscribe'); },
  });
  assert.equal((await port.getSnapshot()).ok, true);
  assert.equal((await port.refresh()).ok, true);
  assert.equal((await port.testConnection()).ok, true);
  assert.equal((await port.openExternal('https://www.notion.so/safe')).ok, true);
  const unsubscribe = port.subscribe((value) => calls.push(`push:${value.status}`));
  push({ status: 'ready' });
  unsubscribe();
  assert.deepEqual(calls, [
    'get', 'refresh', 'test', 'open:https://www.notion.so/safe', 'push:ready', 'unsubscribe',
  ]);
});

test('Port normalizes Legacy failure without adding a network or token dependency', async () => {
  const port = createLegacyNotionTodoPort({
    get: async () => ({ ok: false, status: 'invalidToken', items: [] }),
    refresh: async () => ({ ok: false, status: 'network', items: [{ id: 'cached' }] }),
    test: async () => { throw new Error('opaque transport detail'); },
    open: async () => ({ ok: false, status: 'unsupported' }),
  });
  assert.equal((await port.getSnapshot()).failure.code, LEGACY_FAILURE_CODES.AUTH_FAILED);
  assert.equal((await port.refresh()).failure.code, LEGACY_FAILURE_CODES.STALE_CACHE);
  assert.equal((await port.testConnection()).failure.code, LEGACY_FAILURE_CODES.UNKNOWN);
  assert.equal((await port.openExternal('https://www.notion.so/safe')).failure.code, LEGACY_FAILURE_CODES.UNSUPPORTED_OPERATION);
});

test('failure normalization preserves distinguishable semantics and closes unknowns safely', () => {
  assert.equal(normalizeLegacyFailure({ status: 'notConfigured' }).code, 'NOT_CONFIGURED');
  assert.equal(normalizeLegacyFailure({ status: 'rateLimited', retryAfterMs: 5000 }).code, 'NETWORK_FAILED');
  assert.equal(normalizeLegacyFailure({ status: 'notFound' }).code, 'UNKNOWN');
  assert.equal(normalizeLegacyFailure({ status: 'network', ok: false }, { hasCachedItems: true }).code, 'STALE_CACHE');
});

test('mutation intent is contract-only, confirmation-required, and never executable', () => {
  const task = createTask({
    id: 'local_task_legacy_page_pending', title: 'Synthetic pending task', source: 'notion',
    external_id: 'legacy_page_pending', priority: 'high', due_at: '2026-08-12',
    timezone: 'Asia/Shanghai', time_state: 'date_only',
  }, { now: '2026-08-10T00:00:00.000Z' });
  for (const operation of ['create', 'update', 'complete', 'reopen']) {
    const intent = createLegacyMutationIntent({
      operation, task, created_at: '2026-08-10T00:00:00.000Z',
    });
    assert.equal(intent.capability, 'CONTRACT_ONLY');
    assert.equal(intent.executable, false);
    assert.equal(intent.requires_confirmation, true);
    assert.match(intent.confirmation_boundary, /Command Policy/);
  }
});

test('non-create mutation intent requires external identity and explicit timestamp', () => {
  const local = createTask({ id: 'local_only', title: 'Local only' }, { now: '2026-08-10T00:00:00.000Z' });
  assert.throws(() => createLegacyMutationIntent({
    operation: 'update', task: local, created_at: '2026-08-10T00:00:00.000Z',
  }), /external_id/);
  assert.throws(() => createLegacyMutationIntent({ operation: 'create', task: local }), /created_at/);
});
