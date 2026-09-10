import { addDays, buildMonthWeeks } from '../domain/schedule-view.mjs';
import { isValidDateOnlyString } from '../date/deterministic-parser.mjs';
import { taskOccursOnDate, eventOverlapsDate, assertTemporalContext } from '../rules/schedule-rules.mjs';
import { createTaskViewModel } from './task-view-model.mjs';
import { createCalendarEventViewModel } from './calendar-event-view-model.mjs';

function summarize(tasks, events) {
  return Object.freeze({
    task_count: tasks.length,
    event_count: events.length,
    overdue_count: tasks.filter((task) => task.is_overdue).length,
    blocked_count: tasks.filter((task) => task.is_blocked).length,
    attention_count: tasks.filter((task) => task.requires_attention).length,
  });
}

function aggregateDays(days) {
  return Object.freeze(days.reduce((total, day) => ({
    task_count: total.task_count + day.summary.task_count,
    event_count: total.event_count + day.summary.event_count,
    overdue_count: total.overdue_count + day.summary.overdue_count,
    blocked_count: total.blocked_count + day.summary.blocked_count,
    attention_count: total.attention_count + day.summary.attention_count,
  }), { task_count: 0, event_count: 0, overdue_count: 0, blocked_count: 0, attention_count: 0 }));
}

function assertCollections(tasks, events) {
  if (!Array.isArray(tasks) || !Array.isArray(events)) {
    throw new TypeError('tasks and events must be arrays');
  }
}

export function createDayViewModel(date, { tasks = [], events = [], now, timezone } = {}) {
  if (!isValidDateOnlyString(date)) throw new TypeError(`Invalid day date "${date}"`);
  assertCollections(tasks, events);
  assertTemporalContext(now, timezone);
  const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const dayTasks = tasks
    .filter((task) => taskOccursOnDate(task, date, timezone))
    .map((task) => createTaskViewModel(task, { tasksById, now, timezone }));
  const dayEvents = events
    .filter((event) => eventOverlapsDate(event, date, timezone))
    .map((event) => createCalendarEventViewModel(event, { now, timezone }));
  return Object.freeze({
    date,
    tasks: Object.freeze(dayTasks),
    events: Object.freeze(dayEvents),
    summary: summarize(dayTasks, dayEvents),
  });
}

export function createWeekViewModel(weekStart, options = {}) {
  if (!isValidDateOnlyString(weekStart)) throw new TypeError(`Invalid week start "${weekStart}"`);
  const days = Array.from({ length: 7 }, (_, index) => createDayViewModel(addDays(weekStart, index), options));
  return Object.freeze({
    week_start: weekStart,
    week_end: addDays(weekStart, 6),
    days: Object.freeze(days),
    summary: aggregateDays(days),
  });
}

export function createMonthViewModel(year, month, options = {}) {
  const grid = buildMonthWeeks(year, month);
  const monthPrefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  const weeks = grid.map((row) => {
    const days = row.days.map((cell) => Object.freeze({
      ...createDayViewModel(cell.date, options),
      in_month: cell.date.startsWith(monthPrefix),
    }));
    return Object.freeze({
      week_start: row.week_start,
      week_end: row.week_end,
      days: Object.freeze(days),
      summary: aggregateDays(days),
    });
  });
  const inMonthDays = weeks.flatMap((week) => week.days.filter((day) => day.in_month));
  return Object.freeze({
    year,
    month,
    weeks: Object.freeze(weeks),
    summary: Object.freeze({
      ...aggregateDays(inMonthDays),
      daily_counts: Object.freeze(inMonthDays.map((day) => Object.freeze({
        date: day.date,
        tasks: day.summary.task_count,
        events: day.summary.event_count,
        attention: day.summary.attention_count,
      }))),
    }),
  });
}

export const buildDayViewModel = createDayViewModel;
export const buildWeekViewModel = createWeekViewModel;
export const buildMonthViewModel = createMonthViewModel;
