'use strict';

const { LegacyDeviceAdapter } = require('./legacyDeviceAdapter');

const DEFAULT_LEGACY_HOST_TIMEOUT_MS = 2_000;

class LegacyDeviceHostBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LegacyDeviceHostBindingError';
    this.code = code;
  }
}

function bindingError(code, message) {
  return new LegacyDeviceHostBindingError(code, message);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveSnapshotCapability(hostApi) {
  if (!isObject(hostApi) || !isObject(hostApi.tokenMonitor)) {
    throw bindingError('HOST_API_UNAVAILABLE', 'Injected tokenMonitor host API is unavailable.');
  }
  if (!isObject(hostApi.tokenMonitor.nexa)) {
    throw bindingError('NEXA_API_UNAVAILABLE', 'Injected NEXA host API is unavailable.');
  }
  const moduleApi = hostApi.tokenMonitor.nexa['legacy-device'];
  if (!isObject(moduleApi)) {
    throw bindingError('LEGACY_DEVICE_MODULE_UNAVAILABLE', 'Legacy device host module is unavailable.');
  }
  if (typeof moduleApi.getSnapshot !== 'function') {
    throw bindingError('GET_SNAPSHOT_UNAVAILABLE', 'Legacy device getSnapshot capability is unavailable.');
  }
  return { moduleApi, getSnapshot: moduleApi.getSnapshot };
}

function createLegacyDeviceHostBinding(hostApi, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LEGACY_HOST_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError('Legacy host timeout must be an integer between 1 and 60000 ms.');
  }
  const scheduleTimeout = options.scheduleTimeout || setTimeout;
  const cancelTimeout = options.cancelTimeout || clearTimeout;
  if (typeof scheduleTimeout !== 'function' || typeof cancelTimeout !== 'function') {
    throw new TypeError('Legacy host timer functions are required.');
  }

  return Object.freeze({
    async getLegacyDeviceSnapshot() {
      let capability;
      try {
        capability = resolveSnapshotCapability(hostApi);
      } catch (error) {
        return Promise.reject(error);
      }

      const source = Promise.resolve().then(() => capability.getSnapshot.call(capability.moduleApi));
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          cancelTimeout(timeoutId);
          callback(value);
        };
        timeoutId = scheduleTimeout(() => finish(
          reject,
          bindingError('HOST_CALL_TIMEOUT', 'Legacy device host call timed out.')
        ), timeoutMs);
        source.then(
          (value) => finish(resolve, value),
          () => finish(reject, bindingError('HOST_CALL_FAILED', 'Legacy device host call failed safely.'))
        );
      });
    }
  });
}

function createLegacyDeviceLiveAdapter(hostApi, options = {}) {
  const binding = createLegacyDeviceHostBinding(hostApi, options.binding);
  return new LegacyDeviceAdapter(binding, options.adapter);
}

module.exports = {
  DEFAULT_LEGACY_HOST_TIMEOUT_MS,
  LegacyDeviceHostBindingError,
  createLegacyDeviceHostBinding,
  createLegacyDeviceLiveAdapter,
  resolveSnapshotCapability
};
