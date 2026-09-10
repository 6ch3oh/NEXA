'use strict';

const DEVICE_CAPABILITY_STATES = Object.freeze([
  'NO_DEVICE',
  'NO_DATA',
  'COLLECTOR_UNAVAILABLE',
  'NETWORK_UNREACHABLE',
  'PERMISSION_UNSUPPORTED',
  'SOURCE_NOT_CONFIGURED',
  'STALE',
  'PARTIAL',
  'READY'
]);

const LOCAL_DATA_STATES = Object.freeze([
  'AVAILABLE',
  'UNSUPPORTED',
  'UNAVAILABLE',
  'NOT_PROBED',
  'NO_DEVICE',
  'COLLECTOR_ERROR',
  'PERMISSION_RESTRICTED'
]);

function classifyDeviceCapability(input = {}) {
  if (input.deviceRequired === true && input.hasDevice === false) return 'NO_DEVICE';
  if (input.sourceConfigured === false) return 'SOURCE_NOT_CONFIGURED';
  if (input.permissionSupported === false) return 'PERMISSION_UNSUPPORTED';
  if (input.collectorAvailable === false) return 'COLLECTOR_UNAVAILABLE';
  if (input.networkReachable === false) return 'NETWORK_UNREACHABLE';
  if (input.hasData === false) return 'NO_DATA';
  if (input.stale === true) return 'STALE';
  if (input.partial === true) return 'PARTIAL';
  return 'READY';
}

function classifyLocalDataState(input = {}) {
  if (input.devicePresent === false) return 'NO_DEVICE';
  if (input.probed === false) return 'NOT_PROBED';
  if (input.availability === 'unsupported') return 'UNSUPPORTED';
  const reason = String(input.reason || '');
  if (/access[ _-]?denied|permission|unauthori[sz]ed|eacces|eperm/i.test(reason)) {
    return 'PERMISSION_RESTRICTED';
  }
  if (input.availability === 'error' || /collector[ _-]?(?:error|failed)|collection[ _-]?failed/i.test(reason)) {
    return 'COLLECTOR_ERROR';
  }
  if (input.availability === 'available') return 'AVAILABLE';
  return 'UNAVAILABLE';
}

module.exports = {
  DEVICE_CAPABILITY_STATES,
  LOCAL_DATA_STATES,
  classifyDeviceCapability,
  classifyLocalDataState
};
