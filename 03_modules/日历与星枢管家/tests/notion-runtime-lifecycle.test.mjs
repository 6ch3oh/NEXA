import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ButlerNotionRuntimeError,
  createButlerNotionRuntime,
} from '../src/adapters/notion/notion-runtime-factory.mjs';
import { NOTION_RUNTIME_ERROR_CODES } from '../src/adapters/notion/notion-runtime-status.mjs';
import { createInMemoryTaskStore } from '../src/storage/in-memory-store.mjs';

const runtimeFixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-runtime-cases.json', import.meta.url),
  'utf8',
));
const hostFixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));

function fakeWindow() {
  const state = {
    get: structuredClone(hostFixture.snapshots.get_success),
    refresh: structuredClone(hostFixture.snapshots.refresh_success),
    test: structuredClone(hostFixture.host_responses.test_success),
    open: structuredClone(hostFixture.host_responses.open_success),
  };
  const calls = [];
  return {
    state,
    calls,
    windowLike: { tokenMonitor: { notionTodo: {
      get: async () => { calls.push('get'); return structuredClone(state.get); },
      refresh: async () => { calls.push('refresh'); return structuredClone(state.refresh); },
      test: async () => { calls.push('test'); return structuredClone(state.test); },
      open: async (target) => { calls.push(`open:${target}`); return structuredClone(state.open); },
    } } },
  };
}

function runtimeFor(host, repository = createInMemoryTaskStore()) {
  return createButlerNotionRuntime({
    windowLike: host.windowLike,
    taskRepository: repository,
    timezone: runtimeFixture.timezone,
    clock: () => runtimeFixture.now,
  });
}

test('dispose is idempotent and every operational facade fails with RUNTIME_DISPOSED', async () => {
  const host = fakeWindow();
  const runtime = runtimeFor(host);
  await runtime.getAndSync();
  assert.equal(runtime.dispose(), true);
  assert.equal(runtime.dispose(), false);
  const status = runtime.getStatus();
  assert.equal(status.ready, false);
  assert.equal(status.disposed, true);
  assert.equal(status.last_error.code, NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED);
  const before = host.calls.length;
  for (const operation of [
    () => runtime.getAndSync(),
    () => runtime.refreshAndSync(),
    () => runtime.testConnection(),
    () => runtime.openExternal(runtimeFixture.external_target),
  ]) {
    await assert.rejects(operation, (error) => error instanceof ButlerNotionRuntimeError &&
      error.code === NOTION_RUNTIME_ERROR_CODES.RUNTIME_DISPOSED);
  }
  assert.equal(host.calls.length, before);
});

test('dispose never closes or invalidates the caller-owned Task Repository', async () => {
  const host = fakeWindow();
  const inner = createInMemoryTaskStore();
  let closeCalls = 0;
  const repository = {
    create: (...args) => inner.create(...args),
    getById: (...args) => inner.getById(...args),
    update: (...args) => inner.update(...args),
    delete: (...args) => inner.delete(...args),
    list: (...args) => inner.list(...args),
    close: () => { closeCalls += 1; },
  };
  const runtime = runtimeFor(host, repository);
  await runtime.getAndSync();
  runtime.dispose();
  assert.equal(closeCalls, 0);
  assert.equal(repository.list().length, 1);
});

test('host failures become safe last_error status and a later success clears it', async () => {
  const host = fakeWindow();
  const runtime = runtimeFor(host);
  host.state.test = structuredClone(hostFixture.host_responses.test_failure);
  const failure = await runtime.testConnection();
  assert.equal(failure.ok, false);
  const failedStatus = runtime.getStatus();
  assert.equal(failedStatus.last_error.code, 'AUTH_FAILED');
  assert.equal(failedStatus.last_error.message, 'Butler Notion runtime operation failed safely.');
  assert.equal(/invalidToken|secret|connection failed/i.test(JSON.stringify(failedStatus)), false);

  host.state.test = structuredClone(hostFixture.host_responses.test_success);
  assert.equal((await runtime.testConnection()).ok, true);
  assert.equal(runtime.getStatus().last_error, null);
});

test('thrown host details cannot escape through runtime result or status', async () => {
  const host = fakeWindow();
  host.windowLike.tokenMonitor.notionTodo.open = async () => {
    throw new Error('opaque-token-value');
  };
  const runtime = runtimeFor(host);
  const result = await runtime.openExternal(runtimeFixture.external_target);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'UNKNOWN');
  assert.equal(JSON.stringify(result).includes('opaque-token-value'), false);
  assert.equal(JSON.stringify(runtime.getStatus()).includes('opaque-token-value'), false);
});
