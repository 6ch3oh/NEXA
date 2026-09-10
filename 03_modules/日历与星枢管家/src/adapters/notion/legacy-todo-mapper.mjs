import { isValidIsoTimestamp, parseDateTime } from '../../date/deterministic-parser.mjs';
import { TEMPORAL_STATES } from '../../domain/temporal-state.mjs';
import { createTask, TASK_PRIORITIES, TASK_STATUSES } from '../../domain/task.mjs';
import {
  NOTION_SOURCE,
  NotionInvalidValueError,
  NotionMissingFieldError,
  toLocalTaskId,
} from './contract.mjs';

export const LEGACY_STATUS_MAP = Object.freeze({
  '待开始': TASK_STATUSES.PENDING,
  '进行中': TASK_STATUSES.IN_PROGRESS,
  '已完成': TASK_STATUSES.COMPLETED,
});

export const LEGACY_PRIORITY_MAP = Object.freeze({
  '🔴 高': TASK_PRIORITIES.HIGH,
  '🟡 中': TASK_PRIORITIES.NORMAL,
  '🟢 低': TASK_PRIORITIES.LOW,
});

function mapStatus(value) {
  const status = LEGACY_STATUS_MAP[value];
  if (!status) {
    throw new NotionInvalidValueError(`Unknown Legacy Notion Todo status "${String(value)}"`, {
      field: 'status', external: value ?? null,
    });
  }
  return status;
}

function mapPriority(value) {
  if (value == null || value === '') {
    return {
      priority: TASK_PRIORITIES.NORMAL,
      provenance: 'LEGACY_PRIORITY_ABSENT -> NEXA_DEFAULT',
    };
  }
  const priority = LEGACY_PRIORITY_MAP[value];
  if (!priority) {
    throw new NotionInvalidValueError(`Unknown Legacy Notion Todo priority "${String(value)}"`, {
      field: 'priority', external: value,
    });
  }
  return { priority, provenance: 'LEGACY_PRIORITY_MAPPED' };
}

function mapDue(due, defaultTimezone) {
  if (due == null) {
    return { due_at: null, timezone: null, time_state: TEMPORAL_STATES.UNSCHEDULED, input: null };
  }
  if (!due || typeof due !== 'object' || Array.isArray(due)) {
    throw new NotionInvalidValueError('Legacy due must be an object or null', {
      field: 'due', external: due,
    });
  }
  if (typeof due.start !== 'string' || due.start.trim() === '') {
    throw new NotionInvalidValueError('Legacy due.start must be non-empty', {
      field: 'due.start', external: due.start ?? null,
    });
  }
  let parsed;
  try {
    parsed = parseDateTime(due.start, { defaultTimezone: due.timeZone || defaultTimezone });
  } catch (error) {
    throw new NotionInvalidValueError(`Cannot map Legacy due.start: ${error.message}`, {
      field: 'due.start', external: due.start,
    });
  }
  return {
    due_at: parsed.start_at,
    timezone: parsed.timezone,
    time_state: parsed.time_state,
    input: due.start,
  };
}

export function mapLegacyTodoToTask(legacy, { defaultTimezone, observedAt } = {}) {
  if (!isValidIsoTimestamp(observedAt)) {
    throw new NotionInvalidValueError('observedAt must be an explicit ISO timestamp', {
      field: 'observedAt',
    });
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new NotionMissingFieldError('Legacy Notion Todo item is required');
  }
  if (typeof legacy.id !== 'string' || legacy.id.trim() === '') {
    throw new NotionMissingFieldError('Legacy Notion Todo id is required', { field: 'id' });
  }
  if (typeof legacy.title !== 'string' || legacy.title.trim() === '') {
    throw new NotionMissingFieldError('Legacy Notion Todo title is required', { field: 'title' });
  }
  const status = mapStatus(legacy.status);
  const priority = mapPriority(legacy.priority);
  const due = mapDue(legacy.due ?? null, defaultTimezone);
  const task = createTask({
    id: toLocalTaskId(legacy.id),
    title: legacy.title,
    description: '',
    status,
    priority: priority.priority,
    start_at: null,
    due_at: due.due_at,
    completed_at: status === TASK_STATUSES.COMPLETED ? observedAt : null,
    timezone: due.timezone,
    source: NOTION_SOURCE,
    external_id: legacy.id,
    dependencies: [],
    time_state: due.time_state,
  }, { now: observedAt });
  return Object.freeze({
    ok: true,
    task,
    evidence: Object.freeze({
      external_reference: typeof legacy.url === 'string' && legacy.url !== '' ? legacy.url : null,
      legacy_status: legacy.status,
      legacy_priority: legacy.priority || null,
      priority_provenance: priority.provenance,
      temporal_input: due.input,
      legacy_due_end: legacy.due?.end ?? null,
      observation_metadata: 'created_at/updated_at are local ingestion observation time, not Notion page metadata',
      completion_metadata: status === TASK_STATUSES.COMPLETED
        ? 'completed_at is local observation time because Legacy schema exposes no completion timestamp'
        : null,
    }),
  });
}

export function mapLegacyTodoCollection(items, options = {}) {
  if (!Array.isArray(items)) throw new TypeError('Legacy Notion Todo collection must be an array');
  const tasks = [];
  const failures = [];
  items.forEach((item, index) => {
    try {
      tasks.push(mapLegacyTodoToTask(item, options).task);
    } catch (error) {
      failures.push(Object.freeze({
        index,
        external_id: typeof item?.id === 'string' && item.id.trim() !== '' ? item.id : null,
        code: error?.code ?? 'mapping_error',
        field: error?.field ?? null,
        message: error instanceof Error ? error.message : 'Unknown mapping failure',
      }));
    }
  });
  return Object.freeze({ tasks: Object.freeze(tasks), failures: Object.freeze(failures) });
}
