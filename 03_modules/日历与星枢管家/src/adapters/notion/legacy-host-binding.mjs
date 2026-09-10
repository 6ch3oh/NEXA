import {
  LEGACY_FAILURE_CODES,
  normalizeLegacyFailure,
} from './legacy-capability-contract.mjs';

export const LEGACY_HOST_CAPABILITIES = Object.freeze(['get', 'refresh', 'test', 'open']);

export const LEGACY_HOST_ERROR_CODES = Object.freeze({
  HOST_UNAVAILABLE: 'HOST_UNAVAILABLE',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  LEGACY_ERROR: 'LEGACY_ERROR',
});

const HOST_ERROR_TO_FAILURE = Object.freeze({
  [LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE]: LEGACY_FAILURE_CODES.NOT_CONFIGURED,
  [LEGACY_HOST_ERROR_CODES.CAPABILITY_MISSING]: LEGACY_FAILURE_CODES.UNSUPPORTED_OPERATION,
  [LEGACY_HOST_ERROR_CODES.INVALID_RESPONSE]: LEGACY_FAILURE_CODES.MALFORMED_DATA,
  [LEGACY_HOST_ERROR_CODES.LEGACY_ERROR]: LEGACY_FAILURE_CODES.UNKNOWN,
});

function hostFailure(code, capability = null) {
  return Object.freeze({
    code: HOST_ERROR_TO_FAILURE[code] ?? LEGACY_FAILURE_CODES.UNKNOWN,
    legacy_code: code,
    cause_code: null,
    retry_after_ms: null,
    message: capability == null
      ? `Legacy host binding failed with "${code}".`
      : `Legacy host capability "${capability}" failed validation with "${code}".`,
  });
}

export class LegacyHostBindingError extends TypeError {
  constructor(code, { capability = null } = {}) {
    super(capability == null
      ? `Legacy Notion host binding error: ${code}`
      : `Legacy Notion host capability "${capability}" error: ${code}`);
    this.name = 'LegacyHostBindingError';
    this.code = code;
    this.capability = capability;
    this.failure = hostFailure(code, capability);
  }
}

export function validateLegacyNotionHostApi(hostApi) {
  if (!hostApi || typeof hostApi !== 'object' || Array.isArray(hostApi)) {
    throw new LegacyHostBindingError(LEGACY_HOST_ERROR_CODES.HOST_UNAVAILABLE);
  }
  for (const capability of LEGACY_HOST_CAPABILITIES) {
    if (typeof hostApi[capability] !== 'function') {
      throw new LegacyHostBindingError(LEGACY_HOST_ERROR_CODES.CAPABILITY_MISSING, { capability });
    }
  }
  return hostApi;
}

export function normalizeLegacyHostFailure(input) {
  if (input instanceof LegacyHostBindingError) return input.failure;
  const hostCode = typeof input?.host_error_code === 'string' ? input.host_error_code : null;
  if (hostCode === LEGACY_HOST_ERROR_CODES.INVALID_RESPONSE) {
    return hostFailure(hostCode, input?.capability ?? null);
  }
  if (hostCode === LEGACY_HOST_ERROR_CODES.LEGACY_ERROR) {
    return normalizeLegacyFailure(input);
  }
  return normalizeLegacyFailure(input);
}

function invalidResponse(capability) {
  return Object.freeze({
    ok: false,
    status: 'malformed',
    host_error_code: LEGACY_HOST_ERROR_CODES.INVALID_RESPONSE,
    capability,
    error: 'invalid host response',
  });
}

function thrownLegacyError(capability) {
  return Object.freeze({
    ok: false,
    status: 'unknown',
    host_error_code: LEGACY_HOST_ERROR_CODES.LEGACY_ERROR,
    capability,
    error: 'legacy host operation failed',
  });
}

async function invokeHost(hostApi, capability, args = []) {
  let response;
  try {
    response = await Reflect.apply(hostApi[capability], hostApi, args);
  } catch {
    return thrownLegacyError(capability);
  }
  if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.ok !== 'boolean') {
    return invalidResponse(capability);
  }
  if (response.ok === false) {
    return Object.freeze({
      ...response,
      status: typeof response.status === 'string' ? response.status : 'unknown',
      host_error_code: LEGACY_HOST_ERROR_CODES.LEGACY_ERROR,
      capability,
    });
  }
  return response;
}

export function createLegacyNotionHostBinding(hostApi) {
  const host = validateLegacyNotionHostApi(hostApi);
  const binding = {
    capabilities: Object.freeze(Object.fromEntries(
      LEGACY_HOST_CAPABILITIES.map((capability) => [capability, true]),
    )),
    get: () => invokeHost(host, 'get'),
    refresh: () => invokeHost(host, 'refresh'),
    test: () => invokeHost(host, 'test'),
    open: (target) => invokeHost(host, 'open', [target]),
  };
  if (typeof host.onPush === 'function') {
    binding.onPush = (callback) => Reflect.apply(host.onPush, host, [callback]);
  }
  return Object.freeze(binding);
}
