import {
  REMINDER_SOURCE_TYPES,
  REMINDER_STATES,
  cancelReminder,
} from '../domain/reminder.mjs';
import { TASK_STATUSES } from '../domain/task.mjs';
import { EVENT_STATUSES } from '../domain/calendar-event.mjs';
import { createNotificationIntent } from './notification-intent.mjs';
import { ReminderPlanner } from './reminder-planner.mjs';
import { assertReminderStoreContract } from './reminder-store.mjs';

function assertPlanner(planner) {
  if (!planner || typeof planner.plan !== 'function') throw new TypeError('planner.plan must be a function');
  return planner;
}

function terminalSourceDescriptors(tasks, events) {
  return [
    ...tasks
      .filter((task) => [TASK_STATUSES.COMPLETED, TASK_STATUSES.CANCELLED].includes(task.status))
      .map((task) => ({ source_type: REMINDER_SOURCE_TYPES.TASK, source_id: task.id, cancelled: true })),
    ...events
      .filter((event) => event.status === EVENT_STATUSES.CANCELLED)
      .map((event) => ({ source_type: REMINDER_SOURCE_TYPES.CALENDAR_EVENT, source_id: event.id, cancelled: true })),
  ];
}

export class ReminderService {
  constructor(store, { planner = new ReminderPlanner(), notificationOutboxService = null } = {}) {
    this.store = assertReminderStoreContract(store);
    this.planner = assertPlanner(planner);
    if (notificationOutboxService != null) {
      for (const method of ['enqueueNotificationIntent', 'cancelPendingForReminder']) {
        if (typeof notificationOutboxService[method] !== 'function') throw new TypeError(`notificationOutboxService.${method} is required`);
      }
    }
    this.notificationOutboxService = notificationOutboxService;
  }

  planAndPersist({ tasks = [], events = [], now, timezone, policy } = {}) {
    if (!Array.isArray(tasks) || !Array.isArray(events)) throw new TypeError('tasks and events must be arrays');
    const planned = this.planner.plan({
      tasks,
      events,
      existing_reminders: this.store.list(),
      now,
      timezone,
      policy,
    });
    planned.reminders.forEach((reminder) => this.store.upsert(reminder));
    terminalSourceDescriptors(tasks, events).forEach((descriptor) => this.reconcileSource({ ...descriptor, now }));

    const persistedById = new Map(this.store.list().map((reminder) => [reminder.id, reminder]));
    const notificationIntents = planned.notification_intents.filter((intent) => {
      const persisted = persistedById.get(intent.reminder_id);
      return persisted && [REMINDER_STATES.SCHEDULED, REMINDER_STATES.READY].includes(persisted.state);
    });
    notificationIntents.forEach((intent) => this.notificationOutboxService?.enqueueNotificationIntent(intent, { created_at: now }));
    return Object.freeze({
      reminders: Object.freeze([...persistedById.values()]),
      notification_intents: Object.freeze(notificationIntents),
      skipped: planned.skipped,
      policy: planned.policy,
    });
  }

  listReady({ now, timezone } = {}) {
    return this.store.listReady({ now, timezone });
  }

  notificationIntentsForReady({ now, timezone } = {}) {
    const intents = Object.freeze(this.listReady({ now, timezone }).map((reminder) => createNotificationIntent({
      reminder,
      title: reminder.title,
      body: '',
      priority: 'normal',
    })));
    intents.forEach((intent) => this.notificationOutboxService?.enqueueNotificationIntent(intent, { created_at: now }));
    return intents;
  }

  acknowledge(id, context) {
    return this.store.acknowledge(id, context);
  }

  dismiss(id, context) {
    return this.store.dismiss(id, context);
  }

  reconcileSource({ source_type, source_id, cancelled = true, now = null } = {}) {
    if (!Object.values(REMINDER_SOURCE_TYPES).includes(source_type)) throw new TypeError(`Invalid source_type "${source_type}"`);
    if (typeof source_id !== 'string' || source_id.trim() === '') throw new TypeError('source_id must be a non-empty string');
    const reminders = this.store.list({ source_type, source_id });
    if (!cancelled) return reminders;
    return Object.freeze(reminders.map((reminder) => {
      const cancelledReminder = this.store.upsert(cancelReminder(reminder));
      if (this.notificationOutboxService && now != null) {
        this.notificationOutboxService.cancelPendingForReminder(cancelledReminder.id, { now });
      }
      return cancelledReminder;
    }));
  }
}

export function createReminderService(store, options) {
  return new ReminderService(store, options);
}
