'use strict';

const { projectNexaModuleReadiness } = require('./nexaModuleReadiness');

const MODULE_CONTROL_VERSION = 1;
const DEFAULT_MODULE_CONTROL = Object.freeze({ enabled: true, autoStart: false });
const RUNTIME_STATUSES = new Set(['inactive', 'starting', 'running', 'stopping', 'error']);

class NexaModuleControlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaModuleControlError';
    this.code = code;
  }
}

function controlError(code, message) {
  return new NexaModuleControlError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateModuleIds(moduleIds) {
  if (!Array.isArray(moduleIds)) {
    throw controlError('INVALID_MODULE_IDS', 'moduleIds must be an array');
  }
  const result = [];
  const seen = new Set();
  for (const moduleId of moduleIds) {
    if (typeof moduleId !== 'string' || moduleId.length === 0 || seen.has(moduleId)) {
      throw controlError('INVALID_MODULE_IDS', 'moduleIds must contain unique non-empty strings');
    }
    seen.add(moduleId);
    result.push(moduleId);
  }
  return Object.freeze(result.sort());
}

function normalizeEntry(value) {
  if (!isPlainObject(value)) return { ...DEFAULT_MODULE_CONTROL };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_MODULE_CONTROL.enabled,
    autoStart: typeof value.autoStart === 'boolean' ? value.autoStart : DEFAULT_MODULE_CONTROL.autoStart
  };
}

function normalizeNexaModuleControlPreferences(moduleIds, value) {
  const ids = validateModuleIds(moduleIds);
  const source = isPlainObject(value) && value.version === MODULE_CONTROL_VERSION && isPlainObject(value.modules)
    ? value.modules
    : {};
  const modules = {};
  for (const moduleId of ids) modules[moduleId] = normalizeEntry(source[moduleId]);
  return Object.freeze({
    version: MODULE_CONTROL_VERSION,
    modules: Object.freeze(Object.fromEntries(
      Object.entries(modules).map(([moduleId, entry]) => [moduleId, Object.freeze(entry)])
    ))
  });
}

function clonePreferences(value) {
  return {
    version: MODULE_CONTROL_VERSION,
    modules: Object.fromEntries(
      Object.entries(value.modules).map(([moduleId, entry]) => [moduleId, { ...entry }])
    )
  };
}

function normalizeReadinessByModuleId(moduleIds, value) {
  if (value === undefined) return Object.freeze({});
  if (!isPlainObject(value)) {
    throw controlError('INVALID_MODULE_READINESS', 'readinessByModuleId must be a plain object');
  }
  const known = new Set(moduleIds);
  const result = {};
  for (const [moduleId, readiness] of Object.entries(value)) {
    if (!known.has(moduleId)) {
      throw controlError('INVALID_MODULE_READINESS', `readiness references unknown module ${moduleId}`);
    }
    if (typeof readiness === 'string') {
      result[moduleId] = readiness;
      continue;
    }
    if (!isPlainObject(readiness)) {
      throw controlError('INVALID_MODULE_READINESS', `readiness for ${moduleId} must be a string or plain object`);
    }
    result[moduleId] = Object.freeze({
      ...(typeof readiness.state === 'string' ? { state: readiness.state } : {}),
      ...(typeof readiness.ready === 'boolean' ? { ready: readiness.ready } : {}),
      ...(typeof readiness.code === 'string' ? { code: readiness.code } : {})
    });
  }
  return Object.freeze(result);
}

function safeErrorCode(error, fallback) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : fallback;
}

