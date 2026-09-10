'use strict';

const { createNexaModuleController } = require('../shared/nexaModuleController');

const NEXA_CORE_CONTROL_DESCRIPTOR = Object.freeze({
  moduleId: 'core-control',
  contractVersion: 1,
  invokeChannels: Object.freeze([
    'nexa:core-control:get-snapshot',
    'nexa:core-control:set-enabled',
    'nexa:core-control:set-auto-start',
    'nexa:core-control:set-all-enabled',
    'nexa:core-control:set-all-auto-start',
    'nexa:core-control:toggle-window-maximize'
  ]),
  pushChannels: Object.freeze([])
});

class NexaCoreControlBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaCoreControlBridgeError';
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new NexaCoreControlBridgeError(code, message);
}

function validateControl(control) {
  for (const method of [
    'getSnapshot',
    'setEnabled',
    'setAutoStart',
    'setAllEnabled',
    'setAllAutoStart'
  ]) {
    if (typeof control?.[method] !== 'function') {
      throw bridgeError('INVALID_CONTROL', 'control must expose the NEXA module control surface');
    }
  }
}

function createNexaCoreControlController(getControl) {
  if (typeof getControl !== 'function') {
    throw bridgeError('INVALID_CONTROL_PROVIDER', 'getControl must be a function');
  }
  return createNexaModuleController({
    start() {},
    stop() {},
    getSnapshot() {
      const control = getControl();
      validateControl(control);
      return control.getSnapshot();
    },
    execute(command) {
      const control = getControl();
      validateControl(control);
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw bridgeError('INVALID_COMMAND', 'Core control command must be an object');
      }
      switch (command.type) {
        case 'set-enabled':
          return control.setEnabled(command.moduleId, command.enabled);
        case 'set-auto-start':
          return control.setAutoStart(command.moduleId, command.autoStart);
        case 'set-all-enabled':
          return control.setAllEnabled(command.enabled);
        case 'set-all-auto-start':
          return control.setAllAutoStart(command.autoStart);
        default:
          throw bridgeError('UNKNOWN_COMMAND', 'Core control command is not supported');
      }
    }
  });
}

function createNexaCoreControlIpcHandlers(host, options = {}) {
  if (!host || typeof host.startModule !== 'function' ||
      typeof host.getModuleSnapshot !== 'function' || typeof host.executeModule !== 'function') {
    throw bridgeError('INVALID_HOST', 'host must expose the NEXA Shell Host surface');
  }

  async function getSnapshot() {
    await host.startModule('core-control');
    return host.getModuleSnapshot('core-control');
  }

  async function execute(command) {
    await host.startModule('core-control');
    try {
      return await host.executeModule('core-control', command);
    } catch (error) {
      const safeCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
        ? error.code
        : 'CORE_CONTROL_FAILED';
      throw bridgeError(safeCode, 'Core module control request failed');
    }
  }

  return Object.freeze({
    'nexa:core-control:get-snapshot': getSnapshot,
    'nexa:core-control:set-enabled': (_event, moduleId, enabled) => execute({
      type: 'set-enabled', moduleId, enabled
    }),
    'nexa:core-control:set-auto-start': (_event, moduleId, autoStart) => execute({
      type: 'set-auto-start', moduleId, autoStart
    }),
    'nexa:core-control:set-all-enabled': (_event, enabled) => execute({
      type: 'set-all-enabled', enabled
    }),
    'nexa:core-control:set-all-auto-start': (_event, autoStart) => execute({
      type: 'set-all-auto-start', autoStart
    }),
    'nexa:core-control:toggle-window-maximize': (event) => {
      if (typeof options.toggleWindowMaximize !== 'function') return false;
      return options.toggleWindowMaximize(event) === true;
    }
  });
}

module.exports = {
  NEXA_CORE_CONTROL_DESCRIPTOR,
  NexaCoreControlBridgeError,
  createNexaCoreControlController,
  createNexaCoreControlIpcHandlers
};
