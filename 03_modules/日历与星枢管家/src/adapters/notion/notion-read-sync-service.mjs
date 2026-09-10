import { isValidIsoTimestamp } from '../../date/deterministic-parser.mjs';
import { TEMPORAL_STATES } from '../../domain/temporal-state.mjs';
import { TASK_STATUSES, updateTask } from '../../domain/task.mjs';
import { assertRepositoryContract } from '../../storage/contracts.mjs';
import { createLegacyCacheSnapshot, LegacyCacheContractError } from './legacy-cache-contract.mjs';
import { LEGACY_FAILURE_CODES } from './legacy-capability-contract.mjs';
import { mapLegacyTodoToTask } from './legacy-todo-mapper.mjs';
import { assertNotionSyncPolicy } from './notion-sync-policy.mjs';
import {
  NOTION_SNAPSHOT_STATES,
  NOTION_SYNC_ACTIONS,
  NOTION_SYNC_STATUSES,
  createNotionSyncEvidence,
  createNotionSyncResult,
} from './notion-sync-result.mjs';

const BUSINESS_FIELDS = Object.freeze([
  'id', 'title', 'description', 'status', 'priority', 'start_at', 'due_at',
  'completed_at', 'timezone', 'source', 'external_id', 'dependencies', 'time_state', 'created_at',
]);

function assertNow(now) {
  if (!isValidIsoTimestamp(now)) throw new TypeError('Notion sync now must be an explicit ISO timestamp');
  return now;
}

function assertPort(port) {
  if (!port || typeof port !== 'object') throw new TypeError('NotionReadSyncService port is required');
  for (const method of ['getSnapshot', 'refresh']) {
    if (typeof port[method] !== 'function') throw new TypeError(`Notion read port.${method} must be a function`);
  }
  return port;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameBusinessTask(left, right) {
  return BUSINESS_FIELDS.every((field) => sameValue(left[field] ?? null, right[field] ?? null));
}

function safeExternalId(item) {
  return typeof item?.id === 'string' && item.id.trim() !== '' ? item.id : null;
}

function safeMappingError(error, externalId) {
  return {
    code: error?.code ?? LEGACY_FAILURE_CODES.MALFORMED_DATA,
    external_id: externalId,
    field: typeof error?.field === 'string' && error.field.trim() !== '' ? error.field : null,
    message: error?.field
      ? `Legacy item mapping failed for field "${error.field}".`
      : 'Legacy item mapping failed safely.',
  };
}

function failureResult({ status, snapshotState, now, code, message, skipped = 0, evidence = [] }) {
  return createNotionSyncResult({
    status,
    snapshot_state: snapshotState,
    skipped_count: skipped,
    error_count: 1,
    observed_at: now,
    errors: [{ code, external_id: null, field: null, message }],
    evidence,
  });
}

function completedAtFor(existing, mapped, now) {
  if (mapped.status !== TASK_STATUSES.COMPLETED) return null;
  if (existing.status === TASK_STATUSES.COMPLETED) return existing.completed_at;
  return now;
}

function temporalPatch(existing, mapped) {
  if (mapped.time_state === TEMPORAL_STATES.UNSCHEDULED && existing.start_at != null) {
    return {
      due_at: null,
      timezone: existing.timezone,
      time_state: existing.time_state,
    };
  }
  return {
    due_at: mapped.due_at,
    timezone: mapped.timezone,
    time_state: mapped.time_state,
  };
}

function mergedTask(existing, mapped, legacyItem, now) {
  const explicitPriority = typeof legacyItem.priority === 'string' && legacyItem.priority.trim() !== '';
  return updateTask(existing, {
    title: mapped.title,
    status: mapped.status,
    priority: explicitPriority ? mapped.priority : existing.priority,
    ...temporalPatch(existing, mapped),
    completed_at: completedAtFor(existing, mapped, now),
    source: mapped.source,
    external_id: mapped.external_id,
  }, { now });
}

function replaceTask(repository, current, next) {
  if (!repository.delete(current.id)) throw new Error(`Task "${current.id}" disappeared during sync`);
  try {
    return repository.create(next);
  } catch (error) {
    try {
      repository.create(current);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'Sync update failed and rollback could not restore Task');
    }
    throw error;
  }
}

