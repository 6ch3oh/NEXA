import {
  isValidDateOnlyString,
  isValidIsoTimestamp,
} from '../date/deterministic-parser.mjs';
import {
  instantForLocalDateTime,
  localDateForInstant,
} from '../rules/schedule-rules.mjs';

export const CALENDAR_HOME_SUMMARY_CONTRACT_VERSION = '0.2.0';

export const CALENDAR_HOME_SUBLABEL_PRIORITY = Object.freeze({
  IMPORTANT_REMINDER: 10,
  FIXED_SCHEDULE: 20,
  TODO_COUNT: 30,
  HOLIDAY: 40,
  EVENT: 50,
  EMPTY: 60,
});

const MAX_RANGE_DAYS = 62;

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

function requireDate(value, field) {
  if (!isValidDateOnlyString(value)) throw new TypeError(`${field} must be an ISO date`);
  return value;
}

function dateEpoch(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoDate(epoch) {
  return new Date(epoch).toISOString().slice(0, 10);
}

function rangeDates(startDate, endDate) {
  const start = dateEpoch(startDate);
  const end = dateEpoch(endDate);
  if (end < start) throw new RangeError('end_date must not be earlier than start_date');
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) throw new RangeError(`calendar range may not exceed ${MAX_RANGE_DAYS} days`);
  return Object.freeze(Array.from({ length: days }, (_, index) => isoDate(start + index * 86_400_000)));
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
    if (!Array.isArray(today[field])) throw new TypeError(`Today ViewModel.${field} must be an array`);
  }
  if (!isValidDateOnlyString(today.date)) throw new TypeError('Today ViewModel.date must be an ISO date');
  if (today.reminders !== undefined && !Array.isArray(today.reminders)) {
    throw new TypeError('Today ViewModel.reminders must be an array when provided');
  }
  return today;
}

function compactText(value, limit = 24) {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
}

function explicitEventKind(event) {
  const value = [event?.kind, event?.event_kind, event?.category]
    .find((candidate) => typeof candidate === 'string' && candidate.trim());
  return value ? value.trim().toLowerCase() : null;
}

function explicitCalendarLabel(today, kinds) {
  const collections = [
    ...(Array.isArray(today.holidays) ? today.holidays : []),
    ...(Array.isArray(today.anniversaries) ? today.anniversaries : []),
    ...today.fixed_calendar_events,
  ];
  for (const item of collections) {
    const kind = explicitEventKind(item);
    if (!kind || !kinds.has(kind)) continue;
    const label = compactText(item.label ?? item.title ?? item.name);
    if (label) return label;
  }
  return null;
}

function isExplicitCalendarLabelEvent(event) {
  return new Set(['holiday', 'festival', 'anniversary', '纪念日', '节日']).has(explicitEventKind(event));
}

function nextCalendarEvent(timeline, now, timezone) {
  const nowEpoch = instantForLocalDateTime(now, timezone);
  const entry = timeline.find((item) => item.type === 'calendar_event' && (
    item.item?.is_happening_now === true ||
    instantForLocalDateTime(item.start_at, timezone) >= nowEpoch
  ));
  return entry == null ? null : freezeItem(entry.item);
}

function handoff(date, action) {
  return Object.freeze({
    route_id: 'today-tomorrow',
    action,
    date,
  });
}

function chooseSublabel(today, todoCount) {
  const importantReminder = (today.reminders ?? []).find((item) => item?.requires_attention === true);
  if (importantReminder) {
    return Object.freeze({
      kind: 'important_reminder',
      text: compactText(`提醒：${importantReminder.title ?? '待处理'}`),
      priority: CALENDAR_HOME_SUBLABEL_PRIORITY.IMPORTANT_REMINDER,
    });
  }

  const fixedPlan = today.confirmed_task_plans.find((item) => compactText(item?.title));
  const fixedEvent = today.fixed_calendar_events.find((item) => (
    !isExplicitCalendarLabelEvent(item) && item?.status !== 'tentative' && compactText(item?.title)
  ));
  const fixed = fixedPlan ?? fixedEvent;
  if (fixed) {
    return Object.freeze({
      kind: 'fixed_schedule',
      text: compactText(fixed.title),
      priority: CALENDAR_HOME_SUBLABEL_PRIORITY.FIXED_SCHEDULE,
    });
  }

  if (todoCount > 0) {
    return Object.freeze({
      kind: 'todo_count',
      text: `待办 ${todoCount} 项`,
      priority: CALENDAR_HOME_SUBLABEL_PRIORITY.TODO_COUNT,
    });
  }

  const holiday = explicitCalendarLabel(today, new Set(['holiday', 'festival', '纪念日', '节日']));
  const anniversary = explicitCalendarLabel(today, new Set(['anniversary']));
  const calendarLabel = holiday ?? anniversary;
  if (calendarLabel) {
    return Object.freeze({
      kind: holiday ? 'holiday' : 'anniversary',
      text: calendarLabel,
      priority: CALENDAR_HOME_SUBLABEL_PRIORITY.HOLIDAY,
    });
  }

  const normalEvent = today.fixed_calendar_events.find((item) => compactText(item?.title));
  if (normalEvent) {
    return Object.freeze({
      kind: 'event',
      text: compactText(normalEvent.title),
      priority: CALENDAR_HOME_SUBLABEL_PRIORITY.EVENT,
    });
  }

  return Object.freeze({
    kind: 'empty',
    text: '暂无安排',
    priority: CALENDAR_HOME_SUBLABEL_PRIORITY.EMPTY,
  });
}

