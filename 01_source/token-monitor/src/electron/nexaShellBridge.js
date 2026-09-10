'use strict';

const { createNexaControllerBinding } = require('../shared/nexaControllerBinding');
const { createNexaModuleRegistry } = require('../shared/nexaModuleRegistry');
const { createNexaShellHost } = require('../shared/nexaShellHost');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

class NexaElectronShellBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaElectronShellBridgeError';
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new NexaElectronShellBridgeError(code, message);
}

function createDefaultEmptyHost() {
  const registry = createNexaModuleRegistry([], EMPTY_CONTEXT);
  const binding = createNexaControllerBinding(registry, {});
  return createNexaShellHost(binding);
}

function validateHost(host) {
  if (!host || (typeof host !== 'object' && typeof host !== 'function') ||
      typeof host.stopAll !== 'function') {
    throw bridgeError('INVALID_HOST', 'host must expose a stopAll function');
  }
}

function createEmptyNexaElectronShellBridge(options = {}) {
  const host = Object.prototype.hasOwnProperty.call(options, 'host')
    ? options.host
    : createDefaultEmptyHost();
  validateHost(host);

  let state = 'created';
  let startPromise = null;
  let stopPromise = null;

  function start() {
    if (state === 'stopped' || state === 'stopping') {
      return Promise.reject(bridgeError('BRIDGE_STOPPED', 'bridge cannot start after shutdown'));
    }
    if (startPromise) return startPromise;
    if (state === 'started') return Promise.resolve();

    state = 'started';
    const attempt = Promise.resolve();
    startPromise = attempt;
    attempt.then(() => {
      if (startPromise === attempt) startPromise = null;
    });
    return attempt;
  }

  function stop() {
    if (state === 'stopped') return Promise.resolve();
    if (stopPromise) return stopPromise;

    const resumableState = state;
    state = 'stopping';
    let attempt;
    attempt = Promise.resolve()
      .then(() => host.stopAll())
      .then(
        (result) => {
          state = 'stopped';
          return result;
        },
        (error) => {
          state = resumableState;
          throw error;
        }
      );
    stopPromise = attempt;
    attempt.then(
      () => {
        if (stopPromise === attempt) stopPromise = null;
      },
      () => {
        if (stopPromise === attempt) stopPromise = null;
      }
    );
    return attempt;
  }

  return Object.freeze({ start, stop });
}

module.exports = {
  NexaElectronShellBridgeError,
  createEmptyNexaElectronShellBridge
};
