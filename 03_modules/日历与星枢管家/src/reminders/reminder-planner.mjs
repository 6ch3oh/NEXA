import { EVENT_STATUSES } from '../domain/calendar-event.mjs';
import {
  REMINDER_KINDS,
  REMINDER_SOURCE_TYPES,
  REMINDER_STATES,
  calculateReminderState,
  createReminder,
  validateReminder,
} from '../domain/reminder.mjs';
import { TASK_STATUSES } from '../domain/task.mjs';
import { TEMPORAL_STATES } from '../domain/temporal-state.mjs';
import {
  assertTemporalContext,
  instantForLocalDateTime,
} from '../rules/schedule-rules.mjs';
import { createNotificationIntent } from './notification-intent.mjs';

function optionalOffset(value, field) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative integer or null`);
  return value;
}

function optionalClock(value, field) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new TypeError(`${field} must be HH:mm or HH:mm:ss when provided`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

export function validateReminderPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('reminder policy must be an explicit object');
  }
  return Object.freeze({
    task_due_minutes_before: optionalOffset(
      policy.task_due_minutes_before ?? policy.taskDueMinutesBefore ?? null,
      'task_due_minutes_before',
    ),
    task_upcoming_minutes_before: optionalOffset(
      policy.task_upcoming_minutes_before ?? policy.taskUpcomingMinutesBefore ?? null,
      'task_upcoming_minutes_before',
    ),
    event_start_minutes_before: optionalOffset(
      policy.event_start_minutes_before ?? policy.eventStartMinutesBefore ?? null,
      'event_start_minutes_before',
    ),
    date_only_reminder_time: optionalClock(
      policy.date_only_reminder_time ?? policy.dateOnlyReminderTime ?? null,
      'date_only_reminder_time',
    ),
    all_day_reminder_time: optionalClock(
      policy.all_day_reminder_time ?? policy.allDayReminderTime ?? null,
      'all_day_reminder_time',
    ),
  });
}

function iso(epoch) {
  return new Date(epoch).toISOString();
}

function scheduledState(scheduledEpoch, nowEpoch, cancelled) {
  if (cancelled) return REMINDER_STATES.CANCELLED;
  return scheduledEpoch <= nowEpoch ? REMINDER_STATES.READY : REMINDER_STATES.SCHEDULED;
}

function skipped(sourceType, sourceId, reason) {
  return Object.freeze({ source_type: sourceType, source_id: sourceId, planning_skipped_reason: reason });
}

function priorityForTask(task) {
  return ['low', 'normal', 'high', 'urgent'].includes(task.priority) ? task.priority : 'normal';
}

function reminderText(source, kind) {
  if (kind === REMINDER_KINDS.OVERDUE) return { title: `Overdue: ${source.title}`, body: 'Task is overdue.' };
  if (kind === REMINDER_KINDS.DUE) return { title: `Due: ${source.title}`, body: 'Task due time is approaching.' };
  if (kind === REMINDER_KINDS.UPCOMING) return { title: `Upcoming: ${source.title}`, body: 'Task start time is approaching.' };
  return { title: `Event: ${source.title}`, body: 'Calendar event start time is approaching.' };
}

function makeReminder({ source, sourceType, kind, scheduledEpoch, timezone, now, nowEpoch, cancelled }) {
  const text = reminderText(source, kind);
  return createReminder({
    title: text.title,
    source_type: sourceType,
    source_id: source.id,
    kind,
    scheduled_at: iso(scheduledEpoch),
    timezone,
    state: scheduledState(scheduledEpoch, nowEpoch, cancelled),
  }, { now });
}

function exactEpoch(value, sourceTimezone, fallbackTimezone) {
  return instantForLocalDateTime(value, sourceTimezone ?? fallbackTimezone);
}

function dateAt(date, clock, timezone) {
  return instantForLocalDateTime(`${date}T${clock}`, timezone);
}

function planTask(task, context, policy, reminders, skippedItems) {
  const sourceType = REMINDER_SOURCE_TYPES.TASK;
  const cancelled = [TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELLED].includes(task.status);
  if ([TEMPORAL_STATES.UNSCHEDULED, TEMPORAL_STATES.AMBIGUOUS, TEMPORAL_STATES.RELATIVE_UNRESOLVED].includes(task.time_state)) {
    skippedItems.push(skipped(sourceType, task.id, `time_state_${task.time_state}`));
    return;
  }
  const timezone = task.timezone ?? context.timezone;
  let planned = false;

  if (task.start_at != null) {
    if (task.time_state === TEMPORAL_STATES.DATE_ONLY) {
      if (policy.date_only_reminder_time == null) {
        skippedItems.push(skipped(sourceType, task.id, 'date_only_reminder_time_required'));
      } else if (policy.task_upcoming_minutes_before == null) {
        skippedItems.push(skipped(sourceType, task.id, 'task_upcoming_policy_required'));
      } else {
        const startEpoch = dateAt(task.start_at, policy.date_only_reminder_time, timezone);
        reminders.push(makeReminder({
          source: task, sourceType, kind: REMINDER_KINDS.UPCOMING,
          scheduledEpoch: startEpoch, timezone, now: context.now, nowEpoch: context.epoch, cancelled,
        }));
        planned = true;
      }
    } else if (policy.task_upcoming_minutes_before == null) {
      skippedItems.push(skipped(sourceType, task.id, 'task_upcoming_policy_required'));
    } else {
      const startEpoch = exactEpoch(task.start_at, task.timezone, context.timezone);
      reminders.push(makeReminder({
        source: task, sourceType, kind: REMINDER_KINDS.UPCOMING,
        scheduledEpoch: startEpoch - policy.task_upcoming_minutes_before * 60_000,
        timezone, now: context.now, nowEpoch: context.epoch, cancelled,
      }));
      planned = true;
    }
  }

  if (task.due_at != null) {
    let dueEpoch;
    if (task.time_state === TEMPORAL_STATES.DATE_ONLY) {
      if (policy.date_only_reminder_time == null) {
        if (!skippedItems.some((item) => item.source_id === task.id && item.planning_skipped_reason === 'date_only_reminder_time_required')) {
          skippedItems.push(skipped(sourceType, task.id, 'date_only_reminder_time_required'));
        }
        return;
      }
      dueEpoch = dateAt(task.due_at, policy.date_only_reminder_time, timezone);
    } else {
      dueEpoch = exactEpoch(task.due_at, task.timezone, context.timezone);
    }
    const overdue = dueEpoch < context.epoch;
    if (!overdue && policy.task_due_minutes_before == null) {
      skippedItems.push(skipped(sourceType, task.id, 'task_due_policy_required'));
      return;
    }
    reminders.push(makeReminder({
      source: task,
      sourceType,
      kind: overdue ? REMINDER_KINDS.OVERDUE : REMINDER_KINDS.DUE,
      scheduledEpoch: overdue ? dueEpoch : (
        task.time_state === TEMPORAL_STATES.DATE_ONLY
          ? dueEpoch
          : dueEpoch - policy.task_due_minutes_before * 60_000
      ),
      timezone,
      now: context.now,
      nowEpoch: context.epoch,
      cancelled,
    }));
    planned = true;
  }

  if (!planned && task.start_at == null && task.due_at == null) {
    skippedItems.push(skipped(sourceType, task.id, 'no_concrete_task_time'));
  }
}

function planEvent(event, context, policy, reminders, skippedItems) {
  const sourceType = REMINDER_SOURCE_TYPES.CALENDAR_EVENT;
  const cancelled = event.status === EVENT_STATUSES.CANCELLED;
  const timezone = event.timezone ?? context.timezone;
  let scheduledEpoch;
  if (event.all_day) {
    if (policy.all_day_reminder_time == null) {
      skippedItems.push(skipped(sourceType, event.id, 'all_day_reminder_time_required'));
      return;
    }
    scheduledEpoch = dateAt(event.start_at, policy.all_day_reminder_time, timezone);
  } else {
    if (policy.event_start_minutes_before == null) {
      skippedItems.push(skipped(sourceType, event.id, 'event_start_policy_required'));
      return;
    }
    scheduledEpoch = exactEpoch(event.start_at, event.timezone, context.timezone)
      - policy.event_start_minutes_before * 60_000;
  }
  reminders.push(makeReminder({
    source: event,
    sourceType,
    kind: REMINDER_KINDS.EVENT_START,
    scheduledEpoch,
    timezone,
    now: context.now,
    nowEpoch: context.epoch,
    cancelled,
  }));
}

function mergeExisting(generated, existing, context) {
  if (!existing) return generated;
  validateReminder(existing);
  if ([REMINDER_STATES.ACKNOWLEDGED, REMINDER_STATES.DISMISSED, REMINDER_STATES.CANCELLED].includes(existing.state)) {
    return existing;
  }
  if (generated.state === REMINDER_STATES.CANCELLED) return generated;
  return calculateReminderState(existing, context);
}

export function planReminders({
  tasks = [],
  events = [],
  existing_reminders = [],
  existingReminders = existing_reminders,
  now,
  timezone,
  policy,
} = {}) {
  const context = assertTemporalContext(now, timezone);
  if (!Array.isArray(tasks) || !Array.isArray(events) || !Array.isArray(existingReminders)) {
    throw new TypeError('tasks, events, and existing reminders must be arrays');
  }
  const normalizedPolicy = validateReminderPolicy(policy);
  const generated = [];
  const skippedItems = [];
  tasks.forEach((task) => planTask(task, context, normalizedPolicy, generated, skippedItems));
  events.forEach((event) => planEvent(event, context, normalizedPolicy, generated, skippedItems));

  const existingById = new Map(existingReminders.map((reminder) => {
    const normalized = validateReminder(reminder);
    return [normalized.id, normalized];
  }));
  const unique = new Map();
  for (const reminder of generated) {
    unique.set(reminder.id, mergeExisting(reminder, existingById.get(reminder.id), context));
  }
  const reminders = Object.freeze([...unique.values()]);
  const sourceByKey = new Map([
    ...tasks.map((item) => [`task:${item.id}`, item]),
    ...events.map((item) => [`calendar_event:${item.id}`, item]),
  ]);
  const notificationIntents = reminders
    .filter((reminder) => [REMINDER_STATES.SCHEDULED, REMINDER_STATES.READY].includes(reminder.state))
    .map((reminder) => {
      const source = sourceByKey.get(`${reminder.source_type}:${reminder.source_id}`);
      const text = reminderText(source ?? { title: reminder.title }, reminder.kind);
      return createNotificationIntent({
        reminder,
        title: reminder.title,
        body: text.body,
        priority: reminder.source_type === REMINDER_SOURCE_TYPES.TASK ? priorityForTask(source ?? {}) : 'normal',
      });
    });
  return Object.freeze({
    reminders,
    notification_intents: Object.freeze(notificationIntents),
    skipped: Object.freeze(skippedItems),
    policy: normalizedPolicy,
  });
}

export class ReminderPlanner {
  plan(input) {
    return planReminders(input);
  }
}

export function createReminderPlanner() {
  return new ReminderPlanner();
}
