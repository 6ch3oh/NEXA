'use strict';

const REQUIRED_REGISTRY_METHODS = ['has', 'get', 'listModuleIds'];
const REQUIRED_CONTROLLER_METHODS = ['start', 'stop', 'getSnapshot', 'execute'];

class NexaControllerBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaControllerBindingError';
    this.code = code;
  }
}

function bindingError(code, message) {
  return new NexaControllerBindingError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidRegistry(message) {
  throw bindingError('INVALID_REGISTRY', message);
}

function readRegistryModuleIds(registry) {
  if (!registry || (typeof registry !== 'object' && typeof registry !== 'function')) {
    invalidRegistry('registry must expose has, get, and listModuleIds functions');
  }
  for (const method of REQUIRED_REGISTRY_METHODS) {
    if (typeof registry[method] !== 'function') {
      invalidRegistry('registry must expose has, get, and listModuleIds functions');
    }
  }

  let moduleIds;
  try {
    moduleIds = registry.listModuleIds();
  } catch {
    invalidRegistry('registry listModuleIds must return a valid module ID array');
  }
  if (!Array.isArray(moduleIds)) {
    invalidRegistry('registry listModuleIds must return a valid module ID array');
  }

  const uniqueModuleIds = new Set();
  for (const moduleId of moduleIds) {
    if (typeof moduleId !== 'string' || moduleId.length === 0 || uniqueModuleIds.has(moduleId)) {
      invalidRegistry('registry listModuleIds must return unique non-empty strings');
    }
    uniqueModuleIds.add(moduleId);

    let isPresent;
    let descriptor;
    try {
      isPresent = registry.has(moduleId);
      descriptor = registry.get(moduleId);
    } catch {
      invalidRegistry(`registry queries failed for module ${moduleId}`);
    }
    if (isPresent !== true || !descriptor || descriptor.moduleId !== moduleId) {
      invalidRegistry(`registry is inconsistent for module ${moduleId}`);
    }
  }

  return [...moduleIds];
}

function snapshotControllerFactories(moduleIds, controllerFactories) {
  if (!isPlainObject(controllerFactories)) {
    throw bindingError(
      'INVALID_CONTROLLER_FACTORIES',
      'controllerFactories must be a plain object'
    );
  }

  const propertyDescriptors = Object.getOwnPropertyDescriptors(controllerFactories);
  const factoryKeys = Reflect.ownKeys(propertyDescriptors);
  if (factoryKeys.some((key) => typeof key !== 'string')) {
    throw bindingError(
      'INVALID_CONTROLLER_FACTORIES',
      'controllerFactories must use string module ID keys'
    );
  }

  const requiredModuleIds = new Set(moduleIds);
  for (const moduleId of moduleIds) {
    if (!Object.prototype.hasOwnProperty.call(propertyDescriptors, moduleId)) {
      throw bindingError(
        'MISSING_CONTROLLER_FACTORY',
        `controller factory is missing for module ${moduleId}`
      );
    }
  }
  for (const factoryKey of factoryKeys) {
    if (!requiredModuleIds.has(factoryKey)) {
      throw bindingError(
        'UNEXPECTED_CONTROLLER_FACTORY',
        `controller factory has no registry module ${factoryKey}`
      );
    }
  }

  const factoryByModuleId = new Map();
  for (const moduleId of moduleIds) {
    const propertyDescriptor = propertyDescriptors[moduleId];
    if (!Object.prototype.hasOwnProperty.call(propertyDescriptor, 'value') ||
        typeof propertyDescriptor.value !== 'function') {
      throw bindingError(
        'INVALID_CONTROLLER_FACTORY',
        `controller factory for module ${moduleId} must be a function value`
      );
    }
    factoryByModuleId.set(moduleId, propertyDescriptor.value);
  }
  return factoryByModuleId;
}

function validateController(moduleId, controller) {
  if (!controller || (typeof controller !== 'object' && typeof controller !== 'function')) {
    throw bindingError('INVALID_CONTROLLER', `factory for module ${moduleId} returned an invalid controller`);
  }
  for (const method of REQUIRED_CONTROLLER_METHODS) {
    if (typeof controller[method] !== 'function') {
      throw bindingError(
        'INVALID_CONTROLLER',
        `controller for module ${moduleId} requires a ${method} function`
      );
    }
  }
}

function createNexaControllerBinding(registry, controllerFactories) {
  const moduleIds = readRegistryModuleIds(registry);
  const factoryByModuleId = snapshotControllerFactories(moduleIds, controllerFactories);

  function has(moduleId) {
    return typeof moduleId === 'string' && registry.has(moduleId);
  }

  function getDescriptor(moduleId) {
    if (typeof moduleId !== 'string') return undefined;
    return registry.get(moduleId);
  }

  function listModuleIds() {
    return registry.listModuleIds();
  }

  function createController(moduleId) {
    if (typeof moduleId !== 'string' || !registry.has(moduleId)) {
      throw bindingError('MODULE_NOT_FOUND', `module ${String(moduleId)} is not registered`);
    }
    const controller = factoryByModuleId.get(moduleId)();
    validateController(moduleId, controller);
    return controller;
  }

  return Object.freeze({ has, getDescriptor, listModuleIds, createController });
}

module.exports = {
  NexaControllerBindingError,
  createNexaControllerBinding
};
