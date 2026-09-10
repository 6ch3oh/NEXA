import { isValidIsoTimestamp } from '../../date/deterministic-parser.mjs';
import { NOTION_SYNC_SOURCE } from './notion-sync-policy.mjs';

export const NOTION_SYNC_STATUSES = Object.freeze({
  SYNCED: 'synced',
  NO_CHANGE: 'no_change',
  STALE_SKIPPED: 'stale_skipped',
  CACHE_MISS: 'cache_miss',
  MALFORMED_DATA: 'malformed_data',
  PORT_ERROR: 'port_error',
  CONFLICT: 'conflict',
});

export const NOTION_SNAPSHOT_STATES = Object.freeze({
  FRESH_COMPLETE: 'fresh_complete',
  FRESH_NON_AUTHORITATIVE: 'fresh_non_authoritative',
  STALE: 'stale',
  CACHE_MISS: 'cache_miss',
  MALFORMED: 'malformed',
  PORT_ERROR: 'port_error',
});

export const NOTION_SYNC_ACTIONS = Object.freeze({
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  MISSING_FROM_SOURCE: 'missing_from_source',
});

const STATUS_LIST = Object.values(NOTION_SYNC_STATUSES);
const SNAPSHOT_STATE_LIST = Object.values(NOTION_SNAPSHOT_STATES);
const ACTION_LIST = Object.values(NOTION_SYNC_ACTIONS);

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function nullableId(value, field) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string or null`);
  }
  return value;
}

export function createNotionSyncEvidence({ external_id, local_id = null, action, reason } = {}) {
  if (!ACTION_LIST.includes(action)) throw new TypeError(`Invalid sync evidence action "${String(action)}"`);
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError('sync evidence reason must be a non-empty string');
  }
  return Object.freeze({
    external_id: nullableId(external_id, 'evidence.external_id'),
    local_id: nullableId(local_id, 'evidence.local_id'),
    action,
    reason,
  });
}

function normalizeError(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new TypeError('sync error must be an object');
  }
  if (typeof error.code !== 'string' || error.code.trim() === '') {
    throw new TypeError('sync error.code must be non-empty');
  }
  return Object.freeze({
    code: error.code,
    external_id: nullableId(error.external_id ?? null, 'error.external_id'),
    field: nullableId(error.field ?? null, 'error.field'),
    message: typeof error.message === 'string' && error.message.trim() !== ''
      ? error.message
      : 'Notion read sync failed safely.',
  });
}

export function createNotionSyncResult(input = {}) {
  if (!STATUS_LIST.includes(input.status)) throw new TypeError(`Invalid sync status "${String(input.status)}"`);
  if (!SNAPSHOT_STATE_LIST.includes(input.snapshot_state)) {
    throw new TypeError(`Invalid snapshot_state "${String(input.snapshot_state)}"`);
  }
  if (!isValidIsoTimestamp(input.observed_at)) {
    throw new TypeError('sync result observed_at must be an explicit ISO timestamp');
  }
  const evidence = (input.evidence ?? []).map(createNotionSyncEvidence);
  const errors = (input.errors ?? []).map(normalizeError);
  return Object.freeze({
    status: input.status,
    source: NOTION_SYNC_SOURCE,
    snapshot_state: input.snapshot_state,
    created_count: nonNegativeInteger(input.created_count ?? 0, 'created_count'),
    updated_count: nonNegativeInteger(input.updated_count ?? 0, 'updated_count'),
    unchanged_count: nonNegativeInteger(input.unchanged_count ?? 0, 'unchanged_count'),
    skipped_count: nonNegativeInteger(input.skipped_count ?? 0, 'skipped_count'),
    error_count: nonNegativeInteger(input.error_count ?? errors.length, 'error_count'),
    missing_from_source_count: nonNegativeInteger(
      input.missing_from_source_count ?? 0,
      'missing_from_source_count',
    ),
    observed_at: input.observed_at,
    errors: Object.freeze(errors),
    evidence: Object.freeze(evidence),
  });
}
