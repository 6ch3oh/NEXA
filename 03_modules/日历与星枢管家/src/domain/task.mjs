import { TEMPORAL_STATES, assertTemporalState } from './temporal-state.mjs';
import { isValidIsoDateOrTimestamp } from '../date/deterministic-parser.mjs';

export const TASK_STATUSES = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const TASK_STATUS_LIST = Object.freeze(Object.values(TASK_STATUSES));

export const TASK_PRIORITIES = Object.freeze({
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
});

export const TASK_PRIORITY_LIST = Object.freeze(Object.values(TASK_PRIORITIES));

export const LOCAL_SOURCE = 'local';

const DEFAULT_STATUS = TASK_STATUSES.PENDING;
const DEFAULT_PRIORITY = TASK_PRIORITIES.NORMAL;

function nowIso() {
  return new Date().toISOString();
}

function freezeDeep(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
  if (value && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freezeDeep(v)])),
    );
  }
  return value;
}

function defaultTimeStateFor(input) {
  const hasStart = input.start_at != null;
  const hasDue = input.due_at != null;
  if (!hasStart && !hasDue) return TEMPORAL_STATES.UNSCHEDULED;
  const values = [input.start_at, input.due_at].filter((v) => v != null);
  if (values.every((v) => !String(v).includes('T'))) return TEMPORAL_STATES.DATE_ONLY;
  return TEMPORAL_STATES.EXACT;
}

export function validateTask(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Task input must be an object');
  }
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new TypeError('Task id must be a non-empty string');
  }
  if (typeof input.title !== 'string' || input.title.trim() === '') {
    throw new TypeError('Task title must be a non-empty string');
  }
  if (typeof input.description !== 'string') {
    throw new TypeError('Task description must be a string');
  }
  if (!TASK_STATUS_LIST.includes(input.status)) {
    throw new TypeError(`Invalid task status "${input.status}"`);
  }
  if (!TASK_PRIORITY_LIST.includes(input.priority)) {
    throw new TypeError(`Invalid task priority "${input.priority}"`);
  }
  if (typeof input.source !== 'string' || input.source.trim() === '') {
    throw new TypeError('Task source must be a non-empty string');
  }
  if (input.external_id != null) {
    if (typeof input.external_id !== 'string' || input.external_id.trim() === '') {
      throw new TypeError('Task external_id must be a non-empty string when provided');
    }
    if (input.external_id === input.id) {
      throw new TypeError('Task external_id must differ from the local id');
    }
  }
  if (input.timezone != null && (typeof input.timezone !== 'string' || input.timezone.trim() === '')) {
    throw new TypeError('Task timezone must be a non-empty string when provided');
  }
  if (!Array.isArray(input.dependencies)) {
    throw new TypeError('Task dependencies must be an array of NEXA task id strings');
  }
  if (!input.dependencies.every((d) => typeof d === 'string' && d.trim() !== '')) {
    throw new TypeError('Task dependencies must be an array of NEXA task id strings');
  }
  if (input.dependencies.includes(input.id)) {
    throw new TypeError('Task must not depend on itself');
  }
  for (const field of ['start_at', 'due_at', 'completed_at']) {
    const value = input[field] ?? null;
    if (value != null && !isValidIsoDateOrTimestamp(value)) {
      throw new TypeError(`Invalid ISO timestamp for task.${field}: "${value}"`);
    }
  }
  if (input.start_at != null && input.due_at != null && input.due_at < input.start_at) {
    throw new TypeError('Task due_at must not be earlier than start_at');
  }
  if (input.completed_at != null && input.status !== TASK_STATUSES.COMPLETED) {
    throw new TypeError('Task completed_at requires status "completed"');
  }
  if (input.status === TASK_STATUSES.COMPLETED && input.completed_at == null) {
    throw new TypeError('Task status "completed" requires completed_at');
  }
  const timeState = input.time_state ?? defaultTimeStateFor(input);
  assertTemporalState(timeState);
  if (!isValidIsoDateOrTimestamp(input.created_at)) {
    throw new TypeError(`Invalid ISO timestamp for task.created_at: "${input.created_at}"`);
  }
  if (!isValidIsoDateOrTimestamp(input.updated_at)) {
    throw new TypeError(`Invalid ISO timestamp for task.updated_at: "${input.updated_at}"`);
  }
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    start_at: input.start_at ?? null,
    due_at: input.due_at ?? null,
    completed_at: input.completed_at ?? null,
    timezone: input.timezone ?? null,
    source: input.source,
    external_id: input.external_id ?? null,
    dependencies: [...input.dependencies],
    time_state: timeState,
    created_at: input.created_at,
    updated_at: input.updated_at,
  };
}

export function createTask(input, { now } = {}) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createTask expects an object');
  }
  const ts = now ?? nowIso();
  const base = {
    ...input,
    status: input.status ?? DEFAULT_STATUS,
    priority: input.priority ?? DEFAULT_PRIORITY,
    description: input.description ?? '',
    source: input.source ?? LOCAL_SOURCE,
    external_id: input.external_id ?? null,
    dependencies: input.dependencies ?? [],
    created_at: input.created_at ?? ts,
    updated_at: input.updated_at ?? ts,
  };
  return freezeDeep(validateTask(base));
}

export function updateTask(task, patch, { now } = {}) {
  if (!task || typeof task !== 'object' || typeof task.id !== 'string') {
    throw new TypeError('updateTask expects an existing task');
  }
  if (!patch || typeof patch !== 'object') {
    throw new TypeError('updateTask expects a patch object');
  }
  const ts = now ?? nowIso();
  const merged = { ...task, ...patch, id: task.id, created_at: task.created_at, updated_at: ts };
  return freezeDeep(validateTask(merged));
}

export function completeTask(task, { now } = {}) {
  const ts = now ?? nowIso();
  return updateTask(
    task,
    { status: TASK_STATUSES.COMPLETED, completed_at: task.completed_at ?? ts },
    { now: ts },
  );
}

export function cancelTask(task, { now } = {}) {
  const ts = now ?? nowIso();
  return updateTask(task, { status: TASK_STATUSES.CANCELLED, completed_at: null }, { now: ts });
}

export function blockedBy(task) {
  return [...(task.dependencies ?? [])];
}

export function hasDependencies(task) {
  return (task.dependencies ?? []).length > 0;
}

function resolveTaskById(tasksById, id) {
  if (!tasksById) return undefined;
  if (tasksById instanceof Map) return tasksById.get(id);
  return tasksById[id];
}

export function hasUncompletedDependencies(task, tasksById) {
  for (const depId of task.dependencies ?? []) {
    const dep = resolveTaskById(tasksById, depId);
    if (!dep || dep.status !== TASK_STATUSES.COMPLETED) return true;
  }
  return false;
}

export function allDependenciesCompleted(task, tasksById) {
  const deps = task.dependencies ?? [];
  if (deps.length === 0) return false;
  for (const depId of deps) {
    const dep = resolveTaskById(tasksById, depId);
    if (!dep || dep.status !== TASK_STATUSES.COMPLETED) return false;
  }
  return true;
}

export function isTaskBlocked(task, tasksById) {
  return hasUncompletedDependencies(task, tasksById);
}
