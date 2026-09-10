export const SQLITE_SCHEMA_VERSION = 1;
export const REMINDER_SCHEMA_VERSION = 1;
export const REMINDER_SCHEMA_COMPONENT = 'reminders';
export const DAILY_PLANNING_SCHEMA_VERSION = 1;
export const DAILY_PLANNING_SCHEMA_COMPONENT = 'daily_planning';
export const COMMAND_RECEIPT_SCHEMA_VERSION = 1;
export const COMMAND_RECEIPT_SCHEMA_COMPONENT = 'command_receipts';
export const NOTIFICATION_OUTBOX_SCHEMA_VERSION = 1;
export const NOTIFICATION_OUTBOX_SCHEMA_COMPONENT = 'notification_outbox';

export class UnsupportedSchemaVersionError extends Error {
  constructor(version) {
    super(`Unsupported SQLite schema version ${version}; maximum supported version is ${SQLITE_SCHEMA_VERSION}`);
    this.name = 'UnsupportedSchemaVersionError';
    this.version = version;
  }
}

export class UnsupportedReminderSchemaVersionError extends Error {
  constructor(version) {
    super(`Unsupported Reminder schema version ${version}; maximum supported version is ${REMINDER_SCHEMA_VERSION}`);
    this.name = 'UnsupportedReminderSchemaVersionError';
    this.version = version;
  }
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    start_at TEXT,
    due_at TEXT,
    completed_at TEXT,
    timezone TEXT,
    source TEXT NOT NULL,
    external_id TEXT,
    time_state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    blocked_by_task_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (task_id, position),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT,
    all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
    timezone TEXT,
    location TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_components (
    component TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('task', 'calendar_event')),
    source_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('upcoming', 'due', 'overdue', 'event_start')),
    scheduled_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('scheduled', 'ready', 'acknowledged', 'dismissed', 'cancelled')),
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    dismissed_at TEXT,
    UNIQUE (source_type, source_id, kind, scheduled_at)
  );

  CREATE TABLE IF NOT EXISTS daily_plan_entries (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    plan_date TEXT NOT NULL,
    planned_start_at TEXT,
    planned_end_at TEXT,
    timezone TEXT,
    time_confirmation_state TEXT NOT NULL CHECK (time_confirmation_state IN ('time_unconfirmed', 'time_confirmed')),
    state TEXT NOT NULL CHECK (state IN ('day_assigned', 'time_confirmed', 'completed', 'cancelled')),
    position INTEGER NOT NULL CHECK (position >= 0),
    pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
    source TEXT NOT NULL,
    carryover_from_date TEXT,
    carryover_decision TEXT NOT NULL CHECK (carryover_decision IN ('none', 'confirmed', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (task_id, plan_date)
  );

  CREATE TABLE IF NOT EXISTS command_receipts (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    command_id TEXT,
    command_type TEXT,
    decision TEXT NOT NULL,
    executed INTEGER NOT NULL CHECK (executed IN (0, 1)),
    result_code TEXT NOT NULL,
    execution_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    executed_at TEXT,
    command_digest TEXT,
    duplicate_of_receipt_id TEXT,
    result_json TEXT,
    before_evidence_json TEXT,
    after_evidence_json TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_outbox (
    outbox_id TEXT PRIMARY KEY NOT NULL,
    handoff_id TEXT NOT NULL UNIQUE,
    dedupe_key TEXT NOT NULL UNIQUE,
    reminder_id TEXT NOT NULL,
    notification_intent_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'handed_off', 'acknowledged', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    handed_off_at TEXT,
    acknowledged_at TEXT,
    cancelled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
  CREATE INDEX IF NOT EXISTS idx_tasks_start_at ON tasks(start_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
  CREATE INDEX IF NOT EXISTS idx_task_dependencies_blocked_by ON task_dependencies(blocked_by_task_id);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_status ON calendar_events(status);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_events_end_at ON calendar_events(end_at);
  CREATE INDEX IF NOT EXISTS idx_reminders_state_scheduled_at ON reminders(state, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_reminders_source ON reminders(source_type, source_id);
  CREATE INDEX IF NOT EXISTS idx_daily_plan_date_order ON daily_plan_entries(plan_date, pinned DESC, position);
  CREATE INDEX IF NOT EXISTS idx_daily_plan_task ON daily_plan_entries(task_id);
  CREATE INDEX IF NOT EXISTS idx_command_receipts_command ON command_receipts(command_id);
  CREATE INDEX IF NOT EXISTS idx_command_receipts_executed ON command_receipts(command_id, executed);
  CREATE INDEX IF NOT EXISTS idx_notification_outbox_state ON notification_outbox(state, created_at);
  CREATE INDEX IF NOT EXISTS idx_notification_outbox_reminder ON notification_outbox(reminder_id);
`;

function assertDatabase(database) {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    throw new TypeError('database must be an open node:sqlite DatabaseSync-compatible object');
  }
  return database;
}

export function getSchemaVersion(database) {
  const db = assertDatabase(database);
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row.user_version);
}

function tableExists(database, tableName) {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) != null;
}

export function getReminderSchemaVersion(database) {
  const db = assertDatabase(database);
  if (!tableExists(db, 'schema_components')) return 0;
  const row = db.prepare('SELECT version FROM schema_components WHERE component = ?').get(REMINDER_SCHEMA_COMPONENT);
  return row == null ? 0 : Number(row.version);
}

export function getDailyPlanningSchemaVersion(database) {
  const db = assertDatabase(database);
  if (!tableExists(db, 'schema_components')) return 0;
  const row = db.prepare('SELECT version FROM schema_components WHERE component = ?').get(DAILY_PLANNING_SCHEMA_COMPONENT);
  return row == null ? 0 : Number(row.version);
}

export function getCommandReceiptSchemaVersion(database) {
  const db = assertDatabase(database);
  if (!tableExists(db, 'schema_components')) return 0;
  const row = db.prepare('SELECT version FROM schema_components WHERE component = ?').get(COMMAND_RECEIPT_SCHEMA_COMPONENT);
  return row == null ? 0 : Number(row.version);
}

export function getNotificationOutboxSchemaVersion(database) {
  const db = assertDatabase(database);
  if (!tableExists(db, 'schema_components')) return 0;
  const row = db.prepare('SELECT version FROM schema_components WHERE component = ?').get(NOTIFICATION_OUTBOX_SCHEMA_COMPONENT);
  return row == null ? 0 : Number(row.version);
}

export function initializeSchema(database) {
  const db = assertDatabase(database);
  const currentVersion = getSchemaVersion(db);
  if (currentVersion > SQLITE_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(currentVersion);
  }
  const reminderVersion = getReminderSchemaVersion(db);
  if (reminderVersion > REMINDER_SCHEMA_VERSION) {
    throw new UnsupportedReminderSchemaVersionError(reminderVersion);
  }
  const dailyPlanningVersion = getDailyPlanningSchemaVersion(db);
  if (dailyPlanningVersion > DAILY_PLANNING_SCHEMA_VERSION) {
    throw new Error(`Unsupported Daily Planning schema version ${dailyPlanningVersion}; maximum supported version is ${DAILY_PLANNING_SCHEMA_VERSION}`);
  }
  const commandReceiptVersion = getCommandReceiptSchemaVersion(db);
  if (commandReceiptVersion > COMMAND_RECEIPT_SCHEMA_VERSION) {
    throw new Error(`Unsupported Command Receipt schema version ${commandReceiptVersion}; maximum supported version is ${COMMAND_RECEIPT_SCHEMA_VERSION}`);
  }
  const notificationOutboxVersion = getNotificationOutboxSchemaVersion(db);
  if (notificationOutboxVersion > NOTIFICATION_OUTBOX_SCHEMA_VERSION) {
    throw new Error(`Unsupported Notification Outbox schema version ${notificationOutboxVersion}; maximum supported version is ${NOTIFICATION_OUTBOX_SCHEMA_VERSION}`);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(SCHEMA_SQL);
    if (currentVersion === 0) {
      db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}`);
    }
    db.prepare(`
      INSERT INTO schema_components (component, version) VALUES (?, ?)
      ON CONFLICT(component) DO UPDATE SET version = excluded.version
      WHERE schema_components.version < excluded.version
    `).run(REMINDER_SCHEMA_COMPONENT, REMINDER_SCHEMA_VERSION);
    db.prepare(`
      INSERT INTO schema_components (component, version) VALUES (?, ?)
      ON CONFLICT(component) DO UPDATE SET version = excluded.version
      WHERE schema_components.version < excluded.version
    `).run(DAILY_PLANNING_SCHEMA_COMPONENT, DAILY_PLANNING_SCHEMA_VERSION);
    db.prepare(`
      INSERT INTO schema_components (component, version) VALUES (?, ?)
      ON CONFLICT(component) DO UPDATE SET version = excluded.version
      WHERE schema_components.version < excluded.version
    `).run(COMMAND_RECEIPT_SCHEMA_COMPONENT, COMMAND_RECEIPT_SCHEMA_VERSION);
    db.prepare(`
      INSERT INTO schema_components (component, version) VALUES (?, ?)
      ON CONFLICT(component) DO UPDATE SET version = excluded.version
      WHERE schema_components.version < excluded.version
    `).run(NOTIFICATION_OUTBOX_SCHEMA_COMPONENT, NOTIFICATION_OUTBOX_SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original schema error.
    }
    throw error;
  }
  return getSchemaVersion(db);
}
