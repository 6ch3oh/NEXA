import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createButlerNotionRuntime,
  extractLegacyNotionHostApi,
} from '../src/adapters/notion/notion-runtime-factory.mjs';
import {
  LEGACY_HOST_ERROR_CODES,
  LegacyHostBindingError,
} from '../src/adapters/notion/legacy-host-binding.mjs';
import { createNotionSyncPolicy } from '../src/adapters/notion/notion-sync-policy.mjs';
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
  const notionTodo = {
    get: async () => { calls.push('get'); return structuredClone(state.get); },
    refresh: async () => { calls.push('refresh'); return structuredClone(state.refresh); },
    test: async () => { calls.push('test'); return structuredClone(state.test); },
    open: async (target) => { calls.push(`open:${target}`); return structuredClone(state.open); },
  };
  return { state, calls, notionTodo, windowLike: { tokenMonitor: { notionTodo } } };
}

function createRuntime(windowState = fakeWindow(), options = {}) {
  const repository = options.taskRepository ?? createInMemoryTaskStore();
  const runtime = createButlerNotionRuntime({
    windowLike: windowState.windowLike,
    taskRepository: repository,
    timezone: runtimeFixture.timezone,
    clock: () => runtimeFixture.now,
    ...options,
  });
  return { runtime, repository, windowState };
}

test('runtime factory extracts only windowLike.tokenMonitor.notionTodo and reports ready status', () => {
  const state = fakeWindow();
  assert.equal(extractLegacyNotionHostApi(state.windowLike), state.notionTodo);
  const { runtime } = createRuntime(state);
  const status = runtime.getStatus();
  assert.deepEqual(status, {
    ready: true,
    host_available: true,
    capabilities: { get: true, refresh: true, test: true, open: true },
    repository_ready: true,
    timezone: runtimeFixture.timezone,
    last_error: null,
    disposed: false,
    repository_ownership: 'caller',
  });
  assert.equal(Object.isFrozen(status), true);
  assert.equal(Object.isFrozen(status.capabilities), true);
  assert.equal(/token|secret|config/i.test(JSON.stringify(status)), false);
});

test('missing window host path fails closed with controlled HOST_UNAVAILABLE', () => {
  for (const windowLike of runtimeFixture.missing_window_cases) {
    assert.throws(
      () => extractLegacyNotionHostApi(windowLike),
      (error) => error instanceof LegacyHostBindingError &&
        error.code === LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE,
    );
  }
  const throwingWindow = {};
  Object.defineProperty(throwingWindow, 'tokenMonitor', { get() { throw new Error('opaque'); } });
  assert.throws(
    () => extractLegacyNotionHostApi(throwingWindow),
    (error) => error instanceof LegacyHostBindingError &&
      error.code === LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE,
  );
});

test('each partial host capability fails with controlled capability evidence', () => {
  for (const capability of runtimeFixture.missing_capabilities) {
    const state = fakeWindow();
    delete state.notionTodo[capability];
    assert.throws(
      () => createRuntime(state),
      (error) => error instanceof LegacyHostBindingError &&
        error.code === LEGACY_HOST_ERROR_CODES.CAPABILITY_MISSING &&
        error.capability === capability,
    );
  }
});

test('repository clock and timezone are explicit injected construction dependencies', () => {
  const state = fakeWindow();
  assert.throws(() => createButlerNotionRuntime({
    windowLike: state.windowLike,
    taskRepository: createInMemoryTaskStore(),
    timezone: runtimeFixture.timezone,
  }), /clock/);
  assert.throws(() => createButlerNotionRuntime({
    windowLike: state.windowLike,
    taskRepository: createInMemoryTaskStore(),
    clock: () => runtimeFixture.now,
  }), /timezone/);
  assert.throws(() => createButlerNotionRuntime({
    windowLike: state.windowLike,
    taskRepository: {},
    timezone: runtimeFixture.timezone,
    clock: () => runtimeFixture.now,
  }), /repository method/);
});

test('clock object injection deterministically timestamps a real host-to-task sync', async () => {
  const state = fakeWindow();
  const repository = createInMemoryTaskStore();
  const runtime = createButlerNotionRuntime({
    windowLike: state.windowLike,
    taskRepository: repository,
    timezone: runtimeFixture.timezone,
    clock: { now: () => runtimeFixture.now },
  });
  const result = await runtime.getAndSync();
  assert.equal(result.created_count, 1);
  assert.equal(repository.list()[0].created_at, runtimeFixture.now);
  assert.deepEqual(state.calls, ['get']);
});

test('explicit Sync Policy is accepted only when it matches runtime timezone', () => {
  const state = fakeWindow();
  const matching = createNotionSyncPolicy({ timezone: runtimeFixture.timezone });
  assert.doesNotThrow(() => createRuntime(state, { syncPolicy: matching }));
  const mismatched = createNotionSyncPolicy({ timezone: hostFixture.timezone });
  assert.throws(() => createRuntime(fakeWindow(), { syncPolicy: mismatched }), /timezone must match/);
});

test('runtime facade delegates get refresh test and open without exposing composition internals', async () => {
  const state = fakeWindow();
  const { runtime, repository } = createRuntime(state);
  assert.deepEqual(Object.keys(runtime).sort(), [
    'dispose', 'getAndSync', 'getStatus', 'openExternal', 'refreshAndSync', 'testConnection',
  ]);
  assert.equal((await runtime.getAndSync()).created_count, 1);
  assert.equal((await runtime.refreshAndSync({ now: runtimeFixture.later_now })).updated_count, 1);
  assert.equal((await runtime.testConnection()).ok, true);
  assert.equal((await runtime.openExternal(runtimeFixture.external_target)).ok, true);
  assert.equal(repository.list()[0].title, 'Synthetic host-refreshed task');
  assert.deepEqual(state.calls, [
    'get', 'refresh', 'test', `open:${runtimeFixture.external_target}`,
  ]);
});
