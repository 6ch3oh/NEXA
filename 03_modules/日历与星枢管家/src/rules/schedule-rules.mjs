import { isValidDateOnlyString, isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { TASK_STATUSES, isTaskBlocked } from '../domain/task.mjs';
import { EVENT_STATUSES } from '../domain/calendar-event.mjs';
import { TEMPORAL_STATES } from '../domain/temporal-state.mjs';
import { addDays } from '../domain/schedule-view.mjs';

export const TASK_RULE_FLAGS = Object.freeze([
  'completed',
  'cancelled',
  'overdue',
  'due_today',
  'upcoming',
  'blocked',
  'unscheduled',
  'ambiguous_time',
  'relative_unresolved',
  'scheduled_today',
]);

export const EVENT_RULE_FLAGS = Object.freeze([
  'happening_now',
  'upcoming',
  'ended',
  'all_day',
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

function fixedOffsetMinutes(timezone) {
  if (timezone === 'Z') return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) throw new TypeError(`Invalid timezone "${timezone}"`);
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

export function assertExplicitTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('timezone must be an explicit non-empty string');
  }
  const normalized = timezone.trim();
  const offset = fixedOffsetMinutes(normalized);
  if (offset != null) return normalized;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: normalized }).format(0);
  } catch {
    throw new TypeError(`Invalid timezone "${normalized}"`);
  }
  return normalized;
}

function partsFromEpoch(epoch, timezone) {
  const zone = assertExplicitTimezone(timezone);
  const offset = fixedOffsetMinutes(zone);
  if (offset != null) {
    const value = new Date(epoch + offset * 60_000);
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
    };
  }
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(epoch))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function parseWallParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(value);
  if (!match) throw new TypeError(`Expected a local ISO date-time, got "${value}"`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
}

function partsAsUtc(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function sameParts(left, right) {
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].every((key) => left[key] === right[key]);
}

export function instantForLocalDateTime(value, timezone) {
  const zone = assertExplicitTimezone(timezone);
  if (!isValidIsoTimestamp(value)) {
    throw new TypeError(`Invalid ISO timestamp "${value}"`);
  }
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch)) throw new TypeError(`Invalid ISO timestamp "${value}"`);
    return epoch;
  }

  const desired = parseWallParts(value);
  const offset = fixedOffsetMinutes(zone);
  if (offset != null) return partsAsUtc(desired) - offset * 60_000;

  let candidate = partsAsUtc(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const seen = partsFromEpoch(candidate, zone);
    const difference = partsAsUtc(desired) - partsAsUtc(seen);
    if (difference === 0) break;
    candidate += difference;
  }
  if (!sameParts(partsFromEpoch(candidate, zone), desired)) {
    throw new RangeError(`Local date-time "${value}" is invalid or ambiguous in timezone "${zone}"`);
  }
  return candidate;
}

export function assertTemporalContext(now, timezone) {
  const zone = assertExplicitTimezone(timezone);
  if (!isValidIsoTimestamp(now)) {
    throw new TypeError('now must be an explicit valid ISO timestamp');
  }
  const epoch = instantForLocalDateTime(now, zone);
  return Object.freeze({ now, timezone: zone, epoch, today: localDateForEpoch(epoch, zone) });
}

