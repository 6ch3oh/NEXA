import { TEMPORAL_STATES } from '../../domain/temporal-state.mjs';
import { createTask, TASK_STATUSES } from '../../domain/task.mjs';
import { createCalendarEvent, EVENT_STATUSES } from '../../domain/calendar-event.mjs';
import { parseDateTime } from '../../date/deterministic-parser.mjs';

export const NOTION_SOURCE = 'notion';

export class NotionAdapterError extends Error {}

export class NotionMappingError extends NotionAdapterError {
  constructor(message, options = {}) {
    super(message);
    this.name = 'NotionMappingError';
    this.kind = options.kind ?? 'mapping_error';
    this.code = options.code ?? 'mapping_error';
    this.field = options.field ?? null;
    this.external = options.external ?? null;
  }
}

export class NotionMissingFieldError extends NotionMappingError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'missing_field', code: 'missing_field' });
    this.name = 'NotionMissingFieldError';
  }
}

export class NotionUnsupportedFieldError extends NotionMappingError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'unsupported_field', code: 'unsupported_field' });
    this.name = 'NotionUnsupportedFieldError';
  }
}

export class NotionInvalidValueError extends NotionMappingError {
  constructor(message, options = {}) {
    super(message, { ...options, kind: 'invalid_value', code: 'invalid_value' });
    this.name = 'NotionInvalidValueError';
  }
}

const EXTERNAL_TO_LOCAL_STATUS = Object.freeze({
  'Not started': TASK_STATUSES.PENDING,
  'Todo': TASK_STATUSES.PENDING,
  'To do': TASK_STATUSES.PENDING,
  'In progress': TASK_STATUSES.IN_PROGRESS,
  'Doing': TASK_STATUSES.IN_PROGRESS,
  'Done': TASK_STATUSES.COMPLETED,
  'Completed': TASK_STATUSES.COMPLETED,
  'Cancelled': TASK_STATUSES.CANCELLED,
  'Canceled': TASK_STATUSES.CANCELLED,
});

const LOCAL_TO_EXTERNAL_STATUS = Object.freeze({
  [TASK_STATUSES.PENDING]: 'To do',
  [TASK_STATUSES.IN_PROGRESS]: 'In progress',
  [TASK_STATUSES.COMPLETED]: 'Done',
  [TASK_STATUSES.CANCELLED]: 'Cancelled',
});

const EXTERNAL_PRIORITY_MAP = Object.freeze({
  urgent: 'urgent',
  high: 'high',
  normal: 'normal',
  medium: 'normal',
  low: 'low',
});

const LOCAL_PRIORITY_TO_EXTERNAL = Object.freeze({
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
});

const EXTERNAL_EVENT_STATUS_MAP = Object.freeze({
  Confirmed: EVENT_STATUSES.CONFIRMED,
  Tentative: EVENT_STATUSES.TENTATIVE,
  Free: EVENT_STATUSES.TENTATIVE,
  Busy: EVENT_STATUSES.CONFIRMED,
  Cancelled: EVENT_STATUSES.CANCELLED,
  Canceled: EVENT_STATUSES.CANCELLED,
});

const UNSUPPORTED_TASK_FIELDS = ['dependencies', 'reminders', 'recurrence', 'assignees'];
const UNSUPPORTED_EVENT_FIELDS = ['attendees', 'reminders', 'recurrence'];

export const notionCapabilities = Object.freeze({
  name: 'notion-adapter-v0.1',
  supportsNetwork: false,
  requiresSdk: false,
  externalIdField: 'id',
  task: Object.freeze({
    supportedStatuses: Object.freeze(Object.keys(EXTERNAL_TO_LOCAL_STATUS)),
    supportsDependencies: false,
    unsupportedFields: Object.freeze(UNSUPPORTED_TASK_FIELDS),
  }),
  calendar: Object.freeze({
    supportsAllDay: true,
    unsupportedFields: Object.freeze(UNSUPPORTED_EVENT_FIELDS),
  }),
});

