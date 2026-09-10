import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_OWNED_TASK_FIELDS,
  NEXA_LOCAL_OWNED_TASK_FIELDS,
  NOTION_SYNC_POLICY_MODES,
  assertNotionSyncPolicy,
  createNotionSyncPolicy,
} from '../src/adapters/notion/notion-sync-policy.mjs';
import {
  NOTION_SYNC_ACTIONS,
  createNotionSyncEvidence,
  createNotionSyncResult,
} from '../src/adapters/notion/notion-sync-result.mjs';

test('sync policy freezes explicit completeness and fail-closed reconciliation rules', () => {
  const policy = createNotionSyncPolicy({ timezone: 'Asia/Shanghai' });
  assert.equal(policy.snapshot_authority, NOTION_SYNC_POLICY_MODES.SNAPSHOT_AUTHORITY);
  assert.equal(policy.stale_snapshot, 'skip_without_writes');
  assert.equal(policy.cache_miss, 'skip_without_writes');
  assert.equal(policy.malformed_snapshot, 'reject_batch');
  assert.equal(policy.missing_item, 'evidence_only_no_delete');
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(assertNotionSyncPolicy(policy), policy);
});

test('field ownership preserves local extensions and updates only explicit Legacy priority', () => {
  assert.deepEqual(LEGACY_OWNED_TASK_FIELDS, [
    'external_id', 'source', 'title', 'status', 'due_at', 'timezone',
    'time_state', 'priority_when_explicit',
  ]);
  assert.ok(NEXA_LOCAL_OWNED_TASK_FIELDS.includes('dependencies'));
  assert.ok(NEXA_LOCAL_OWNED_TASK_FIELDS.includes('description'));
  assert.ok(NEXA_LOCAL_OWNED_TASK_FIELDS.includes('start_at'));
  assert.equal(NEXA_LOCAL_OWNED_TASK_FIELDS.includes('priority'), false);
});

test('sync policy requires an explicit valid timezone and rejects mutations', () => {
  assert.throws(() => createNotionSyncPolicy(), /timezone/);
  assert.throws(() => createNotionSyncPolicy({ timezone: 'not a timezone' }), /Invalid/);
  const changed = { ...createNotionSyncPolicy({ timezone: '+08:00' }), stale_snapshot: 'apply' };
  assert.throws(() => assertNotionSyncPolicy(changed), /Unsupported/);
});

test('Sync Result exposes stable counts, safe errors, and minimal evidence', () => {
  const evidence = createNotionSyncEvidence({
    external_id: 'page_1', local_id: 'local_task_page_1',
    action: NOTION_SYNC_ACTIONS.CREATED, reason: 'first_import',
  });
  const result = createNotionSyncResult({
    status: 'synced', snapshot_state: 'fresh_non_authoritative', created_count: 1,
    observed_at: '2026-08-10T08:00:00+08:00', evidence: [evidence], errors: [],
  });
  assert.deepEqual(Object.keys(result), [
    'status', 'source', 'snapshot_state', 'created_count', 'updated_count',
    'unchanged_count', 'skipped_count', 'error_count', 'missing_from_source_count',
    'observed_at', 'errors', 'evidence',
  ]);
  assert.deepEqual(Object.keys(result.evidence[0]), ['external_id', 'local_id', 'action', 'reason']);
  assert.equal(JSON.stringify(result).includes('token'), false);
  assert.equal(Object.isFrozen(result), true);
});

test('Sync Result and evidence reject unknown states and implicit clocks', () => {
  assert.throws(() => createNotionSyncEvidence({
    external_id: 'x', action: 'deleted', reason: 'unsafe',
  }), /action/);
  assert.throws(() => createNotionSyncResult({
    status: 'synced', snapshot_state: 'fresh_complete',
  }), /observed_at/);
});