function rollbackApplied(repository, applied) {
  const errors = [];
  for (const entry of [...applied].reverse()) {
    try {
      if (entry.kind === 'create') {
        repository.delete(entry.next.id);
      } else {
        repository.delete(entry.next.id);
        repository.create(entry.previous);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Notion sync rollback failed');
}

function portErrorResult(portResult, now) {
  const code = portResult?.failure?.code ?? LEGACY_FAILURE_CODES.UNKNOWN;
  if (code === LEGACY_FAILURE_CODES.CACHE_MISS) {
    return failureResult({
      status: NOTION_SYNC_STATUSES.CACHE_MISS,
      snapshotState: NOTION_SNAPSHOT_STATES.CACHE_MISS,
      now,
      code,
      message: 'Legacy snapshot cache is absent; local Tasks were not changed.',
    });
  }
  return failureResult({
    status: NOTION_SYNC_STATUSES.PORT_ERROR,
    snapshotState: NOTION_SNAPSHOT_STATES.PORT_ERROR,
    now,
    code,
    message: 'Legacy read port failed; local Tasks were not changed.',
  });
}

export class NotionReadSyncService {
  constructor({ port, repository, mapper = mapLegacyTodoToTask, policy } = {}) {
    this.port = assertPort(port);
    this.repository = assertRepositoryContract(repository, 'NotionReadSyncService Task repository');
    if (typeof mapper !== 'function') throw new TypeError('NotionReadSyncService mapper must be a function');
    this.mapper = mapper;
    this.policy = assertNotionSyncPolicy(policy);
  }

  async getAndSync(options = {}) {
    const now = assertNow(options.now);
    let portResult;
    try {
      portResult = await this.port.getSnapshot();
    } catch {
      return portErrorResult(null, now);
    }
    return this.#consumePortResult(portResult, options);
  }

  async refreshAndSync(options = {}) {
    const now = assertNow(options.now);
    let portResult;
    try {
      portResult = await this.port.refresh();
    } catch {
      return portErrorResult(null, now);
    }
    return this.#consumePortResult(portResult, options);
  }

  #consumePortResult(portResult, options) {
    const now = assertNow(options.now);
    if (!portResult || typeof portResult !== 'object') return portErrorResult(portResult, now);
    if (portResult.value != null) {
      return this.syncSnapshot(portResult.value, options);
    }
    if (portResult.ok === true) {
      return failureResult({
        status: NOTION_SYNC_STATUSES.MALFORMED_DATA,
        snapshotState: NOTION_SNAPSHOT_STATES.MALFORMED,
        now,
        code: LEGACY_FAILURE_CODES.MALFORMED_DATA,
        message: 'Legacy read port returned success without a snapshot.',
      });
    }
    return portErrorResult(portResult, now);
  }

  syncSnapshot(rawSnapshot, { now, authoritative = false } = {}) {
    const observedAt = assertNow(now);
    if (typeof authoritative !== 'boolean') throw new TypeError('authoritative must be an explicit boolean');

    let snapshot;
    try {
      snapshot = createLegacyCacheSnapshot(rawSnapshot, { observedAt });
    } catch (error) {
      const code = error instanceof LegacyCacheContractError
        ? error.code
        : LEGACY_FAILURE_CODES.MALFORMED_DATA;
      return failureResult({
        status: NOTION_SYNC_STATUSES.MALFORMED_DATA,
        snapshotState: NOTION_SNAPSHOT_STATES.MALFORMED,
        now: observedAt,
        code,
        message: 'Legacy snapshot failed schema validation; the batch was rejected.',
      });
    }

    if (snapshot.error?.code === LEGACY_FAILURE_CODES.STALE_CACHE) {
      const existing = new Map(this.repository.list({ source: this.policy.source })
        .map((task) => [task.external_id, task]));
      const evidence = snapshot.items.map((item) => createNotionSyncEvidence({
        external_id: item.id,
        local_id: existing.get(item.id)?.id ?? null,
        action: NOTION_SYNC_ACTIONS.SKIPPED,
        reason: 'stale_snapshot_not_applied',
      }));
      return failureResult({
        status: NOTION_SYNC_STATUSES.STALE_SKIPPED,
        snapshotState: NOTION_SNAPSHOT_STATES.STALE,
        now: observedAt,
        code: LEGACY_FAILURE_CODES.STALE_CACHE,
        message: 'Stale Legacy snapshot was not applied and cannot prove removals.',
        skipped: snapshot.items.length,
        evidence,
      });
    }
    if (snapshot.error?.code === LEGACY_FAILURE_CODES.CACHE_MISS) {
      return failureResult({
        status: NOTION_SYNC_STATUSES.CACHE_MISS,
        snapshotState: NOTION_SNAPSHOT_STATES.CACHE_MISS,
        now: observedAt,
        code: LEGACY_FAILURE_CODES.CACHE_MISS,
        message: 'Legacy cache is absent; local Tasks were not changed.',
      });
    }
    if (snapshot.error != null) {
      return failureResult({
        status: NOTION_SYNC_STATUSES.PORT_ERROR,
        snapshotState: NOTION_SNAPSHOT_STATES.PORT_ERROR,
        now: observedAt,
        code: snapshot.error.code,
        message: 'Legacy snapshot carries an error; local Tasks were not changed.',
        skipped: snapshot.items.length,
      });
    }

    const mappedEntries = [];
    const mappingErrors = [];
    for (const item of snapshot.items) {
      try {
        mappedEntries.push({
          item,
          task: this.mapper(item, {
            defaultTimezone: this.policy.timezone,
            observedAt,
          }).task,
        });
      } catch (error) {
        mappingErrors.push(safeMappingError(error, safeExternalId(item)));
      }
    }

    const ids = mappedEntries.map((entry) => entry.task.external_id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    duplicateIds.forEach((externalId) => mappingErrors.push({
      code: LEGACY_FAILURE_CODES.MALFORMED_DATA,
      external_id: externalId,
      field: 'external_id',
      message: 'Legacy snapshot contains duplicate external identity.',
    }));

    if (mappingErrors.length > 0) {
      const failedIds = new Set(mappingErrors.map((error) => error.external_id).filter(Boolean));
      const evidence = snapshot.items.map((item) => ({
        external_id: safeExternalId(item),
        local_id: null,
        action: failedIds.has(safeExternalId(item)) ? NOTION_SYNC_ACTIONS.FAILED : NOTION_SYNC_ACTIONS.SKIPPED,
        reason: failedIds.has(safeExternalId(item)) ? 'mapping_failed' : 'batch_rejected_due_to_mapping_error',
      }));
      return createNotionSyncResult({
        status: NOTION_SYNC_STATUSES.MALFORMED_DATA,
        snapshot_state: NOTION_SNAPSHOT_STATES.MALFORMED,
        skipped_count: snapshot.items.length - failedIds.size,
        error_count: mappingErrors.length,
        observed_at: observedAt,
        errors: mappingErrors,
        evidence,
      });
    }

    const existingNotionTasks = this.repository.list({ source: this.policy.source });
    const existingByExternal = new Map();
    const identityConflicts = [];
    for (const task of existingNotionTasks) {
      if (task.external_id == null) continue;
      if (existingByExternal.has(task.external_id)) {
        identityConflicts.push(task.external_id);
      } else {
        existingByExternal.set(task.external_id, task);
      }
    }

    const plans = [];
    for (const entry of mappedEntries) {
      const existing = existingByExternal.get(entry.task.external_id) ?? null;
      if (existing == null) {
        const occupied = this.repository.getById(entry.task.id);
        if (occupied != null) {
          identityConflicts.push(entry.task.external_id);
        } else {
          plans.push({ kind: 'create', ...entry, previous: null, next: entry.task });
        }
        continue;
      }
      let next;
      try {
        next = mergedTask(existing, entry.task, entry.item, observedAt);
      } catch {
        identityConflicts.push(entry.task.external_id);
        continue;
      }
      plans.push({
        kind: sameBusinessTask(existing, next) ? 'unchanged' : 'update',
        ...entry,
        previous: existing,
        next,
      });
    }

    if (identityConflicts.length > 0) {
      const unique = [...new Set(identityConflicts)];
      return createNotionSyncResult({
        status: NOTION_SYNC_STATUSES.CONFLICT,
        snapshot_state: authoritative
          ? NOTION_SNAPSHOT_STATES.FRESH_COMPLETE
          : NOTION_SNAPSHOT_STATES.FRESH_NON_AUTHORITATIVE,
        skipped_count: snapshot.items.length,
        error_count: unique.length,
        observed_at: observedAt,
        errors: unique.map((externalId) => ({
          code: 'IDENTITY_OR_DOMAIN_CONFLICT',
          external_id: externalId,
          field: 'external_id',
          message: 'Notion identity or local Task constraints conflict; batch was not applied.',
        })),
        evidence: mappedEntries.map((entry) => ({
          external_id: entry.task.external_id,
          local_id: existingByExternal.get(entry.task.external_id)?.id ?? null,
          action: NOTION_SYNC_ACTIONS.SKIPPED,
          reason: 'batch_rejected_due_to_identity_or_domain_conflict',
        })),
      });
    }

    const applied = [];
    try {
      for (const plan of plans) {
        if (plan.kind === 'create') {
          this.repository.create(plan.next);
          applied.push(plan);
        } else if (plan.kind === 'update') {
          replaceTask(this.repository, plan.previous, plan.next);
          applied.push(plan);
        }
      }
    } catch {
      try {
        rollbackApplied(this.repository, applied);
      } catch {
        throw new Error('Notion sync failed and repository rollback could not complete safely');
      }
      return createNotionSyncResult({
        status: NOTION_SYNC_STATUSES.CONFLICT,
        snapshot_state: authoritative
          ? NOTION_SNAPSHOT_STATES.FRESH_COMPLETE
          : NOTION_SNAPSHOT_STATES.FRESH_NON_AUTHORITATIVE,
        skipped_count: snapshot.items.length,
        error_count: 1,
        observed_at: observedAt,
        errors: [{
          code: 'REPOSITORY_WRITE_FAILED', external_id: null, field: null,
          message: 'Repository write failed; applied changes were rolled back.',
        }],
        evidence: mappedEntries.map((entry) => ({
          external_id: entry.task.external_id, local_id: null,
          action: NOTION_SYNC_ACTIONS.SKIPPED, reason: 'repository_batch_rolled_back',
        })),
      });
    }

    const evidence = plans.map((plan) => createNotionSyncEvidence({
      external_id: plan.task.external_id,
      local_id: plan.next.id,
      action: plan.kind === 'create'
        ? NOTION_SYNC_ACTIONS.CREATED
        : plan.kind === 'update'
          ? NOTION_SYNC_ACTIONS.UPDATED
          : NOTION_SYNC_ACTIONS.UNCHANGED,
      reason: plan.kind === 'create'
        ? 'first_import'
        : plan.kind === 'update'
          ? 'legacy_owned_fields_changed'
          : 'business_fields_identical',
    }));

    let missingCount = 0;
    if (authoritative) {
      const presentIds = new Set(mappedEntries.map((entry) => entry.task.external_id));
      for (const task of existingNotionTasks) {
        if (task.external_id != null && !presentIds.has(task.external_id)) {
          missingCount += 1;
          evidence.push(createNotionSyncEvidence({
            external_id: task.external_id,
            local_id: task.id,
            action: NOTION_SYNC_ACTIONS.MISSING_FROM_SOURCE,
            reason: 'absent_from_explicit_fresh_complete_snapshot_task_retained',
          }));
        }
      }
    }

    const createdCount = plans.filter((plan) => plan.kind === 'create').length;
    const updatedCount = plans.filter((plan) => plan.kind === 'update').length;
    const unchangedCount = plans.filter((plan) => plan.kind === 'unchanged').length;
    return createNotionSyncResult({
      status: createdCount > 0 || updatedCount > 0 || missingCount > 0
        ? NOTION_SYNC_STATUSES.SYNCED
        : NOTION_SYNC_STATUSES.NO_CHANGE,
      snapshot_state: authoritative
        ? NOTION_SNAPSHOT_STATES.FRESH_COMPLETE
        : NOTION_SNAPSHOT_STATES.FRESH_NON_AUTHORITATIVE,
      created_count: createdCount,
      updated_count: updatedCount,
      unchanged_count: unchangedCount,
      missing_from_source_count: missingCount,
      observed_at: observedAt,
      errors: [],
      evidence,
    });
  }
}

export function createNotionReadSyncService(options) {
  return new NotionReadSyncService(options);
}
