'use strict';

const REQUIRED_HOOKS = ['start', 'stop', 'getSnapshot', 'execute'];

class NexaModuleControllerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaModuleControllerError';
    this.code = code;
  }
}

function controllerError(code, message) {
  return new NexaModuleControllerError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateImplementation(implementation) {
  if (!isPlainObject(implementation)) {
    throw controllerError('INVALID_CONTROLLER_IMPLEMENTATION', 'controller implementation must be a plain object');
  }
  for (const hook of REQUIRED_HOOKS) {
    if (typeof implementation[hook] !== 'function') {
      throw controllerError(
        'INVALID_CONTROLLER_IMPLEMENTATION',
        `controller implementation requires a ${hook} function`
      );
    }
  }
}

function lifecycleContext(generation, state) {
  return Object.freeze({ generation, state });
}

function createNexaModuleController(implementation) {
  validateImplementation(implementation);

  const hooks = Object.freeze({
    start: implementation.start.bind(implementation),
    stop: implementation.stop.bind(implementation),
    getSnapshot: implementation.getSnapshot.bind(implementation),
    execute: implementation.execute.bind(implementation)
  });

  let state = 'created';
  let nextGeneration = 1;
  let activeGeneration = null;
  let cleanupGeneration = null;
  let startPromise = null;
  let stopPromise = null;
  let startResult;

  function staleGenerationError(generation) {
    return controllerError('STALE_GENERATION', `controller generation ${generation} is no longer active`);
  }

  function start() {
    if (state === 'running') return Promise.resolve(startResult);
    if (state === 'starting') return startPromise;
    if (state === 'stopping' || state === 'stop-incomplete') {
      return Promise.reject(controllerError(
        'STOP_INCOMPLETE',
        'controller cleanup must complete before it can start again'
      ));
    }

    const generation = nextGeneration++;
    activeGeneration = generation;
    cleanupGeneration = null;
    state = 'starting';
    const context = lifecycleContext(generation, 'starting');

    let attempt;
    attempt = Promise.resolve()
      .then(() => hooks.start(context))
      .then(
        (result) => {
          if (activeGeneration !== generation || state !== 'starting') {
            if (startPromise === attempt) startPromise = null;
            throw staleGenerationError(generation);
          }
          state = 'running';
          startResult = result;
          if (startPromise === attempt) startPromise = null;
          return result;
        },
        (error) => {
          const isCurrentAttempt = activeGeneration === generation && state === 'starting';
          if (isCurrentAttempt) {
            activeGeneration = null;
            state = 'faulted';
          }
          if (startPromise === attempt) startPromise = null;
          if (!isCurrentAttempt) throw staleGenerationError(generation);
          throw error;
        }
      );
    startPromise = attempt;
    return attempt;
  }

  function runStop(generation) {
    const context = lifecycleContext(generation, 'stopping');
    state = 'stopping';

    let attempt;
    attempt = Promise.resolve()
      .then(() => hooks.stop(context))
      .then(
        (result) => {
          if (stopPromise === attempt) stopPromise = null;
          cleanupGeneration = null;
          state = 'stopped';
          return result;
        },
        (error) => {
          if (stopPromise === attempt) stopPromise = null;
          state = 'stop-incomplete';
          throw error;
        }
      );
    stopPromise = attempt;
    return attempt;
  }

  function stop() {
    if (state === 'stopping') return stopPromise;
    if (state === 'stop-incomplete') return runStop(cleanupGeneration);
    if (state === 'created' || state === 'stopped' || state === 'faulted') {
      activeGeneration = null;
      state = 'stopped';
      return Promise.resolve();
    }

    cleanupGeneration = activeGeneration;
    activeGeneration = null;
    return runStop(cleanupGeneration);
  }

  function getSnapshot() {
    return hooks.getSnapshot(lifecycleContext(activeGeneration, state));
  }

  function execute(command) {
    if (state !== 'running' || activeGeneration === null) {
      return Promise.reject(controllerError('CONTROLLER_NOT_RUNNING', 'controller is not running'));
    }

    const generation = activeGeneration;
    const context = lifecycleContext(generation, 'running');
    return Promise.resolve()
      .then(() => hooks.execute(command, context))
      .then(
        (result) => {
          if (state !== 'running' || activeGeneration !== generation) {
            throw staleGenerationError(generation);
          }
          return result;
        },
        (error) => {
          if (state !== 'running' || activeGeneration !== generation) {
            throw staleGenerationError(generation);
          }
          throw error;
        }
      );
  }

  return Object.freeze({ start, stop, getSnapshot, execute });
}

module.exports = {
  NexaModuleControllerError,
  createNexaModuleController
};
