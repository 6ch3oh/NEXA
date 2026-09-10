import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LEGACY_HOST_CAPABILITIES,
  LEGACY_HOST_ERROR_CODES,
  LegacyHostBindingError,
  createLegacyNotionHostBinding,
  normalizeLegacyHostFailure,
  validateLegacyNotionHostApi,
} from '../src/adapters/notion/legacy-host-binding.mjs';
import { createLegacyNotionTodoPort } from '../src/adapters/notion/legacy-todo-port.mjs';

const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/notion-host-cases.json', import.meta.url),
  'utf8',
));

function fullHost(overrides = {}) {
  const calls = [];
  return {
    calls,
    get: async () => { calls.push('get'); return structuredClone(fixture.snapshots.get_success); },
    refresh: async () => { calls.push('refresh'); return structuredClone(fixture.snapshots.refresh_success); },
    test: async () => { calls.push('test'); return structuredClone(fixture.host_responses.test_success); },
    open: async (target) => { calls.push(`open:${target}`); return structuredClone(fixture.host_responses.open_success); },
    ...overrides,
  };
}

test('full Legacy preload host is accepted and all four capabilities are bound', async () => {
  const host = fullHost();
  const binding = createLegacyNotionHostBinding(host);
  assert.deepEqual(Object.keys(binding.capabilities), LEGACY_HOST_CAPABILITIES);
  assert.equal((await binding.get()).ok, true);
  assert.equal((await binding.refresh()).ok, true);
  assert.equal((await binding.test()).ok, true);
  assert.equal((await binding.open(fixture.external_target)).ok, true);
  assert.deepEqual(host.calls, [
    'get', 'refresh', 'test', `open:${fixture.external_target}`,
  ]);
  assert.equal(Object.isFrozen(binding), true);
});

test('host unavailable fails closed with HOST_UNAVAILABLE mapped to NOT_CONFIGURED', () => {
  for (const unavailable of [null, undefined, [], 'host']) {
    assert.throws(
      () => validateLegacyNotionHostApi(unavailable),
      (error) => error instanceof LegacyHostBindingError &&
        error.code === LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE &&
        error.failure.code === 'NOT_CONFIGURED',
    );
  }
});

test('each missing required host capability fails with capability-specific evidence', () => {
  for (const capability of fixture.missing_capabilities) {
    const host = fullHost();
    delete host[capability];
    assert.throws(
      () => createLegacyNotionHostBinding(host),
      (error) => error instanceof LegacyHostBindingError &&
        error.code === LEGACY_HOST_ERROR_CODES.CAPABILITY_MISSING &&
        error.capability === capability &&
        error.failure.code === 'UNSUPPORTED_OPERATION',
    );
  }
});

test('invalid host response is distinguished and normalized as MALFORMED_DATA through Port', async () => {
  const binding = createLegacyNotionHostBinding(fullHost({
    get: async () => fixture.host_responses.invalid,
  }));
  const direct = await binding.get();
  assert.equal(direct.host_error_code, 'INVALID_RESPONSE');
  assert.equal(normalizeLegacyHostFailure(direct).code, 'MALFORMED_DATA');
  const result = await createLegacyNotionTodoPort(binding).getSnapshot();
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'MALFORMED_DATA');
});

test('Legacy error preserves safe status semantics and normalizes authentication failure', async () => {
  const binding = createLegacyNotionHostBinding(fullHost({
    test: async () => structuredClone(fixture.host_responses.test_failure),
  }));
  const direct = await binding.test();
  assert.equal(direct.host_error_code, 'LEGACY_ERROR');
  assert.equal(normalizeLegacyHostFailure(direct).code, 'AUTH_FAILED');
  const result = await createLegacyNotionTodoPort(binding).testConnection();
  assert.equal(result.failure.code, 'AUTH_FAILED');
  assert.equal(JSON.stringify(result).includes('token'), false);
});

test('thrown host errors are replaced with a safe LEGACY_ERROR result', async () => {
  const binding = createLegacyNotionHostBinding(fullHost({
    refresh: async () => { throw new Error('opaque sensitive host detail'); },
  }));
  const direct = await binding.refresh();
  assert.deepEqual(direct, {
    ok: false,
    status: 'unknown',
    host_error_code: 'LEGACY_ERROR',
    capability: 'refresh',
    error: 'legacy host operation failed',
  });
  assert.equal(JSON.stringify(direct).includes('opaque sensitive'), false);
});

test('open is only delegated to the injected host and does not use an OS API', async () => {
  const seen = [];
  const binding = createLegacyNotionHostBinding(fullHost({
    open: async (target) => { seen.push(target); return { ok: true }; },
  }));
  const result = await createLegacyNotionTodoPort(binding).openExternal(fixture.external_target);
  assert.equal(result.ok, true);
  assert.deepEqual(seen, [fixture.external_target]);
});
