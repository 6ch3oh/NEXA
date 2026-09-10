import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONSUMPTION_IPC_CHANNELS,
  CONSUMPTION_MODULE_DESCRIPTOR,
} from '../src/core-integration/consumptionModuleDescriptor.mjs';

const require = createRequire(import.meta.url);
const CORE_ROOT = fileURLToPath(new URL('../../../01_source/token-monitor/', import.meta.url));
const { validateNexaModuleDescriptor } = require(path.join(CORE_ROOT, 'src/shared/nexaModuleDescriptor.js'));
const { createNexaModuleRegistry } = require(path.join(CORE_ROOT, 'src/shared/nexaModuleRegistry.js'));

test('Consumption descriptor has the exact Core Validator schema', () => {
  assert.deepEqual(Object.keys(CONSUMPTION_MODULE_DESCRIPTOR).sort(), [
    'contractVersion',
    'invokeChannels',
    'moduleId',
    'pushChannels',
  ]);
  assert.equal(CONSUMPTION_MODULE_DESCRIPTOR.moduleId, 'consumption');
  assert.equal(CONSUMPTION_MODULE_DESCRIPTOR.contractVersion, 1);
  assert.deepEqual(CONSUMPTION_MODULE_DESCRIPTOR.invokeChannels, [
    'nexa:consumption:get-snapshot',
    'nexa:consumption:execute',
  ]);
  assert.deepEqual(CONSUMPTION_MODULE_DESCRIPTOR.pushChannels, []);
  assert.equal(Object.isFrozen(CONSUMPTION_MODULE_DESCRIPTOR), true);
  assert.equal(Object.isFrozen(CONSUMPTION_MODULE_DESCRIPTOR.invokeChannels), true);
});

test('real Core Descriptor Validator accepts the static Consumption descriptor', () => {
  const validated = validateNexaModuleDescriptor(CONSUMPTION_MODULE_DESCRIPTOR, {
    reservedChannels: ['settings:get', 'expense:get'],
  });
  assert.deepEqual(validated, {
    moduleId: 'consumption',
    contractVersion: 1,
    invokeChannels: [CONSUMPTION_IPC_CHANNELS.getSnapshot, CONSUMPTION_IPC_CHANNELS.execute],
    pushChannels: [],
  });
});

test('real Core Static Registry accepts and snapshots the descriptor deterministically', () => {
  const registry = createNexaModuleRegistry([CONSUMPTION_MODULE_DESCRIPTOR], { reservedChannels: [] });
  assert.deepEqual(registry.listModuleIds(), ['consumption']);
  assert.deepEqual(registry.getInvokeChannels(), [
    'nexa:consumption:execute',
    'nexa:consumption:get-snapshot',
  ]);
  assert.deepEqual(registry.getPushChannels(), []);
});