function createNexaModuleControl(options = {}) {
  const moduleIds = validateModuleIds(options.moduleIds);
  const known = new Set(moduleIds);
  const readinessByModuleId = normalizeReadinessByModuleId(moduleIds, options.readinessByModuleId);
  const host = options.host;
  if (!host || typeof host.startModule !== 'function' || typeof host.stopModule !== 'function' ||
      typeof host.getModuleSnapshot !== 'function' || typeof host.executeModule !== 'function' ||
      typeof host.stopAll !== 'function') {
    throw controlError('INVALID_HOST', 'host must expose the NEXA Shell Host lifecycle surface');
  }
  if (options.persist !== undefined && typeof options.persist !== 'function') {
    throw controlError('INVALID_PERSISTENCE', 'persist must be a function when provided');
  }

  let preferences = normalizeNexaModuleControlPreferences(moduleIds, options.preferences);
  const runtimeStatus = new Map(moduleIds.map((moduleId) => [moduleId, 'inactive']));
  const runtimeErrors = new Map();
  const operations = new Map();

  function assertKnown(moduleId) {
    if (!known.has(moduleId)) {
      throw controlError('MODULE_NOT_FOUND', `module ${String(moduleId)} is not controllable`);
    }
  }

  function entry(moduleId) {
    assertKnown(moduleId);
    return preferences.modules[moduleId];
  }

  function statusProjection(moduleId) {
    const status = runtimeStatus.get(moduleId) || 'inactive';
    const projection = {
      moduleId,
      enabled: entry(moduleId).enabled,
      autoStart: entry(moduleId).autoStart,
      runtimeStatus: RUNTIME_STATUSES.has(status) ? status : 'error'
    };
    const errorCode = runtimeErrors.get(moduleId);
    if (errorCode) projection.errorCode = errorCode;
    let controllerReadiness;
    if (['starting', 'running', 'stopping'].includes(projection.runtimeStatus)) {
      try {
        const snapshot = host.getModuleSnapshot(moduleId);
        if (isPlainObject(snapshot?.readiness)) controllerReadiness = snapshot.readiness;
      } catch (_) {}
    }
    projection.readiness = projectNexaModuleReadiness({
      enabled: projection.enabled,
      runtimeStatus: projection.runtimeStatus,
      readiness: readinessByModuleId[moduleId] || controllerReadiness,
      errorCode
    });
    return Object.freeze(projection);
  }

  function getSnapshot() {
    return Object.freeze({
      version: MODULE_CONTROL_VERSION,
      modules: Object.freeze(moduleIds.map(statusProjection))
    });
  }

  async function persistNext(next) {
    try {
      if (options.persist) await options.persist(clonePreferences(next));
    } catch {
      throw controlError(
        'PERSISTENCE_FAILED',
        'Module control preferences could not be persisted'
      );
    }
    preferences = next;
  }

  function withOperation(moduleId, operation, options = {}) {
    const existing = operations.get(moduleId);
    if (existing && options.queue !== true) return existing;
    const attempt = Promise.resolve(existing).catch(() => {}).then(operation);
    operations.set(moduleId, attempt);
    attempt.finally(() => {
      if (operations.get(moduleId) === attempt) operations.delete(moduleId);
    }).catch(() => {});
    return attempt;
  }

  function startModule(moduleId) {
    try {
      if (!entry(moduleId).enabled) {
        throw controlError('MODULE_DISABLED', `module ${moduleId} is disabled`);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return withOperation(moduleId, async () => {
      runtimeStatus.set(moduleId, 'starting');
      runtimeErrors.delete(moduleId);
      try {
        const result = await host.startModule(moduleId);
        runtimeStatus.set(moduleId, 'running');
        return result;
      } catch (error) {
        runtimeStatus.set(moduleId, 'error');
        runtimeErrors.set(moduleId, safeErrorCode(error, 'MODULE_START_FAILED'));
        throw error;
      }
    });
  }

  function stopModule(moduleId) {
    try { assertKnown(moduleId); } catch (error) { return Promise.reject(error); }
    return withOperation(moduleId, async () => {
      runtimeStatus.set(moduleId, 'stopping');
      try {
        const result = await host.stopModule(moduleId);
        runtimeStatus.set(moduleId, 'inactive');
        runtimeErrors.delete(moduleId);
        return result;
      } catch (error) {
        runtimeStatus.set(moduleId, 'error');
        runtimeErrors.set(moduleId, safeErrorCode(error, 'MODULE_STOP_FAILED'));
        throw error;
      }
    }, { queue: true });
  }

  function getModuleSnapshot(moduleId) {
    assertKnown(moduleId);
    if (!entry(moduleId).enabled) return undefined;
    return host.getModuleSnapshot(moduleId);
  }

  function executeModule(moduleId, command) {
    try {
      if (!entry(moduleId).enabled) {
        throw controlError('MODULE_DISABLED', `module ${moduleId} is disabled`);
      }
    } catch (error) {
      return Promise.reject(error);
    }
    return host.executeModule(moduleId, command);
  }

  async function updateEntries(updates) {
    const nextModules = Object.fromEntries(
      moduleIds.map((moduleId) => [moduleId, { ...preferences.modules[moduleId] }])
    );
    for (const [moduleId, patch] of updates) {
      assertKnown(moduleId);
      nextModules[moduleId] = { ...nextModules[moduleId], ...patch };
    }
    const next = normalizeNexaModuleControlPreferences(moduleIds, {
      version: MODULE_CONTROL_VERSION,
      modules: nextModules
    });
    await persistNext(next);
    return getSnapshot();
  }

  async function setEnabled(moduleId, enabled) {
    if (typeof enabled !== 'boolean') throw controlError('INVALID_ENABLED', 'enabled must be boolean');
    await updateEntries([[moduleId, { enabled }]]);
    if (!enabled && runtimeStatus.get(moduleId) !== 'inactive') await stopModule(moduleId);
    return getSnapshot();
  }

  async function setAutoStart(moduleId, autoStart) {
    if (typeof autoStart !== 'boolean') throw controlError('INVALID_AUTO_START', 'autoStart must be boolean');
    return updateEntries([[moduleId, { autoStart }]]);
  }

  async function setAllEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw controlError('INVALID_ENABLED', 'enabled must be boolean');
    await updateEntries(moduleIds.map((moduleId) => [moduleId, { enabled }]));
    if (!enabled) {
      const results = await Promise.allSettled(moduleIds.map((moduleId) => stopModule(moduleId)));
      const failed = results.flatMap((result, index) => result.status === 'rejected' ? [moduleIds[index]] : []);
      if (failed.length > 0) {
        const error = controlError('MODULE_DISABLE_INCOMPLETE', 'one or more disabled modules could not stop');
        error.failedModuleIds = Object.freeze(failed);
        throw error;
      }
    }
    return getSnapshot();
  }

  function setAllAutoStart(autoStart) {
    if (typeof autoStart !== 'boolean') {
      return Promise.reject(controlError('INVALID_AUTO_START', 'autoStart must be boolean'));
    }
    return updateEntries(moduleIds.map((moduleId) => [moduleId, { autoStart }]));
  }

  async function startAutoModules() {
    const eligible = moduleIds.filter((moduleId) => {
      const value = entry(moduleId);
      return value.enabled && value.autoStart;
    });
    const settled = await Promise.allSettled(eligible.map((moduleId) => startModule(moduleId)));
    return Object.freeze({
      startedModuleIds: Object.freeze(eligible.filter((_moduleId, index) => settled[index].status === 'fulfilled')),
      failedModuleIds: Object.freeze(eligible.filter((_moduleId, index) => settled[index].status === 'rejected'))
    });
  }

  async function stopAll() {
    try {
      return await host.stopAll();
    } finally {
      for (const moduleId of moduleIds) runtimeStatus.set(moduleId, 'inactive');
    }
  }

  return Object.freeze({
    getSnapshot,
    startModule,
    stopModule,
    getModuleSnapshot,
    executeModule,
    setEnabled,
    setAutoStart,
    setAllEnabled,
    setAllAutoStart,
    startAutoModules,
    stopAll
  });
}

module.exports = {
  DEFAULT_MODULE_CONTROL,
  MODULE_CONTROL_VERSION,
  NexaModuleControlError,
  createNexaModuleControl,
  normalizeNexaModuleControlPreferences
};
