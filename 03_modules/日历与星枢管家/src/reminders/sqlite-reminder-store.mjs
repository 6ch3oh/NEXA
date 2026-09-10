import {
  REMINDER_STATES,
  acknowledgeReminder,
  calculateReminderState,
  dismissReminder,
  validateReminder,
} from '../domain/reminder.mjs';
import { initializeSchema } from '../storage/sqlite-schema.mjs';
import {
  mergeReminderLifecycle,
  sameReminderIdentity,
} from './reminder-store.mjs';

const COLUMNS = Object.freeze([
  'id', 'title', 'source_type', 'source_id', 'kind', 'scheduled_at', 'timezone',
  'state', 'created_at', 'acknowledged_at', 'dismissed_at',
]);

function assertDatabase(database) {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    throw new TypeError('database must be an open node:sqlite DatabaseSync-compatible object');
  }
  return database;
}

function hydrate(row) {
  return row == null ? null : validateReminder(row);
}

function values(reminder) {
  return COLUMNS.map((column) => reminder[column] ?? null);
}

export class SQLiteReminderStore {
  constructor(database) {
    this.database = assertDatabase(database);
    initializeSchema(this.database);
  }

  upsert(reminder) {
    const incoming = validateReminder(reminder);
    const existing = this.getById(incoming.id);
    if (existing && !sameReminderIdentity(existing, incoming)) {
      throw new Error(`Reminder id conflict "${incoming.id}"`);
    }
    const identityRow = hydrate(this.database.prepare(`
      SELECT * FROM reminders
      WHERE source_type = ? AND source_id = ? AND kind = ? AND scheduled_at = ?
    `).get(incoming.source_type, incoming.source_id, incoming.kind, incoming.scheduled_at));
    if (identityRow && identityRow.id !== incoming.id) {
      throw new Error(`Reminder identity conflict with existing id "${identityRow.id}"`);
    }
    const stored = existing ? mergeReminderLifecycle(existing, incoming) : incoming;
    const placeholders = COLUMNS.map(() => '?').join(', ');
    const updates = COLUMNS.filter((column) => column !== 'id')
      .map((column) => `${column} = excluded.${column}`).join(', ');
    this.database.prepare(`
      INSERT INTO reminders (${COLUMNS.join(', ')}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updates}
    `).run(...values(stored));
    return this.getById(stored.id);
  }

  getById(id) {
    if (typeof id !== 'string') return null;
    return hydrate(this.database.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
  }

  list(filters = {}) {
    const clauses = [];
    const parameters = [];
    for (const field of ['state', 'kind', 'source_type', 'source_id']) {
      if (filters[field] != null) {
        clauses.push(`${field} = ?`);
        parameters.push(filters[field]);
      }
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return Object.freeze(this.database.prepare(`SELECT * FROM reminders${where} ORDER BY rowid`)
      .all(...parameters).map(hydrate));
  }

  listReady(context) {
    for (const reminder of this.list({ state: REMINDER_STATES.SCHEDULED })) {
      const current = calculateReminderState(reminder, context);
      if (current.state === REMINDER_STATES.READY) this.upsert(current);
    }
    return this.list({ state: REMINDER_STATES.READY });
  }

  acknowledge(id, context) {
    const current = this.getById(id);
    if (!current) throw new Error(`Reminder with id "${id}" not found`);
    return this.upsert(acknowledgeReminder(current, context));
  }

  dismiss(id, context) {
    const current = this.getById(id);
    if (!current) throw new Error(`Reminder with id "${id}" not found`);
    return this.upsert(dismissReminder(current, context));
  }
}

export function createSQLiteReminderStore(database) {
  return new SQLiteReminderStore(database);
}
