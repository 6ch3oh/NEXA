import {
  REMINDER_STATES,
  acknowledgeReminder,
  calculateReminderState,
  dismissReminder,
  validateReminder,
} from '../domain/reminder.mjs';

export function sameReminderIdentity(left, right) {
  return ['source_type', 'source_id', 'kind', 'scheduled_at'].every((field) => left[field] === right[field]);
}

export function mergeReminderLifecycle(existing, incoming) {
  if ([REMINDER_STATES.ACKNOWLEDGED, REMINDER_STATES.DISMISSED, REMINDER_STATES.CANCELLED].includes(existing.state)) {
    return existing;
  }
  if (incoming.state === REMINDER_STATES.CANCELLED) return incoming;
  if (existing.state === REMINDER_STATES.READY && incoming.state === REMINDER_STATES.SCHEDULED) {
    return validateReminder({ ...incoming, state: REMINDER_STATES.READY });
  }
  return incoming;
}

export class InMemoryReminderStore {
  constructor(initial = []) {
    if (!Array.isArray(initial)) throw new TypeError('initial reminders must be an array');
    this.rows = new Map();
    initial.forEach((reminder) => this.upsert(reminder));
  }

  upsert(reminder) {
    const incoming = validateReminder(reminder);
    const existing = this.rows.get(incoming.id);
    if (existing && !sameReminderIdentity(existing, incoming)) throw new Error(`Reminder id conflict "${incoming.id}"`);
    const stored = existing ? mergeReminderLifecycle(existing, incoming) : incoming;
    this.rows.set(stored.id, stored);
    return stored;
  }

  getById(id) {
    return typeof id === 'string' ? (this.rows.get(id) ?? null) : null;
  }

  list(filters = {}) {
    return Object.freeze([...this.rows.values()].filter((reminder) => (
      (filters.state == null || reminder.state === filters.state) &&
      (filters.kind == null || reminder.kind === filters.kind) &&
      (filters.source_type == null || reminder.source_type === filters.source_type) &&
      (filters.source_id == null || reminder.source_id === filters.source_id)
    )));
  }

  acknowledge(id, context) {
    const current = this.getById(id);
    if (!current) throw new Error(`Reminder with id "${id}" not found`);
    const next = acknowledgeReminder(current, context);
    this.rows.set(id, next);
    return next;
  }

  dismiss(id, context) {
    const current = this.getById(id);
    if (!current) throw new Error(`Reminder with id "${id}" not found`);
    const next = dismissReminder(current, context);
    this.rows.set(id, next);
    return next;
  }

  listReady(context) {
    for (const reminder of this.rows.values()) {
      if (reminder.state !== REMINDER_STATES.SCHEDULED) continue;
      const current = calculateReminderState(reminder, context);
      if (current.state === REMINDER_STATES.READY) this.rows.set(current.id, current);
    }
    return this.list({ state: REMINDER_STATES.READY });
  }
}

export function assertReminderStoreContract(store) {
  if (!store || typeof store !== 'object') throw new TypeError('Reminder Store must be an object');
  for (const method of ['upsert', 'getById', 'list', 'listReady', 'acknowledge', 'dismiss']) {
    if (typeof store[method] !== 'function') throw new TypeError(`Reminder Store is missing method "${method}"`);
  }
  return store;
}

export function createInMemoryReminderStore(initial) {
  return new InMemoryReminderStore(initial);
}