export function toLocalTaskId(externalId) {
  return `local_task_${externalId}`;
}

export function toLocalEventId(externalId) {
  return `local_event_${externalId}`;
}

export function findUnsupportedFields(external, unsupportedFields = []) {
  if (!external || typeof external !== 'object') return [];
  const found = [];
  for (const key of unsupportedFields) {
    if (key in external && external[key] != null && !(Array.isArray(external[key]) && external[key].length === 0)) {
      found.push(key);
    }
  }
  return found;
}

function mapExternalTaskStatus(externalStatus) {
  const status = EXTERNAL_TO_LOCAL_STATUS[externalStatus];
  if (!status) {
    throw new NotionInvalidValueError(`Unknown external task status "${externalStatus}"`, {
      field: 'status',
      external: externalStatus,
    });
  }
  return status;
}

function mapExternalPriority(value) {
  if (value == null || value === '') return 'normal';
  const normalized = String(value).toLowerCase();
  return EXTERNAL_PRIORITY_MAP[normalized] ?? 'normal';
}

function mapLocalPriorityToExternal(value) {
  return LOCAL_PRIORITY_TO_EXTERNAL[value] ?? value;
}

function mapExternalEventStatus(value) {
  if (value == null || value === '') return EVENT_STATUSES.CONFIRMED;
  return EXTERNAL_EVENT_STATUS_MAP[value] ?? EVENT_STATUSES.TENTATIVE;
}

function safeParseDate(value, defaultTimezone, field) {
  let result;
  try {
    result = parseDateTime(value, { defaultTimezone });
  } catch (err) {
    throw new NotionInvalidValueError(`Cannot map external ${field} "${value}": ${err.message}`, {
      field,
      external: value,
    });
  }
  if (result.time_state !== TEMPORAL_STATES.EXACT && result.time_state !== TEMPORAL_STATES.DATE_ONLY) {
    throw new NotionInvalidValueError(
      `External ${field} "${value}" must map to an exact or date-only time, got "${result.time_state}"`,
      { field, external: value },
    );
  }
  return result;
}

function mapTaskDates(external, { defaultTimezone }) {
  let start_at = null;
  let due_at = null;
  let time_state = TEMPORAL_STATES.UNSCHEDULED;
  let timezone = null;
  if (external.start != null && external.start !== '') {
    const parsed = safeParseDate(external.start, defaultTimezone, 'start');
    start_at = parsed.start_at;
    time_state = parsed.time_state;
    timezone = parsed.timezone;
  }
  if (external.due != null && external.due !== '') {
    const parsed = safeParseDate(external.due, defaultTimezone, 'due');
    due_at = parsed.start_at;
    if (time_state === TEMPORAL_STATES.UNSCHEDULED) {
      time_state = parsed.time_state;
      timezone = parsed.timezone;
    }
  }
  return { start_at, due_at, time_state, timezone };
}

function mapEventDates(external, { defaultTimezone }) {
  let start_at = null;
  let end_at = null;
  let timezone = null;
  if (external.start == null || external.start === '') {
    throw new NotionMissingFieldError('External event start is required', { field: 'start' });
  }
  const startParsed = safeParseDate(external.start, defaultTimezone, 'start');
  start_at = startParsed.start_at;
  timezone = startParsed.timezone;
  if (external.end != null && external.end !== '') {
    const endParsed = safeParseDate(external.end, defaultTimezone, 'end');
    end_at = endParsed.start_at;
  }
  return { start_at, end_at, timezone };
}