export function localDateForEpoch(epoch, timezone) {
  const parts = partsFromEpoch(epoch, timezone);
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function localDateForInstant(value, timezone, sourceTimezone = timezone) {
  if (isValidDateOnlyString(value)) return value;
  return localDateForEpoch(instantForLocalDateTime(value, sourceTimezone), timezone);
}

export function localDateTimeForEpoch(epoch, timezone) {
  const p = partsFromEpoch(epoch, timezone);
  return `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

export function localDayBounds(date, timezone) {
  if (!isValidDateOnlyString(date)) throw new TypeError(`Invalid date "${date}"`);
  return Object.freeze({
    start: instantForLocalDateTime(`${date}T00:00:00`, timezone),
    end: instantForLocalDateTime(`${addDays(date, 1)}T00:00:00`, timezone),
  });
}

function clearTaskTime(task) {
  return task.time_state === TEMPORAL_STATES.EXACT || task.time_state === TEMPORAL_STATES.DATE_ONLY;
}

function taskValueDate(value, task, timezone) {
  if (value == null) return null;
  if (isValidDateOnlyString(value)) return value;
  return localDateForInstant(value, timezone, task.timezone ?? timezone);
}

export function classifyTask(task, { tasksById = {}, now, timezone } = {}) {
  const context = assertTemporalContext(now, timezone);
  const completed = task.status === TASK_STATUSES.COMPLETED;
  const cancelled = task.status === TASK_STATUSES.CANCELLED;
  const active = !completed && !cancelled;
  const clear = clearTaskTime(task);
  const dueDate = clear ? taskValueDate(task.due_at, task, context.timezone) : null;
  let overdue = false;
  let futureDue = false;
  if (active && task.due_at != null && clear) {
    if (task.time_state === TEMPORAL_STATES.DATE_ONLY) {
      overdue = dueDate < context.today;
      futureDue = dueDate > context.today;
    } else {
      const dueEpoch = instantForLocalDateTime(task.due_at, task.timezone ?? context.timezone);
      overdue = dueEpoch < context.epoch;
      futureDue = dueEpoch > context.epoch;
    }
  }
  const startDate = clear ? taskValueDate(task.start_at, task, context.timezone) : null;
  const flags = Object.freeze({
    completed,
    cancelled,
    overdue,
    due_today: active && dueDate === context.today,
    upcoming: active && futureDue && dueDate > context.today,
    blocked: active && isTaskBlocked(task, tasksById),
    unscheduled: task.time_state === TEMPORAL_STATES.UNSCHEDULED,
    ambiguous_time: task.time_state === TEMPORAL_STATES.AMBIGUOUS,
    relative_unresolved: task.time_state === TEMPORAL_STATES.RELATIVE_UNRESOLVED,
    scheduled_today: active && startDate === context.today,
  });
  const suggestions = [];
  if (flags.overdue) suggestions.push('review_overdue_task');
  if (flags.blocked) suggestions.push('resolve_task_dependencies');
  if (flags.unscheduled) suggestions.push('schedule_task');
  if (flags.ambiguous_time || flags.relative_unresolved) suggestions.push('clarify_task_time');
  return Object.freeze({ task_id: task.id, flags, suggestions: Object.freeze(suggestions) });
}

function eventEpoch(value, event, timezone) {
  return instantForLocalDateTime(value, event.timezone ?? timezone);
}

export function classifyCalendarEvent(event, { now, timezone } = {}) {
  const context = assertTemporalContext(now, timezone);
  const active = event.status !== EVENT_STATUSES.CANCELLED;
  let happeningNow = false;
  let upcoming = false;
  let ended = false;
  if (event.all_day) {
    const startDate = event.start_at;
    const endDate = event.end_at ?? event.start_at;
    happeningNow = active && startDate <= context.today && endDate >= context.today;
    upcoming = active && startDate > context.today;
    ended = endDate < context.today;
  } else {
    const start = eventEpoch(event.start_at, event, context.timezone);
    const end = eventEpoch(event.end_at, event, context.timezone);
    happeningNow = active && start <= context.epoch && context.epoch < end;
    upcoming = active && start > context.epoch;
    ended = end <= context.epoch;
  }
  return Object.freeze({
    event_id: event.id,
    flags: Object.freeze({
      happening_now: happeningNow,
      upcoming,
      ended,
      all_day: event.all_day === true,
    }),
    suggestions: Object.freeze([]),
  });
}

export function taskOccursOnDate(task, date, timezone) {
  assertExplicitTimezone(timezone);
  if (!isValidDateOnlyString(date) || !clearTaskTime(task)) return false;
  const startDate = taskValueDate(task.start_at, task, timezone);
  const dueDate = taskValueDate(task.due_at, task, timezone);
  return startDate === date || dueDate === date;
}

export function eventOverlapsDate(event, date, timezone) {
  assertExplicitTimezone(timezone);
  if (!isValidDateOnlyString(date)) return false;
  if (event.all_day) {
    return event.start_at <= date && (event.end_at ?? event.start_at) >= date;
  }
  const bounds = localDayBounds(date, timezone);
  const start = eventEpoch(event.start_at, event, timezone);
  const end = eventEpoch(event.end_at, event, timezone);
  return start < bounds.end && end > bounds.start;
}

export function evaluateScheduleRules({ tasks = [], events = [], now, timezone } = {}) {
  assertTemporalContext(now, timezone);
  if (!Array.isArray(tasks) || !Array.isArray(events)) {
    throw new TypeError('tasks and events must be arrays');
  }
  const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  return Object.freeze({
    tasks: Object.freeze(tasks.map((task) => classifyTask(task, { tasksById, now, timezone }))),
    events: Object.freeze(events.map((event) => classifyCalendarEvent(event, { now, timezone }))),
  });
}
