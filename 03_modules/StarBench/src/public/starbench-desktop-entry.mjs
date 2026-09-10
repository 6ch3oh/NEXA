import { assertNoSensitiveData } from '../credential-provider.mjs';
import {
  STARBENCH_DESKTOP_PRODUCT_STATE_SEMANTICS,
  createStarBenchProductStateSummary,
} from './starbench-product-state-projection.mjs';

export {
  STARBENCH_DESKTOP_RUNTIME_READER_BINDING_CONTRACT,
  STARBENCH_DESKTOP_RUNTIME_READER_BINDING_VERSION,
  createStarBenchDesktopRuntimeReaderBindings,
} from './starbench-runtime-reader-bindings.mjs';

export const STARBENCH_DESKTOP_HANDOFF_VERSION = '0.1.0';
export const STARBENCH_PUBLIC_APPLICATION_VERSION = '0.1.0';
export const STARBENCH_DESKTOP_ENTRYPOINT = 'src/public/starbench-desktop-entry.mjs';
export { STARBENCH_DESKTOP_PRODUCT_STATE_SEMANTICS };
export const STARBENCH_DESKTOP_READ_STATUSES = Object.freeze(['ready', 'empty', 'partial', 'unavailable', 'stale', 'error']);
export const STARBENCH_DESKTOP_CAPABILITIES = Object.freeze([
  'evaluation_results',
  'evaluation_history',
  'evidence',
  'request_records',
  'token_cost_observations',
  'external_identity_evidence',
]);

