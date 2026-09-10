import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONSUMPTION_RENDERER_GLOBAL,
  CONSUMPTION_RENDERER_METHODS,
  createConsumptionIpcHandlers,
  createConsumptionRendererSurface,
} from '../src/core-integration/consumptionIpcContract.mjs';
import { CONSUMPTION_MODULE_DESCRIPTOR } from '../src/core-integration/consumptionModuleDescriptor.mjs';

const require = createRequire(import.meta.url);
const CORE_ROOT = fileURLToPath(new URL('../../../01_source/token-monitor/', import.meta.url));
const { createNexaModuleRegistry } = require(path.join(CORE_ROOT, 'src/shared/nexaModuleRegistry.js'));
const { createNexaIpcRegistrationPlan } = require(path.join(CORE_ROOT, 'src/electron/nexaIpcRegistration.js'));

test('IPC contract contains only two static invoke channels and no push channel', () => {
  assert.deepEqual(CONSUMPTION_MODULE_DESCRIPTOR.invokeChannels, [
    'nexa:consumption:get-snapshot',
    'nexa:consumption:execute',
  ]);
  assert.deepEqual(CONSUMPTION_MODULE_DESCRIPTOR.pushChannels, []);
});

test('Renderer surface is frozen, minimal, and invokes only static channels', async () => {
  const calls = [];
  const surface = createConsumptionRendererSurface((channel, ...args) => {
    calls.push([channel, ...args]);
    return Promise.resolve({ ok: true });
  });
  const command = { type: 'query', payload: { options: {} } };
  await surface.getSnapshot();
  await surface.execute(command);
  assert.deepEqual(Object.keys(surface).sort(), ['execute', 'getSnapshot']);
  assert.equal(Object.isFrozen(surface), true);
  assert.equal(CONSUMPTION_RENDERER_GLOBAL, 'window.tokenMonitor.nexa.consumption');
  assert.deepEqual(CONSUMPTION_RENDERER_METHODS, ['getSnapshot', 'execute']);
  assert.deepEqual(calls, [
    ['nexa:consumption:get-snapshot'],
    ['nexa:consumption:execute', command],
  ]);
});

test('IPC handlers produce safe NexaResult envelopes without leaking errors', async () => {
  const host = {
    getModuleSnapshot(moduleId) {
      assert.equal(moduleId, 'consumption');
      return { moduleId, lifecycle: 'running' };
    },
    executeModule(moduleId, command) {
      assert.equal(moduleId, 'consumption');
      if (command.type === 'fail') {
        const error = new Error('private E:\\secret\\records.json');
        error.code = 'SYNTHETIC_FAILURE';
        throw error;
      }
      return { accepted: true };
    },
  };
  const handlers = createConsumptionIpcHandlers(host);
  const snapshot = await handlers['nexa:consumption:get-snapshot']({ sender: 'not-exposed' });
  const success = await handlers['nexa:consumption:execute']({}, { type: 'query' });
  const failure = await handlers['nexa:consumption:execute']({}, { type: 'fail' });
  const invalid = await handlers['nexa:consumption:get-snapshot']({}, 'unexpected');
  assert.equal(snapshot.ok, true);
  assert.equal(success.ok, true);
  assert.deepEqual(failure, {
    ok: false,
    error: { code: 'SYNTHETIC_FAILURE', message: 'Consumption request failed' },
  });
  assert.equal(JSON.stringify(failure).includes('secret'), false);
  assert.equal(invalid.error.code, 'INVALID_IPC_ARGUMENTS');
});

test('real Core Static IPC Plan accepts the handler map exactly', () => {
  const registry = createNexaModuleRegistry([CONSUMPTION_MODULE_DESCRIPTOR], { reservedChannels: [] });
  const handlers = createConsumptionIpcHandlers({
    getModuleSnapshot() { return {}; },
    executeModule() { return {}; },
  });
  const plan = createNexaIpcRegistrationPlan(registry, handlers);
  assert.deepEqual(plan.listInvokeChannels(), [
    'nexa:consumption:execute',
    'nexa:consumption:get-snapshot',
  ]);
  assert.deepEqual(plan.listPushChannels(), []);
});
