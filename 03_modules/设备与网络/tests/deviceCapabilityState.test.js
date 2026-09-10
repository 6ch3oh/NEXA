'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEVICE_CAPABILITY_STATES,
  LOCAL_DATA_STATES,
  classifyDeviceCapability,
  classifyLocalDataState
} = require('../src');

test('Device capability state taxonomy is frozen and complete', () => {
  assert.deepEqual(DEVICE_CAPABILITY_STATES, [
    'NO_DEVICE', 'NO_DATA', 'COLLECTOR_UNAVAILABLE', 'NETWORK_UNREACHABLE',
    'PERMISSION_UNSUPPORTED', 'SOURCE_NOT_CONFIGURED', 'STALE', 'PARTIAL', 'READY'
  ]);
});

for (const [expected, input] of [
  ['NO_DEVICE', { deviceRequired: true, hasDevice: false }],
  ['NO_DATA', { hasData: false }],
  ['COLLECTOR_UNAVAILABLE', { collectorAvailable: false }],
  ['NETWORK_UNREACHABLE', { networkReachable: false }],
  ['PERMISSION_UNSUPPORTED', { permissionSupported: false }],
  ['SOURCE_NOT_CONFIGURED', { sourceConfigured: false }],
  ['STALE', { stale: true }],
  ['PARTIAL', { partial: true }],
  ['READY', {}]
]) {
  test(`${expected} remains distinguishable`, () => {
    assert.equal(classifyDeviceCapability(input), expected);
  });
}

test('Local data state taxonomy preserves each product truth state', () => {
  assert.deepEqual(LOCAL_DATA_STATES, [
    'AVAILABLE', 'UNSUPPORTED', 'UNAVAILABLE', 'NOT_PROBED', 'NO_DEVICE',
    'COLLECTOR_ERROR', 'PERMISSION_RESTRICTED'
  ]);
});

for (const [expected, input] of [
  ['AVAILABLE', { availability: 'available' }],
  ['UNSUPPORTED', { availability: 'unsupported' }],
  ['UNAVAILABLE', { availability: 'unavailable' }],
  ['NOT_PROBED', { probed: false }],
  ['NO_DEVICE', { devicePresent: false }],
  ['COLLECTOR_ERROR', { availability: 'error', reason: 'COLLECTOR_FAILED' }],
  ['PERMISSION_RESTRICTED', { availability: 'unavailable', reason: 'ACCESS_DENIED' }]
]) {
  test(`local data state ${expected} remains distinguishable`, () => {
    assert.equal(classifyLocalDataState(input), expected);
  });
}
