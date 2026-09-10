export const NOTION_SYNC_SOURCE = 'notion';

export const NOTION_SYNC_POLICY_MODES = Object.freeze({
  SNAPSHOT_AUTHORITY: 'explicit_only',
  STALE: 'skip_without_writes',
  CACHE_MISS: 'skip_without_writes',
  MALFORMED: 'reject_batch',
  MISSING_ITEM: 'evidence_only_no_delete',
  MISSING_PRIORITY: 'preserve_existing_or_default_on_create',
  DEPENDENCIES: 'preserve_existing',
});

export const LEGACY_OWNED_TASK_FIELDS = Object.freeze([
  'external_id',
  'source',
  'title',
  'status',
  'due_at',
  'timezone',
  'time_state',
  'priority_when_explicit',
]);

export const NEXA_LOCAL_OWNED_TASK_FIELDS = Object.freeze([
  'id',
  'description',
  'start_at',
  'dependencies',
  'created_at',
]);

function assertTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('Notion sync policy timezone must be an explicit non-empty string');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
  } catch {
    if (!/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(timezone)) {
      throw new TypeError(`Invalid Notion sync policy timezone "${timezone}"`);
    }
  }
  return timezone;
}

export function createNotionSyncPolicy({ timezone } = {}) {
  return Object.freeze({
    source: NOTION_SYNC_SOURCE,
    timezone: assertTimezone(timezone),
    snapshot_authority: NOTION_SYNC_POLICY_MODES.SNAPSHOT_AUTHORITY,
    stale_snapshot: NOTION_SYNC_POLICY_MODES.STALE,
    cache_miss: NOTION_SYNC_POLICY_MODES.CACHE_MISS,
    malformed_snapshot: NOTION_SYNC_POLICY_MODES.MALFORMED,
    missing_item: NOTION_SYNC_POLICY_MODES.MISSING_ITEM,
    missing_priority: NOTION_SYNC_POLICY_MODES.MISSING_PRIORITY,
    dependencies: NOTION_SYNC_POLICY_MODES.DEPENDENCIES,
    legacy_owned_fields: LEGACY_OWNED_TASK_FIELDS,
    nexa_local_owned_fields: NEXA_LOCAL_OWNED_TASK_FIELDS,
  });
}

export function assertNotionSyncPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('Notion sync policy must be created explicitly');
  }
  const expected = createNotionSyncPolicy({ timezone: policy.timezone });
  for (const field of [
    'source', 'snapshot_authority', 'stale_snapshot', 'cache_miss',
    'malformed_snapshot', 'missing_item', 'missing_priority', 'dependencies',
  ]) {
    if (policy[field] !== expected[field]) {
      throw new TypeError(`Unsupported Notion sync policy ${field} "${String(policy[field])}"`);
    }
  }
  return policy;
}
