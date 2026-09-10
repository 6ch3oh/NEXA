'use strict';

const REQUIRED_BINDING_METHODS = [
  'has',
  'getDescriptor',
  'listModuleIds',
  'createController'
];

class NexaShellHostError extends Error {
  constructor(code, message, failedModuleIds) {
    super(message);
    this.name = 'NexaShellHostError';
    this.code = code;
    if (failedModuleIds) {
      this.failedModuleIds = Object.freeze([...failedModuleIds]);
    }
  }
}

function hostError(code, message, failedModuleIds) {
  return new NexaShellHostError(code, message, failedModuleIds);
}

function validateBinding(binding) {
  if (!binding || (typeof binding !== 'object' && typeof binding !== 'function')) {
    throw hostError('INVALID_BINDING', 'binding must expose the NEXA controller binding surface');
  }
  try {
    for (const method of REQUIRED_BINDING_METHODS) {
      if (typeof binding[method] !== 'function') {
        throw hostError('INVALID_BINDING', 'binding must expose the NEXA controller binding surface');
      }
    }
  } catch (error) {
    if (error instanceof NexaShellHostError) throw error;
    throw hostError('INVALID_BINDING', 'binding must expose the NEXA controller binding surface');
  }
}

function createNexaShellHost(binding) {
  validateBinding(binding);

  const controllers = new Map();
  const activeModuleIds = new Set();
  const activeOrder = [];
  const cleanupPending = new Set();
  const startingByModuleId = new Map();
  const stoppingByModuleId = new Map();
  let hostStopping = false;
  let stopAllPromise = null;

  function assertKnownModule(moduleId) {
    if (!binding.has(moduleId)) {
      throw hostError('MODULE_NOT_FOUND', `module ${String(moduleId)} is not registered`);
    }
  }

  function removeFromActiveOrder(moduleId) {
    const index = activeOrder.indexOf(moduleId);
    if (index !== -1) activeOrder.splice(index, 1);
  }

  function listModuleIds() {
    return binding.listModuleIds();
  }

  function getDescriptor(moduleId) {
    return binding.getDescriptor(moduleId);
  }

  function startModule(moduleId) {
    if (hostStopping) {
      return Promise.reject(hostError('HOST_STOPPING', 'host shutdown is in progress'));
    }

    let controller;
    try {
      assertKnownModule(moduleId);
      if (cleanupPending.has(moduleId) || stoppingByModuleId.has(moduleId)) {
        throw hostError(
          'MODULE_CLEANUP_PENDING',
          `module ${moduleId} must finish cleanup before it can start`
        );
      }
      const existingStart = startingByModuleId.get(moduleId);
      if (existingStart) return existingStart;

      controller = controllers.get(moduleId);
      if (!controller) {
        controller = binding.createController(moduleId);
        controllers.set(moduleId, controller);
      }
    } catch (error) {
      return Promise.reject(error);
    }

    let startResult;
    try {
      startResult = controller.start();
    } catch (error) {
      return Promise.reject(error);
    }

    let attempt;
    attempt = Promise.resolve(startResult).then((result) => {
      if (!activeModuleIds.has(moduleId)) {
        activeModuleIds.add(moduleId);
        activeOrder.push(moduleId);
      }
      return result;
    });
    startingByModuleId.set(moduleId, attempt);
    attempt.then(
      () => {
        if (startingByModuleId.get(moduleId) === attempt) startingByModuleId.delete(moduleId);
      },
      () => {
        if (startingByModuleId.get(moduleId) === attempt) startingByModuleId.delete(moduleId);
      }
    );
    return attempt;
  }

  function stopOwnedModule(moduleId) {
    const existingStop = stoppingByModuleId.get(moduleId);
    if (existingStop) return existingStop;

    let attempt;
    attempt = (async () => {
      const pendingStart = startingByModuleId.get(moduleId);
      if (pendingStart) {
        try {
          await pendingStart;
        } catch {
          return undefined;
        }
      }

      const controller = controllers.get(moduleId);
      if (!controller) return undefined;
      if (!activeModuleIds.has(moduleId) && !cleanupPending.has(moduleId)) return undefined;

      activeModuleIds.delete(moduleId);
      try {
        const result = await controller.stop();
        cleanupPending.delete(moduleId);
        removeFromActiveOrder(moduleId);
        return result;
      } catch (error) {
        cleanupPending.add(moduleId);
        throw error;
      }
    })();

    stoppingByModuleId.set(moduleId, attempt);
    attempt.then(
      () => {
        if (stoppingByModuleId.get(moduleId) === attempt) stoppingByModuleId.delete(moduleId);
      },
      () => {
        if (stoppingByModuleId.get(moduleId) === attempt) stoppingByModuleId.delete(moduleId);
      }
    );
    return attempt;
  }

  function stopModule(moduleId) {
    if (hostStopping) {
      return Promise.reject(hostError('HOST_STOPPING', 'host shutdown is in progress'));
    }
    try {
      assertKnownModule(moduleId);
    } catch (error) {
      return Promise.reject(error);
    }
    return stopOwnedModule(moduleId);
  }

  function getModuleSnapshot(moduleId) {
    assertKnownModule(moduleId);
    const controller = controllers.get(moduleId);
    return controller ? controller.getSnapshot() : undefined;
  }

  function executeModule(moduleId, command) {
    if (hostStopping) {
      return Promise.reject(hostError('HOST_STOPPING', 'host shutdown is in progress'));
    }
    try {
      assertKnownModule(moduleId);
      if (!activeModuleIds.has(moduleId) || cleanupPending.has(moduleId) ||
          stoppingByModuleId.has(moduleId)) {
        throw hostError('MODULE_NOT_ACTIVE', `module ${moduleId} is not active`);
      }
      return Promise.resolve(controllers.get(moduleId).execute(command));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function stopAll() {
    if (stopAllPromise) return stopAllPromise;
    hostStopping = true;

    let attempt;
    attempt = (async () => {
      await Promise.allSettled([...startingByModuleId.values()]);
      const stopOrder = [...activeOrder].reverse();

      for (const moduleId of stopOrder) {
        try {
          await stopOwnedModule(moduleId);
        } catch {
          // Continue so that one failed module cannot prevent other cleanup.
        }
      }

      const failedModuleIds = stopOrder.filter((moduleId) => cleanupPending.has(moduleId));
      if (failedModuleIds.length > 0) {
        throw hostError(
          'STOP_ALL_INCOMPLETE',
          `host cleanup remains incomplete for: ${failedModuleIds.join(', ')}`,
          failedModuleIds
        );
      }
    })();

    stopAllPromise = attempt.finally(() => {
      hostStopping = false;
      stopAllPromise = null;
    });
    return stopAllPromise;
  }

  return Object.freeze({
    listModuleIds,
    getDescriptor,
    startModule,
    stopModule,
    getModuleSnapshot,
    executeModule,
    stopAll
  });
}

module.exports = {
  NexaShellHostError,
  createNexaShellHost
};
