'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PRODUCT_STATES, projectNexaModuleReadiness } = require('../../src/shared/nexaModuleReadiness');

test('exports exactly the frozen product readiness states', () => {
  assert.deepEqual([...PRODUCT_STATES], ['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);
});

test('projects lifecycle fallback without inventing module health', () => {
  assert.deepEqual(projectNexaModuleReadiness({ enabled: true, runtimeStatus: 'running' }), { state: 'READY' });
  assert.deepEqual(projectNexaModuleReadiness({ enabled: true, runtimeStatus: 'starting' }), {
    state: 'LIMITED', code: 'MODULE_STARTING'
  });
  assert.deepEqual(projectNexaModuleReadiness({ enabled: true, runtimeStatus: 'stopping' }), {
    state: 'LIMITED', code: 'MODULE_STOPPING'
  });
  assert.deepEqual(projectNexaModuleReadiness({ enabled: true, runtimeStatus: 'inactive' }), {
    state: 'OFFLINE', code: 'MODULE_INACTIVE'
  });
});

test('disabled and failed lifecycle states fail closed with stable codes', () => {
  assert.deepEqual(projectNexaModuleReadiness({ enabled: false, runtimeStatus: 'inactive' }), {
    state: 'OFFLINE', code: 'MODULE_DISABLED'
  });
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: false, runtimeStatus: 'error', errorCode: 'STOP_FAILED'
  }), { state: 'ERROR', code: 'STOP_FAILED' });
  assert.deepEqual(projectNexaModuleReadiness({ enabled: true, runtimeStatus: 'unknown' }), {
    state: 'ERROR', code: 'INVALID_RUNTIME_STATUS'
  });
});

test('preserves bounded public readiness and supports the Device Center handoff shape', () => {
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: true, runtimeStatus: 'inactive', readiness: { ready: true, code: 'READY' }
  }), { state: 'READY' });
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: true,
    runtimeStatus: 'running',
    readiness: { state: 'LIMITED', code: 'SOURCE_DEGRADED', private: 'discarded' }
  }), { state: 'LIMITED', code: 'SOURCE_DEGRADED' });
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: true,
    runtimeStatus: 'running',
    readiness: { ready: false, code: 'DEVICE_CENTER_PUBLIC_API_UNAVAILABLE' }
  }), { state: 'UNAVAILABLE', code: 'DEVICE_CENTER_PUBLIC_API_UNAVAILABLE' });
});

test('malformed public readiness becomes a bounded error projection', () => {
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: true, runtimeStatus: 'running', readiness: { state: 'future-state', code: 'RAW' }
  }), { state: 'ERROR', code: 'INVALID_MODULE_READINESS' });
  assert.deepEqual(projectNexaModuleReadiness({
    enabled: true, runtimeStatus: 'running', readiness: { ready: false, code: '../secret' }
  }), { state: 'UNAVAILABLE', code: 'MODULE_UNAVAILABLE' });
});