export function externalTaskToTask(external, options = {}) {
  const { defaultTimezone, strict = false, now } = options;
  if (!external || typeof external !== 'object') {
    throw new NotionMissingFieldError('external task object is required');
  }
  if (typeof external.id !== 'string' || external.id.trim() === '') {
    throw new NotionMissingFieldError('external task id is required', { field: 'id' });
  }
  if (typeof external.title !== 'string' || external.title.trim() === '') {
    throw new NotionMissingFieldError('external task title is required', { field: 'title' });
  }
  const warnings = [];
  const unsupported = findUnsupportedFields(external, UNSUPPORTED_TASK_FIELDS);
  if (unsupported.length > 0) {
    const err = new NotionUnsupportedFieldError(
      `Unsupported field(s) for Notion task mapping: ${unsupported.join(', ')}`,
      { field: unsupported.join(',') },
    );
    if (strict) throw err;
    warnings.push(err);
  }

  const status = mapExternalTaskStatus(external.status ?? 'Not started');
  const priority = mapExternalPriority(external.priority);
  const { start_at, due_at, time_state, timezone } = mapTaskDates(external, { defaultTimezone });

  const completed_at =
    status === TASK_STATUSES.COMPLETED
      ? external.completed_at ?? now ?? new Date().toISOString()
      : null;

  const task = createTask(
    {
      id: toLocalTaskId(external.id),
      title: external.title,
      description: external.description ?? '',
      status,
      priority,
      start_at,
      due_at,
      completed_at,
      timezone: timezone ?? null,
      source: NOTION_SOURCE,
      external_id: external.id,
      dependencies: [],
      time_state,
    },
    { now },
  );
  return { ok: true, task, warnings };
}

export function taskToExternalPayload(task, options = {}) {
  const { strict = false } = options;
  if (!task || typeof task !== 'object' || typeof task.id !== 'string') {
    throw new NotionMissingFieldError('task object with a local id is required');
  }
  const warnings = [];
  if (Array.isArray(task.dependencies) && task.dependencies.length > 0) {
    const err = new NotionUnsupportedFieldError(
      'Notion does not support task dependencies; they are omitted from the external payload',
      { field: 'dependencies' },
    );
    if (strict) throw err;
    warnings.push(err);
  }
  return {
    ok: true,
    payload: {
      id: task.external_id ?? null,
      title: task.title,
      status: LOCAL_TO_EXTERNAL_STATUS[task.status] ?? task.status,
      priority: mapLocalPriorityToExternal(task.priority),
      start: task.start_at ?? null,
      due: task.due_at ?? null,
    },
    warnings,
  };
}

export function externalEventToCalendarEvent(external, options = {}) {
  const { defaultTimezone, strict = false, now } = options;
  if (!external || typeof external !== 'object') {
    throw new NotionMissingFieldError('external event object is required');
  }
  if (typeof external.id !== 'string' || external.id.trim() === '') {
    throw new NotionMissingFieldError('external event id is required', { field: 'id' });
  }
  if (typeof external.title !== 'string' || external.title.trim() === '') {
    throw new NotionMissingFieldError('external event title is required', { field: 'title' });
  }
  const warnings = [];
  const unsupported = findUnsupportedFields(external, UNSUPPORTED_EVENT_FIELDS);
  if (unsupported.length > 0) {
    const err = new NotionUnsupportedFieldError(
      `Unsupported field(s) for Notion event mapping: ${unsupported.join(', ')}`,
      { field: unsupported.join(',') },
    );
    if (strict) throw err;
    warnings.push(err);
  }

  const all_day = external.all_day === true;
  const { start_at, end_at, timezone } = mapEventDates(external, { defaultTimezone });
  const status = mapExternalEventStatus(external.status);

  const event = createCalendarEvent(
    {
      id: toLocalEventId(external.id),
      title: external.title,
      description: external.description ?? '',
      start_at,
      end_at,
      all_day,
      timezone: timezone ?? null,
      location: external.location ?? '',
      status,
      source: NOTION_SOURCE,
      external_id: external.id,
    },
    { now },
  );
  return { ok: true, event, warnings };
}

export function calendarEventToExternalPayload(event, options = {}) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    throw new NotionMissingFieldError('event object with a local id is required');
  }
  return {
    ok: true,
    payload: {
      id: event.external_id ?? null,
      title: event.title,
      start: event.start_at ?? null,
      end: event.end_at ?? null,
      all_day: event.all_day === true,
      location: event.location ?? null,
      status: event.status,
    },
    warnings: [],
  };
}
