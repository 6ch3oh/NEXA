'use strict';

const PRODUCT_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);
const RUNTIME_STATES = new Set(['inactive', 'starting', 'running', 'stopping', 'error']);
const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function stableCode(value, fallback) {
  return typeof value === 'string' && STABLE_CODE.test(value) ? value : fallback;
}

function result(state, code) {
  const value = { state };
  if (state !== 'READY' && code) value.code = code;
  return Object.freeze(value);
}

function publicReadiness(value) {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const state = value.trim().toUpperCase();
    return PRODUCT_STATES.has(state)
      ? result(state, state === 'READY' ? undefined : `MODULE_${state}`)
      : result('ERROR', 'INVALID_MODULE_READINESS');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result('ERROR', 'INVALID_MODULE_READINESS');
  }
  if (typeof value.state === 'string') {
    const state = value.state.trim().toUpperCase();
    if (!PRODUCT_STATES.has(state)) return result('ERROR', 'INVALID_MODULE_READINESS');
    return result(state, state === 'READY' ? undefined : stableCode(value.code, `MODULE_${state}`));
  }
  if (value.ready === true) return result('READY');
  if (value.ready === false) {
    return result('UNAVAILABLE', stableCode(value.code, 'MODULE_UNAVAILABLE'));
  }
  return result('ERROR', 'INVALID_MODULE_READINESS');
}

function projectNexaModuleReadiness(input = {}) {
  const runtimeStatus = input.runtimeStatus;
  if (!RUNTIME_STATES.has(runtimeStatus)) return result('ERROR', 'INVALID_RUNTIME_STATUS');
  if (runtimeStatus === 'error') {
    return result('ERROR', stableCode(input.errorCode, 'MODULE_RUNTIME_ERROR'));
  }
  if (input.enabled !== true) return result('OFFLINE', 'MODULE_DISABLED');

  const reported = publicReadiness(input.readiness);
  if (reported) return reported;

  if (runtimeStatus === 'running') return result('READY');
  if (runtimeStatus === 'starting') return result('LIMITED', 'MODULE_STARTING');
  if (runtimeStatus === 'stopping') return result('LIMITED', 'MODULE_STOPPING');
  return result('OFFLINE', 'MODULE_INACTIVE');
}

module.exports = {
  PRODUCT_STATES,
  projectNexaModuleReadiness
};
