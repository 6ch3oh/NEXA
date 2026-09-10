import { isValidIsoTimestamp } from '../../date/deterministic-parser.mjs';

export const LEGACY_RUNTIME_MODE = 'LEGACY_RUNTIME_READ_ONLY';

export const LEGACY_CAPABILITY_STATES = Object.freeze({
  REUSED: 'REUSED',
  CONTRACT_ONLY: 'CONTRACT_ONLY',
  UNSUPPORTED: 'UNSUPPORTED',
});

export const LEGACY_FAILURE_CODES = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_FAILED: 'NETWORK_FAILED',
  CACHE_MISS: 'CACHE_MISS',
  STALE_CACHE: 'STALE_CACHE',
  MALFORMED_DATA: 'MALFORMED_DATA',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  UNKNOWN: 'UNKNOWN',
});

export const LEGACY_MUTATION_OPERATIONS = Object.freeze([
  'create',
  'update',
  'complete',
  'reopen',
]);

export const legacyNotionTodoCapabilities = Object.freeze({
  runtime_mode: LEGACY_RUNTIME_MODE,
  get: LEGACY_CAPABILITY_STATES.REUSED,
  refresh: LEGACY_CAPABILITY_STATES.REUSED,
  test: LEGACY_CAPABILITY_STATES.REUSED,
  open: LEGACY_CAPABILITY_STATES.REUSED,
  create: LEGACY_CAPABILITY_STATES.CONTRACT_ONLY,
  update: LEGACY_CAPABILITY_STATES.CONTRACT_ONLY,
  complete: LEGACY_CAPABILITY_STATES.CONTRACT_ONLY,
  reopen: LEGACY_CAPABILITY_STATES.CONTRACT_ONLY,
  mutation_executable: false,
  mutation_boundary: 'Command Policy -> Confirmation Gate -> Adapter',
});

const LEGACY_STATUS_TO_FAILURE = Object.freeze({
  notConfigured: LEGACY_FAILURE_CODES.NOT_CONFIGURED,
  invalidToken: LEGACY_FAILURE_CODES.AUTH_FAILED,
  unauthorized: LEGACY_FAILURE_CODES.AUTH_FAILED,
  network: LEGACY_FAILURE_CODES.NETWORK_FAILED,
  rateLimited: LEGACY_FAILURE_CODES.NETWORK_FAILED,
  malformed: LEGACY_FAILURE_CODES.MALFORMED_DATA,
  unsupported: LEGACY_FAILURE_CODES.UNSUPPORTED_OPERATION,
  cacheMiss: LEGACY_FAILURE_CODES.CACHE_MISS,
});

function safeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function normalizeLegacyFailure(input, { hasCachedItems = false } = {}) {
  if (hasCachedItems && input?.ok === false) {
    return Object.freeze({
      code: LEGACY_FAILURE_CODES.STALE_CACHE,
      legacy_code: typeof input.status === 'string' ? input.status : null,
      cause_code: LEGACY_STATUS_TO_FAILURE[input?.status] ?? LEGACY_FAILURE_CODES.UNKNOWN,
      retry_after_ms: safeInteger(input?.retryAfterMs),
      message: 'Legacy refresh failed; the last successful display snapshot is preserved.',
    });
  }

  const legacyCode = typeof input?.status === 'string'
    ? input.status
    : typeof input?.code === 'string'
      ? input.code
      : null;
  return Object.freeze({
    code: LEGACY_STATUS_TO_FAILURE[legacyCode] ?? LEGACY_FAILURE_CODES.UNKNOWN,
    legacy_code: legacyCode,
    cause_code: null,
    retry_after_ms: safeInteger(input?.retryAfterMs),
    message: legacyCode == null
      ? 'Legacy Notion Todo operation failed without a recognized status.'
      : `Legacy Notion Todo operation failed with status "${legacyCode}".`,
  });
}

function assertTaskLike(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new TypeError('mutation intent task must be an object');
  }
  if (typeof task.id !== 'string' || task.id.trim() === '') {
    throw new TypeError('mutation intent task.id must be a non-empty local identity');
  }
  if (typeof task.title !== 'string' || task.title.trim() === '') {
    throw new TypeError('mutation intent task.title must be non-empty');
  }
}

function payloadFor(operation, task) {
  const common = {
    external_id: task.external_id ?? null,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due_at: task.due_at ?? null,
    timezone: task.timezone ?? null,
  };
  if (operation === 'complete') return { external_id: common.external_id, status: 'completed' };
  if (operation === 'reopen') return { external_id: common.external_id, status: 'pending' };
  return common;
}

export function createLegacyMutationIntent({ operation, task, created_at } = {}) {
  if (!LEGACY_MUTATION_OPERATIONS.includes(operation)) {
    throw new TypeError(`Unsupported legacy mutation operation "${String(operation)}"`);
  }
  assertTaskLike(task);
  if (!isValidIsoTimestamp(created_at)) {
    throw new TypeError('mutation intent created_at must be an explicit ISO timestamp');
  }
  if (operation !== 'create' && (typeof task.external_id !== 'string' || task.external_id.trim() === '')) {
    throw new TypeError(`${operation} mutation intent requires task.external_id`);
  }
  return Object.freeze({
    kind: 'notion.todo.mutation_intent',
    operation,
    local_task_id: task.id,
    external_id: task.external_id ?? null,
    payload: Object.freeze(payloadFor(operation, task)),
    capability: LEGACY_CAPABILITY_STATES.CONTRACT_ONLY,
    executable: false,
    requires_confirmation: true,
    confirmation_boundary: legacyNotionTodoCapabilities.mutation_boundary,
    created_at,
  });
}
