import {
  NOTIFICATION_OUTBOX_STATES,
  createPendingNotificationOutboxEntry,
  validateNotificationOutboxEntry,
} from './notification-outbox.mjs';

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('database must be an open node:sqlite DatabaseSync-compatible object');
  }
  return database;
}

function hydrate(row) {
  if (!row) return null;
  return validateNotificationOutboxEntry({
    outbox_id: row.outbox_id,
    handoff_id: row.handoff_id,
    dedupe_key: row.dedupe_key,
    reminder_id: row.reminder_id,
    notification_intent_id: row.notification_intent_id,
    payload: JSON.parse(row.payload_json),
    state: row.state,
    created_at: row.created_at,
    updated_at: row.updated_at,
    handed_off_at: row.handed_off_at,
    acknowledged_at: row.acknowledged_at,
    cancelled_at: row.cancelled_at,
  });
}

export class SQLiteNotificationOutboxStore {
  constructor(database) {
    this.database = assertDatabase(database);
  }

  enqueue(handoff) {
    const entry = createPendingNotificationOutboxEntry(handoff);
    this.database.prepare(`
      INSERT INTO notification_outbox (
        outbox_id, handoff_id, dedupe_key, reminder_id, notification_intent_id,
        payload_json, state, created_at, updated_at, handed_off_at,
        acknowledged_at, cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `).run(
      entry.outbox_id,
      entry.handoff_id,
      entry.dedupe_key,
      entry.reminder_id,
      entry.notification_intent_id,
      JSON.stringify(entry.payload),
      entry.state,
      entry.created_at,
      entry.updated_at,
      entry.handed_off_at,
      entry.acknowledged_at,
      entry.cancelled_at,
    );
    const stored = this.getByDedupeKey(entry.dedupe_key);
    if (
      stored.handoff_id !== entry.handoff_id ||
      stored.reminder_id !== entry.reminder_id ||
      stored.notification_intent_id !== entry.notification_intent_id
    ) {
      throw new Error(`Notification Outbox dedupe conflict "${entry.dedupe_key}"`);
    }
    return stored;
  }

  getByHandoffId(handoffId) {
    if (typeof handoffId !== 'string') return null;
    return hydrate(this.database.prepare(
      'SELECT * FROM notification_outbox WHERE handoff_id = ?',
    ).get(handoffId));
  }

  getByDedupeKey(dedupeKey) {
    if (typeof dedupeKey !== 'string') return null;
    return hydrate(this.database.prepare(
      'SELECT * FROM notification_outbox WHERE dedupe_key = ?',
    ).get(dedupeKey));
  }

  list(filters = {}) {
    const clauses = [];
    const values = [];
    for (const field of ['state', 'reminder_id', 'handoff_id']) {
      if (filters[field] != null) {
        clauses.push(`${field} = ?`);
        values.push(filters[field]);
      }
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
    return Object.freeze(this.database.prepare(
      `SELECT * FROM notification_outbox${where} ORDER BY rowid`,
    ).all(...values).map(hydrate));
  }

  update(entry) {
    const normalized = validateNotificationOutboxEntry(entry);
    const result = this.database.prepare(`
      UPDATE notification_outbox SET
        state = ?, updated_at = ?, handed_off_at = ?, acknowledged_at = ?, cancelled_at = ?
      WHERE outbox_id = ?
    `).run(
      normalized.state,
      normalized.updated_at,
      normalized.handed_off_at,
      normalized.acknowledged_at,
      normalized.cancelled_at,
      normalized.outbox_id,
    );
    if (result.changes !== 1) throw new Error(`Notification Outbox entry "${normalized.outbox_id}" not found`);
    return this.getByHandoffId(normalized.handoff_id);
  }

  markHandedOff(handoffId, now) {
    const current = this.getByHandoffId(handoffId);
    if (!current) throw new Error(`Notification Handoff "${handoffId}" not found`);
    if ([NOTIFICATION_OUTBOX_STATES.HANDED_OFF, NOTIFICATION_OUTBOX_STATES.ACKNOWLEDGED].includes(current.state)) {
      return current;
    }
    if (current.state !== NOTIFICATION_OUTBOX_STATES.PENDING) {
      throw new Error(`Notification Handoff "${handoffId}" cannot be handed off from state "${current.state}"`);
    }
    return this.update({
      ...current,
      state: NOTIFICATION_OUTBOX_STATES.HANDED_OFF,
      updated_at: now,
      handed_off_at: now,
    });
  }

  acknowledge(handoffId, now) {
    const current = this.getByHandoffId(handoffId);
    if (!current) throw new Error(`Notification Handoff "${handoffId}" not found`);
    if (current.state === NOTIFICATION_OUTBOX_STATES.ACKNOWLEDGED) return current;
    if (current.state !== NOTIFICATION_OUTBOX_STATES.HANDED_OFF) {
      throw new Error(`Notification Handoff "${handoffId}" must be handed off before acknowledgement`);
    }
    return this.update({
      ...current,
      state: NOTIFICATION_OUTBOX_STATES.ACKNOWLEDGED,
      updated_at: now,
      acknowledged_at: now,
    });
  }

  cancelPendingForReminder(reminderId, now) {
    return Object.freeze(this.list({ reminder_id: reminderId, state: NOTIFICATION_OUTBOX_STATES.PENDING })
      .map((entry) => this.update({
        ...entry,
        state: NOTIFICATION_OUTBOX_STATES.CANCELLED,
        updated_at: now,
        cancelled_at: now,
      })));
  }
}
