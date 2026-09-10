import {
  CONSUMPTION_IPC_CHANNELS,
  CONSUMPTION_MODULE_ID,
} from './consumptionModuleDescriptor.mjs';

export const CONSUMPTION_IPC_CONTRACT_VERSION = '0.4';
export const CONSUMPTION_RENDERER_GLOBAL = 'window.tokenMonitor.nexa.consumption';
export const CONSUMPTION_RENDERER_METHODS = Object.freeze(['getSnapshot', 'execute']);

function ipcError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function validateShellHost(shellHost) {
  if (
    !shellHost
    || typeof shellHost !== 'object'
    || typeof shellHost.getModuleSnapshot !== 'function'
    || typeof shellHost.executeModule !== 'function'
  ) {
    throw ipcError('INVALID_SHELL_HOST', 'IPC handlers require the Core Shell Host surface');
  }
}

function safeError(error) {
  return Object.freeze({
    code: typeof error?.code === 'string' ? error.code : 'CONSUMPTION_REQUEST_FAILED',
    message: 'Consumption request failed',
  });
}

async function asNexaResult(operation) {
  try {
    return Object.freeze({ ok: true, value: await operation() });
  } catch (error) {
    return Object.freeze({ ok: false, error: safeError(error) });
  }
}

export function createConsumptionIpcHandlers(shellHost) {
  validateShellHost(shellHost);
  return Object.freeze({
    'nexa:consumption:get-snapshot': (_event, ...args) => asNexaResult(() => {
      if (args.length !== 0) {
        throw ipcError('INVALID_IPC_ARGUMENTS', 'get-snapshot accepts no arguments');
      }
      return shellHost.getModuleSnapshot(CONSUMPTION_MODULE_ID) ?? null;
    }),
    'nexa:consumption:execute': (_event, ...args) => asNexaResult(() => {
      if (args.length !== 1) {
        throw ipcError('INVALID_IPC_ARGUMENTS', 'execute requires exactly one command');
      }
      return shellHost.executeModule(CONSUMPTION_MODULE_ID, args[0]);
    }),
  });
}

export function createConsumptionRendererSurface(invoke) {
  if (typeof invoke !== 'function') {
    throw ipcError('INVALID_RENDERER_INVOKE', 'Renderer surface requires an invoke function');
  }
  return Object.freeze({
    getSnapshot: () => invoke(CONSUMPTION_IPC_CHANNELS.getSnapshot),
    execute: (command) => invoke(CONSUMPTION_IPC_CHANNELS.execute, command),
  });
}