const MAX_READ_ITEMS = 200;
const responseKeys = Object.freeze(['status', 'items', 'as_of', 'cursor', 'summary']);
const unsafeProjectionKey = /^(?:stack|cause|filePath|file_path|storagePath|storage_path|absolutePath|absolute_path|authorization|cookie)$/u;
const absolutePathValue = /^(?:[A-Za-z]:[\\/]|\\\\|\/[A-Za-z0-9_.-]+[\\/])/u;

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoUnsafeProjection(value, path = '$', seen = new Set()) {
  if (typeof value === 'string') {
    if (absolutePathValue.test(value)) throw new StarBenchDesktopHandoffError('UNSAFE_READ_PROJECTION', `Unsafe read projection at ${path}.`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new StarBenchDesktopHandoffError('UNSAFE_READ_PROJECTION', `Cyclic read projection at ${path}.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (unsafeProjectionKey.test(key)) throw new StarBenchDesktopHandoffError('UNSAFE_READ_PROJECTION', `Unsafe read projection at ${path}.${key}.`);
    assertNoUnsafeProjection(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function safeClone(value, label) {
  assertNoSensitiveData(value, label);
  assertNoUnsafeProjection(value);
  try { return structuredClone(value); } catch (cause) {
    throw new StarBenchDesktopHandoffError('UNSAFE_READ_PROJECTION', `${label} is not safely cloneable.`, cause);
  }
}

function errorResponse(capability, code = 'CAPABILITY_READ_FAILED') {
  const safetyNotice = capability === 'external_identity_evidence' ? '外部身份参考不得证明官方身份。' : null;
  return {
    contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
    capability,
    status: 'error',
    items: [],
    as_of: null,
    cursor: null,
    summary: createStarBenchProductStateSummary('error', { safetyNotice }),
    error: { code, message: '读取暂时失败。' },
  };
}

function unavailableResponse(capability, code) {
  const safetyNotice = capability === 'external_identity_evidence' ? '外部身份参考不得证明官方身份。' : null;
  return {
    contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
    capability,
    status: 'unavailable',
    items: [],
    as_of: null,
    cursor: null,
    summary: createStarBenchProductStateSummary('unavailable', { reasonCode: code, safetyNotice }),
    error: { code, message: '能力尚不可用。' },
  };
}

function normalizeReaderResult(capability, value) {
  const source = Array.isArray(value) ? { status: value.length === 0 ? 'empty' : 'ready', items: value, as_of: null, cursor: null, summary: null } : value;
  if (!plain(source) || Object.keys(source).some((key) => !responseKeys.includes(key)) || !STARBenchStatus(source.status) || !Array.isArray(source.items)) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Public reader result is invalid.');
  if (source.items.length > MAX_READ_ITEMS) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_TOO_LARGE', 'Public reader result exceeds the bounded Desktop page size.');
  if (!['ready', 'partial', 'stale'].includes(source.status) && source.items.length !== 0) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Non-readable status cannot carry items.');
  if (source.status === 'empty' && source.items.length !== 0) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Empty status cannot carry items.');
  if (source.as_of !== null && source.as_of !== undefined && (typeof source.as_of !== 'string' || Number.isNaN(Date.parse(source.as_of)))) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Reader as_of must be an ISO timestamp or null.');
  if (source.status === 'stale' && (typeof source.as_of !== 'string' || Number.isNaN(Date.parse(source.as_of)))) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Stale evidence requires an as_of timestamp.');
  if (source.cursor !== null && source.cursor !== undefined && (typeof source.cursor !== 'string' || source.cursor.length > 256)) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Reader cursor is invalid.');
  if (source.summary !== null && source.summary !== undefined && !plain(source.summary)) throw new StarBenchDesktopHandoffError('PUBLIC_READER_RESULT_INVALID', 'Reader summary must be a plain object or null.');
  const normalizedStatus = source.status === 'ready' && source.items.length === 0 ? 'empty' : source.status;
  const safe = safeClone({ items: source.items, as_of: source.as_of ?? null, cursor: source.cursor ?? null, summary: source.summary ?? null }, 'StarBench Desktop read response');
  const summary = createStarBenchProductStateSummary(normalizedStatus, {
    baseSummary: safe.summary,
    checkedAt: safe.summary?.checked_at ?? null,
    reasonCode: safe.summary?.reason_code ?? null,
    safetyNotice: capability === 'external_identity_evidence' ? '外部身份参考不得证明官方身份。' : safe.summary?.safety_notice ?? null,
  });
  return {
    contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
    capability,
    status: normalizedStatus,
    ...safe,
    summary,
    error: null,
  };
}

function STARBenchStatus(value) { return STARBENCH_DESKTOP_READ_STATUSES.includes(value); }

export class StarBenchDesktopHandoffError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'StarBenchDesktopHandoffError';
    this.code = code;
  }
}

export const STARBENCH_DESKTOP_HANDOFF_CONTRACT = deepFreeze({
  contract_id: 'starbench.desktop-entry-handoff.v0.1',
  contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
  module_id: '04_STARBENCH',
  product_name: '星测',
  entrypoint: STARBENCH_DESKTOP_ENTRYPOINT,
  factory_export: 'createStarBenchDesktopApplication',
  navigation: { placement: 'INDEPENDENT_MODULE_ENTRY', label: '星测', route: null, homepage_widget: false },
  ui_host: { ready: false, owner: 'NEXA_CORE_ASSEMBLY', requirement: 'Core supplies route and presentation host without importing StarBench private modules.' },
  lifecycle: ['start', 'stop', 'getReadiness', 'read'],
  statuses: STARBENCH_DESKTOP_READ_STATUSES,
  product_state_projection: {
    location: 'response.summary',
    semantics: {
      EMPTY: '数据源正常，当前没有记录。',
      UNAVAILABLE: '当前没有可读取的数据来源，不需要用户配置。',
      STALE: '存在数据，但数据可能已过期。',
      ERROR: '能力原本可读取，但本次读取失败。',
    },
    user_configuration_required_for_unavailable: false,
    internal_implementation_terms_exposed: false,
  },
  safe_read_capabilities: STARBENCH_DESKTOP_CAPABILITIES,
  execution_capabilities: [],
  authority: {
    canonical_identity: 'STARBENCH',
    external_identity_engine: 'UNTRUSTED_EXTERNAL_EVIDENCE',
    officiality_inference: 'NOT_ALLOWED',
  },
  automatic_execution: false,
  provider_calls: false,
  network_required: false,
});

export function createStarBenchDesktopApplication({ readers = {} } = {}) {
  if (!plain(readers)) throw new StarBenchDesktopHandoffError('PUBLIC_READER_REGISTRY_INVALID', 'Desktop reader registry must be a plain object.');
  for (const [capability, reader] of Object.entries(readers)) {
    if (!STARBENCH_DESKTOP_CAPABILITIES.includes(capability) || typeof reader !== 'function') throw new StarBenchDesktopHandoffError('PUBLIC_READER_REGISTRY_INVALID', 'Desktop reader registry contains an unsupported binding.');
  }
  const bindings = Object.freeze({ ...readers });
  let lifecycle = 'stopped';

  function getReadiness() {
    const configured = STARBENCH_DESKTOP_CAPABILITIES.filter((capability) => typeof bindings[capability] === 'function');
    const status = lifecycle === 'stopped' ? 'unavailable' : configured.length === 0 ? 'unavailable' : configured.length === STARBENCH_DESKTOP_CAPABILITIES.length ? 'ready' : 'partial';
    return {
      contract_version: STARBENCH_DESKTOP_HANDOFF_VERSION,
      application_version: STARBENCH_PUBLIC_APPLICATION_VERSION,
      lifecycle,
      status,
      configured_capabilities: [...configured],
      unavailable_capabilities: STARBENCH_DESKTOP_CAPABILITIES.filter((capability) => !configured.includes(capability)),
      ui_host_ready: false,
    };
  }

  return Object.freeze({
    contract: STARBENCH_DESKTOP_HANDOFF_CONTRACT,
    async start() { lifecycle = 'started'; return getReadiness(); },
    async stop() { lifecycle = 'stopped'; return getReadiness(); },
    getReadiness,
    async read(capability, query = {}) {
      if (!STARBENCH_DESKTOP_CAPABILITIES.includes(capability)) return errorResponse(String(capability ?? 'unknown'), 'CAPABILITY_NOT_PUBLIC');
      if (lifecycle !== 'started') return unavailableResponse(capability, 'APPLICATION_NOT_STARTED');
      const reader = bindings[capability];
      if (typeof reader !== 'function') return unavailableResponse(capability, 'CAPABILITY_NOT_CONFIGURED');
      try {
        if (!plain(query) || (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > MAX_READ_ITEMS))) throw new StarBenchDesktopHandoffError('READ_QUERY_INVALID', 'Desktop read query is invalid.');
        const safeQuery = safeClone(query, 'StarBench Desktop read query');
        return normalizeReaderResult(capability, await reader(safeQuery));
      } catch {
        return errorResponse(capability);
      }
    },
  });
}
