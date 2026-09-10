'use strict';

const PLAN_STATE = new WeakMap();

class NexaIpcRegistrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaIpcRegistrationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaIpcRegistrationError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotRegistryChannels(registry) {
  let getInvokeChannels;
  let getPushChannels;
  try {
    getInvokeChannels = registry?.getInvokeChannels;
    getPushChannels = registry?.getPushChannels;
  } catch {
    fail('INVALID_REGISTRY', 'registry channel accessors could not be read');
  }

  if (typeof getInvokeChannels !== 'function' || typeof getPushChannels !== 'function') {
    fail('INVALID_REGISTRY', 'registry must provide getInvokeChannels and getPushChannels');
  }

  let invokeChannels;
  let pushChannels;
  try {
    invokeChannels = getInvokeChannels.call(registry);
    pushChannels = getPushChannels.call(registry);
  } catch {
    fail('INVALID_REGISTRY', 'registry channel queries failed');
  }

  if (!Array.isArray(invokeChannels) || !Array.isArray(pushChannels)) {
    fail('INVALID_REGISTRY', 'registry channel queries must return arrays');
  }

  const seenChannels = new Set();
  function snapshot(channels) {
    const result = [];
    for (const channel of channels) {
      if (typeof channel !== 'string' || !channel.startsWith('nexa:') || seenChannels.has(channel)) {
        fail('INVALID_REGISTRY', 'registry returned an invalid or duplicate NEXA channel');
      }
      seenChannels.add(channel);
      result.push(channel);
    }
    return Object.freeze(result.sort());
  }

  return Object.freeze({
    invokeChannels: snapshot(invokeChannels),
    pushChannels: snapshot(pushChannels)
  });
}

function snapshotInvokeHandlers(invokeHandlers) {
  let entries;
  try {
    if (invokeHandlers instanceof Map) {
      entries = [...invokeHandlers.entries()];
    } else if (isPlainObject(invokeHandlers)) {
      const ownKeys = Reflect.ownKeys(invokeHandlers);
      const enumerableKeys = Object.keys(invokeHandlers);
      if (ownKeys.length !== enumerableKeys.length || ownKeys.some((key) => typeof key !== 'string')) {
        fail('INVALID_INVOKE_HANDLERS', 'invoke handler objects must contain only enumerable string keys');
      }
      entries = enumerableKeys.map((channel) => [channel, invokeHandlers[channel]]);
    } else {
      fail('INVALID_INVOKE_HANDLERS', 'invokeHandlers must be a plain object or Map');
    }
  } catch (error) {
    if (error instanceof NexaIpcRegistrationError) throw error;
    fail('INVALID_INVOKE_HANDLERS', 'invokeHandlers could not be inspected');
  }

  const handlers = new Map();
  for (const [channel, handler] of entries) {
    if (typeof channel !== 'string') {
      fail('INVALID_INVOKE_HANDLERS', 'invoke handler channels must be strings');
    }
    if (handlers.has(channel)) {
      fail('INVALID_INVOKE_HANDLERS', 'invokeHandlers contains a duplicate channel');
    }
    handlers.set(channel, handler);
  }
  return handlers;
}

function createNexaIpcRegistrationPlan(registry, invokeHandlers) {
  const { invokeChannels, pushChannels } = snapshotRegistryChannels(registry);
  const handlers = snapshotInvokeHandlers(invokeHandlers);
  const expectedChannels = new Set(invokeChannels);

  for (const channel of invokeChannels) {
    if (!handlers.has(channel)) {
      fail('MISSING_INVOKE_HANDLER', `missing invoke handler for registry channel: ${channel}`);
    }
  }

  for (const channel of [...handlers.keys()].sort()) {
    if (!expectedChannels.has(channel)) {
      fail('UNEXPECTED_INVOKE_HANDLER', `invoke handler is not declared by the registry: ${channel}`);
    }
  }

  const bindings = Object.freeze(invokeChannels.map((channel) => {
    const handler = handlers.get(channel);
    if (typeof handler !== 'function') {
      fail('INVALID_INVOKE_HANDLER', `invoke handler must be a function: ${channel}`);
    }
    return Object.freeze({ channel, handler });
  }));

  const plan = Object.freeze({
    listInvokeChannels() {
      return [...invokeChannels];
    },

    listPushChannels() {
      return [...pushChannels];
    }
  });

  PLAN_STATE.set(plan, Object.freeze({ bindings }));
  return plan;
}

function validateIpcMain(ipcMain) {
  let handle;
  let removeHandler;
  try {
    handle = ipcMain?.handle;
    removeHandler = ipcMain?.removeHandler;
  } catch {
    fail('INVALID_IPC_MAIN', 'ipcMain adapter methods could not be read');
  }
  if (typeof handle !== 'function' || typeof removeHandler !== 'function') {
    fail('INVALID_IPC_MAIN', 'ipcMain must provide handle and removeHandler functions');
  }
}

async function rollbackRegisteredChannels(registeredChannels, ipcMain) {
  const failures = [];
  for (let index = registeredChannels.length - 1; index >= 0; index -= 1) {
    const channel = registeredChannels[index];
    try {
      await ipcMain.removeHandler(channel);
    } catch {
      failures.push(channel);
    }
  }
  return failures;
}

function createRegistrationHandle(registeredChannels, ipcMain) {
  const removalOrder = Object.freeze([...registeredChannels].reverse());
  const pendingChannels = new Set(registeredChannels);
  let disposed = false;
  let disposePromise = null;

  function dispose() {
    if (disposed) return Promise.resolve();
    if (disposePromise) return disposePromise;

    disposePromise = (async () => {
      const failures = [];
      for (const channel of removalOrder) {
        if (!pendingChannels.has(channel)) continue;
        try {
          await ipcMain.removeHandler(channel);
          pendingChannels.delete(channel);
        } catch {
          failures.push(channel);
        }
      }

      if (failures.length > 0) {
        fail('IPC_DISPOSE_INCOMPLETE', 'one or more NEXA IPC handlers could not be removed');
      }
      disposed = true;
    })().finally(() => {
      disposePromise = null;
    });

    return disposePromise;
  }

  return Object.freeze({ dispose });
}

async function applyNexaIpcRegistrationPlan(plan, ipcMain) {
  const planState = PLAN_STATE.get(plan);
  if (!planState) {
    fail('INVALID_REGISTRY', 'plan was not created by createNexaIpcRegistrationPlan');
  }
  validateIpcMain(ipcMain);

  const registeredChannels = [];
  for (const { channel, handler } of planState.bindings) {
    try {
      await ipcMain.handle(channel, handler);
      registeredChannels.push(channel);
    } catch {
      const rollbackFailures = await rollbackRegisteredChannels(registeredChannels, ipcMain);
      if (rollbackFailures.length > 0) {
        fail('IPC_REGISTRATION_ROLLBACK_FAILED', 'NEXA IPC registration failed and rollback was incomplete');
      }
      fail('IPC_REGISTRATION_FAILED', 'NEXA IPC registration failed');
    }
  }

  return createRegistrationHandle(registeredChannels, ipcMain);
}

module.exports = {
  NexaIpcRegistrationError,
  applyNexaIpcRegistrationPlan,
  createNexaIpcRegistrationPlan
};
