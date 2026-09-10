import { isValidIsoTimestamp, isValidIsoDateOrTimestamp } from '../date/deterministic-parser.mjs';

export const DAILY_PLAN_STATES = Object.freeze({
  DAY_ASSIGNED: 'day_assigned',
  TIME_CONFIRMED: 'time_confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});
export const TIME_CONFIRMATION_STATES = Object.freeze({
  UNCONFIRMED: 'time_unconfirmed',
  CONFIRMED: 'time_confirmed',
});
export const CARRYOVER_DECISIONS = Object.freeze({
  NONE: 'none', CONFIRMED: 'confirmed', REJECTED: 'rejected',
});

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value;
}
function dateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isValidIsoDateOrTimestamp(value)) {
    throw new TypeError(`${field} must be an ISO date`);
  }
  return value;
}
function timestamp(value, field, nullable = false) {
  if (value == null && nullable) return null;
  if (!isValidIsoTimestamp(value)) throw new TypeError(`${field} must be an ISO timestamp`);
  return value;
}

export function validateDailyPlanEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('DailyPlanEntry must be an object');
  nonEmpty(input.id, 'id');
  nonEmpty(input.task_id, 'task_id');
  const planDate = dateOnly(input.plan_date, 'plan_date');
  if (!Object.values(DAILY_PLAN_STATES).includes(input.state)) throw new TypeError(`Invalid daily plan state "${input.state}"`);
  if (!Object.values(TIME_CONFIRMATION_STATES).includes(input.time_confirmation_state)) {
    throw new TypeError(`Invalid time_confirmation_state "${input.time_confirmation_state}"`);
  }
  const start = timestamp(input.planned_start_at ?? null, 'planned_start_at', true);
  const end = timestamp(input.planned_end_at ?? null, 'planned_end_at', true);
  const confirmed = input.time_confirmation_state === TIME_CONFIRMATION_STATES.CONFIRMED;
  if (confirmed && (start == null || end == null)) throw new TypeError('confirmed plan requires planned_start_at and planned_end_at');
  if (!confirmed && (start != null || end != null)) throw new TypeError('unconfirmed plan must not carry planned time');
  if (start != null && end <= start) throw new RangeError('planned_end_at must be later than planned_start_at');
  if (start != null && start.slice(0, 10) !== planDate) throw new TypeError('planned_start_at must be on plan_date');
  if (!Number.isInteger(input.position) || input.position < 0) throw new TypeError('position must be a non-negative integer');
  if (typeof input.pinned !== 'boolean') throw new TypeError('pinned must be boolean');
  if (!Object.values(CARRYOVER_DECISIONS).includes(input.carryover_decision)) throw new TypeError('invalid carryover_decision');
  return Object.freeze({
    id: input.id,
    task_id: input.task_id,
    plan_date: planDate,
    planned_start_at: start,
    planned_end_at: end,
    timezone: confirmed ? nonEmpty(input.timezone, 'timezone') : null,
    time_confirmation_state: input.time_confirmation_state,
    state: input.state,
    position: input.position,
    pinned: input.pinned,
    source: nonEmpty(input.source, 'source'),
    carryover_from_date: input.carryover_from_date == null ? null : dateOnly(input.carryover_from_date, 'carryover_from_date'),
    carryover_decision: input.carryover_decision,
    created_at: timestamp(input.created_at, 'created_at'),
    updated_at: timestamp(input.updated_at, 'updated_at'),
  });
}

export function createDailyPlanEntry(input, { now } = {}) {
  return validateDailyPlanEntry({
    ...input,
    state: input.state ?? DAILY_PLAN_STATES.DAY_ASSIGNED,
    planned_start_at: input.planned_start_at ?? null,
    planned_end_at: input.planned_end_at ?? null,
    timezone: input.timezone ?? null,
    time_confirmation_state: input.time_confirmation_state ?? TIME_CONFIRMATION_STATES.UNCONFIRMED,
    position: input.position ?? 0,
    pinned: input.pinned ?? false,
    source: input.source ?? 'local',
    carryover_from_date: input.carryover_from_date ?? null,
    carryover_decision: input.carryover_decision ?? CARRYOVER_DECISIONS.NONE,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
  });
}

export function updateDailyPlanEntry(entry, patch, { now } = {}) {
  return validateDailyPlanEntry({ ...entry, ...patch, id: entry.id, task_id: entry.task_id, created_at: entry.created_at, updated_at: now });
}