function projectDate(todayValue, { now, timezone }) {
  const today = requireTodayView(todayValue);
  const events = Object.freeze(today.fixed_calendar_events.map(freezeItem));
  const timeline = freezeTimeline(today.timeline);
  const todoCount = today.confirmed_task_plans.length + today.unplaced_tasks.length;
  const holidayLabel = explicitCalendarLabel(today, new Set(['holiday', 'festival', '节日']));
  const anniversaryLabel = explicitCalendarLabel(today, new Set(['anniversary', '纪念日']));
  const sublabel = chooseSublabel(today, todoCount);

  return Object.freeze({
    date: today.date,
    todo_count: todoCount,
    event_count: events.length,
    holiday_label: holidayLabel,
    anniversary_label: anniversaryLabel,
    sublabel: sublabel.text,
    sublabel_kind: sublabel.kind,
    sublabel_priority: sublabel.priority,
    events,
    next_event: nextCalendarEvent(timeline, now, timezone),
    timeline,
    detail_handoff: handoff(today.date, 'view-date'),
    edit_handoff: handoff(today.date, 'edit-date'),
    availability: 'available',
  });
}

function freshness(generatedAt) {
  return Object.freeze({
    status: 'unknown',
    reason: 'source_timestamp_unavailable',
    generated_at: generatedAt,
  });
}

export function createCalendarHomeSummaryAdapter(options) {
  const config = validateConfiguration(options);

  function getDateSummary(input = {}) {
    if (input == null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('getDateSummary input must be an object');
    }
    const now = explicitTimestamp(input.now ?? config.clock(), 'now');
    const date = requireDate(input.date ?? localDateForInstant(now, config.timezone), 'date');
    const summary = projectDate(config.calendarApplication.getToday(date, { now }), {
      now,
      timezone: config.timezone,
    });
    if (summary.date !== date) throw new TypeError('Today ViewModel.date must match the requested date');
    return Object.freeze({
      contract_version: CALENDAR_HOME_SUMMARY_CONTRACT_VERSION,
      ...summary,
      generated_at: now,
      freshness: freshness(now),
    });
  }

  return Object.freeze({
    getDateSummary,

    getMonthSummary(input = {}) {
      if (input == null || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('getMonthSummary input must be an object');
      }
      const now = explicitTimestamp(input.now ?? config.clock(), 'now');
      const startDate = requireDate(input.start_date, 'start_date');
      const endDate = requireDate(input.end_date, 'end_date');
      const dates = rangeDates(startDate, endDate).map((date) => {
        const summary = projectDate(config.calendarApplication.getToday(date, { now }), {
          now,
          timezone: config.timezone,
        });
        if (summary.date !== date) throw new TypeError('Today ViewModel.date must match the requested date');
        return summary;
      });
      const todayDate = localDateForInstant(now, config.timezone);
      const todaySummary = dates.find((item) => item.date === todayDate) ?? projectDate(
        config.calendarApplication.getToday(todayDate, { now }),
        { now, timezone: config.timezone },
      );

      return Object.freeze({
        contract_version: CALENDAR_HOME_SUMMARY_CONTRACT_VERSION,
        range: Object.freeze({ start_date: startDate, end_date: endDate }),
        dates: Object.freeze(dates),
        today_summary: todaySummary,
        next_event: todaySummary.next_event,
        availability: 'available',
        generated_at: now,
        freshness: freshness(now),
      });
    },
  });
}

