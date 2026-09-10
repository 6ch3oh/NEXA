import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInMemoryTaskStore, createInMemoryEventStore } from '../src/storage/in-memory-store.mjs';
import { TaskService } from '../src/services/task-service.mjs';
import { CalendarService } from '../src/services/calendar-service.mjs';
import { ScheduleQueryService } from '../src/services/schedule-query-service.mjs';
import { createCommand } from '../src/commands/contract.mjs';

const NOW = '2026-08-10T12:00:00+08:00';
const TIMEZONE = 'Asia/Shanghai';

function buildSchedule() {
  const taskRepository = createInMemoryTaskStore();
  const eventRepository = createInMemoryEventStore();
  const tasks = new TaskService(taskRepository);
  const calendar = new CalendarService(eventRepository);

  tasks.createTask({
    id: 'dependency', title: 'Dependency', due_at: '2026-08-12', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({
    id: 'blocked', title: 'Blocked', dependencies: ['dependency'], time_state: 'unscheduled', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({
    id: 'overdue', title: 'Overdue', due_at: '2026-08-09T18:00:00+08:00', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({
    id: 'today', title: 'Today', start_at: '2026-08-10T09:00:00+08:00', due_at: '2026-08-10T18:00:00+08:00', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({ id: 'unscheduled', title: 'Unscheduled', timezone: TIMEZONE }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({ id: 'ambiguous', title: 'Ambiguous', time_state: 'ambiguous' }, { now: '2026-08-01T08:00:00+08:00' });
  tasks.createTask({ id: 'relative', title: 'Relative', time_state: 'relative_unresolved' }, { now: '2026-08-01T08:00:00+08:00' });

  calendar.createEvent({
    id: 'today_event', title: 'Today event', start_at: '2026-08-10T11:00:00+08:00', end_at: '2026-08-10T13:00:00+08:00', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });
  calendar.createEvent({
    id: 'overnight', title: 'Overnight', start_at: '2026-08-10T23:00:00+08:00', end_at: '2026-08-11T01:00:00+08:00', timezone: TIMEZONE,
  }, { now: '2026-08-01T08:00:00+08:00' });

  const commands = [createCommand({
    command_id: 'delete_pending', command_type: 'task.delete', payload: { id: 'overdue' },
    created_at: NOW, confirmation_state: 'pending', source: 'local',
  })];

  return {
    tasks,
    calendar,
    taskRepository,
    eventRepository,
    service: new ScheduleQueryService({ taskService: tasks, calendarService: calendar, commandProvider: commands }),
  };
}

test('ScheduleQueryService day combines dated tasks/events, overdue, blocked, and confirmation', () => {
  const { service } = buildSchedule();
  const day = service.getDayView('2026-08-10', { now: NOW, timezone: TIMEZONE });
  assert.equal(day.date, '2026-08-10');
  assert.ok(day.tasks.some((task) => task.id === 'today'));
  assert.ok(day.events.some((event) => event.id === 'today_event'));
  assert.ok(day.events.some((event) => event.id === 'overnight'));
  assert.ok(day.overdue.some((task) => task.id === 'overdue'));
  assert.ok(day.blocked.some((task) => task.id === 'blocked'));
  assert.equal(day.needs_confirmation.length, 1);
  assert.equal(day.needs_confirmation[0].executable, false);
});

test('day excludes unscheduled, ambiguous, and relative tasks from dated buckets', () => {
  const { service } = buildSchedule();
  const day = service.getDayView('2026-08-10', { now: NOW, timezone: TIMEZONE });
  const ids = day.tasks.map((task) => task.id);
  assert.equal(ids.includes('unscheduled'), false);
  assert.equal(ids.includes('ambiguous'), false);
  assert.equal(ids.includes('relative'), false);
  assert.equal(day.tasks.some((task) => /\d{4}-\d{2}-\d{2}/.test(task.display_time) && ['ambiguous', 'relative'].includes(task.id)), false);
});

test('week query uses the existing explicit Monday-start rule', () => {
  const { service } = buildSchedule();
  const week = service.getWeekView('2026-08-13', { now: NOW, timezone: TIMEZONE });
  assert.equal(week.week_start, '2026-08-10');
  assert.equal(week.week_end, '2026-08-16');
  assert.equal(week.days.length, 7);
  assert.ok(week.days[0].tasks.some((task) => task.id === 'today'));
  assert.ok(week.days[1].events.some((event) => event.id === 'overnight'));
});

test('month query returns weeks and deterministic daily aggregation', () => {
  const { service } = buildSchedule();
  const month = service.getMonthView(2026, 8, { now: NOW, timezone: TIMEZONE });
  assert.equal(month.year, 2026);
  assert.equal(month.month, 8);
  assert.ok(month.weeks.length >= 5);
  assert.equal(month.summary.daily_counts.length, 31);
  const august10 = month.summary.daily_counts.find((day) => day.date === '2026-08-10');
  assert.ok(august10.tasks >= 1);
  assert.ok(august10.events >= 2);
});

test('ScheduleQueryService accepts repository abstractions directly', () => {
  const { taskRepository, eventRepository } = buildSchedule();
  const service = new ScheduleQueryService(taskRepository, eventRepository);
  const day = service.getDayView('2026-08-10', { now: NOW, timezone: TIMEZONE });
  assert.ok(day.tasks.some((task) => task.id === 'today'));
  assert.ok(day.events.some((event) => event.id === 'today_event'));

  const objectForm = new ScheduleQueryService({ taskRepository, eventRepository });
  assert.equal(objectForm.getDayView('2026-08-10', { now: NOW, timezone: TIMEZONE }).date, '2026-08-10');
});

test('schedule queries require explicit now and timezone', () => {
  const { service } = buildSchedule();
  assert.throws(() => service.getDayView('2026-08-10', { timezone: TIMEZONE }), /now/);
  assert.throws(() => service.getDayView('2026-08-10', { now: NOW }), /timezone/);
  assert.throws(() => service.getWeekView('2026-08-10', { now: NOW, timezone: 'Mars/Olympus' }), /Invalid timezone/);
  assert.throws(() => service.getMonthView(2026, 8, {}), /timezone|now/);
});
