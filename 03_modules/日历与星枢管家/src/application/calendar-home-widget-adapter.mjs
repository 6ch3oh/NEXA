import {
  isValidDateOnlyString,
  isValidIsoTimestamp,
  parseDateTime,
} from '../date/deterministic-parser.mjs';
import {
  instantForLocalDateTime,
  localDateForInstant,
} from '../rules/schedule-rules.mjs';

export const CALENDAR_HOME_WIDGET_CONTRACT_VERSION = '0.1.0';

function requireFunction(owner, method) {
  if (!owner || typeof owner[method] !== 'function') {
    throw new TypeError(`calendarApplication.${method} must be a function`);
  }
}

function validateConfiguration({ calendarApplication, timezone, clock } = {}) {
  requireFunction(calendarApplication, 'getToday');
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('timezone must be a non-empty explicit IANA timezone');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  return Object.freeze({ calendarApplication, timezone: timezone.trim(), clock });
}

function explicitTimestamp(value, field) {
  if (!isValidIsoTimestamp(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new TypeError(`${field} must be an explicit ISO timestamp`);
  }
  return value;
}

function freezeItem(item) {
  if (item == null || typeof item !== 'object') return item;
  return Object.freeze({ ...item });
}

function freezeTimeline(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze({
    ...entry,
    item: freezeItem(entry.item),
  })));
}

function requireTodayView(today) {
  if (!today || typeof today !== 'object') throw new TypeError('calendarApplication.getToday must return an object');
  for (const field of ['fixed_calendar_events', 'confirmed_task_plans', 'unplaced_tasks', 'timeline']) {
    if (!Array.isArray(today[field])) {
      throw new TypeError(`Today ViewModel.${field} must be an array`);
    }
  }
  if (!isValidDateOnlyString(today.date)) throw new TypeError('Today ViewModel.date must be an ISO date');
  return today;
}

function nextCalendarEvent(timeline, now, timezone) {
  const nowEpoch = instantForLocalDateTime(now, timezone);
  const entry = timeline.find((item) => item.type === 'calendar_event' && (
    item.item?.is_happening_now === true ||
    instantForLocalDateTime(item.start_at, timezone) >= nowEpoch
  ));
  return entry == null ? null : entry.item;
}

export function createCalendarHomeWidgetAdapter(options) {
  const config = validateConfiguration(options);

  return Object.freeze({
    getTodaySummary(input = {}) {
      if (input == null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('getTodaySummary input must be an object');
      }
      const now = explicitTimestamp(input.now ?? config.clock(), 'now');
      const date = input.date ?? localDateForInstant(now, config.timezone);
      if (!isValidDateOnlyString(date)) throw new TypeError('date must be an ISO date');

      const today = requireTodayView(config.calendarApplication.getToday(date, { now }));
      const events = Object.freeze(today.fixed_calendar_events.map(freezeItem));
      const timeline = freezeTimeline(today.timeline);
      const nextEvent = nextCalendarEvent(timeline, now, config.timezone);

      return Object.freeze({
        date: today.date,
        events,
        next_event: nextEvent,
        todo_count: today.confirmed_task_plans.length + today.unplaced_tasks.length,
        timeline,
      });
    },

    parseButlerInput(input) {
      return Object.freeze({ ...parseDateTime(input, { defaultTimezone: config.timezone }) });
    },
  });
}
