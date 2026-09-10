import { DatabaseSync } from 'node:sqlite';
import { createTask, updateTask } from '../domain/task.mjs';
import { createCalendarEvent, updateCalendarEvent } from '../domain/calendar-event.mjs';
import {
  assertRepositoryContract,
  matchesListFilters,
  normalizeListOptions,
} from './contracts.mjs';
import {
  initializeSchema,
  getSchemaVersion,
} from './sqlite-schema.mjs';

const TASK_COLUMNS = Object.freeze([
  'id', 'title', 'description', 'status', 'priority', 'start_at', 'due_at',
  'completed_at', 'timezone', 'source', 'external_id', 'time_state', 'created_at', 'updated_at',
]);

const EVENT_COLUMNS = Object.freeze([
  'id', 'title', 'description', 'start_at', 'end_at', 'all_day', 'timezone',
  'location', 'status', 'source', 'external_id', 'created_at', 'updated_at',
]);

function assertDatabase(database) {
  if (!database || typeof database.exec !== 'function' || typeof database.prepare !== 'function') {
    throw new TypeError('database must be an open node:sqlite DatabaseSync-compatible object');
  }
  return database;
}

function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original repository error.
    }
    throw error;
  }
}

function taskValues(task) {
  return TASK_COLUMNS.map((column) => task[column] ?? null);
}

function eventValues(event) {
  return EVENT_COLUMNS.map((column) => column === 'all_day' ? (event.all_day ? 1 : 0) : (event[column] ?? null));
}

function insertDependencies(database, task) {
  const statement = database.prepare(
    'INSERT INTO task_dependencies (task_id, blocked_by_task_id, position) VALUES (?, ?, ?)',
  );
  task.dependencies.forEach((dependencyId, position) => statement.run(task.id, dependencyId, position));
}

function readDependencies(database, taskId) {
  return database.prepare(
    'SELECT blocked_by_task_id FROM task_dependencies WHERE task_id = ? ORDER BY position',
  ).all(taskId).map((row) => row.blocked_by_task_id);
}

function hydrateTask(database, row) {
  if (!row) return null;
  return createTask({
    ...row,
    dependencies: readDependencies(database, row.id),
  });
}

function hydrateEvent(row) {
  if (!row) return null;
  return createCalendarEvent({
    ...row,
    all_day: row.all_day === 1,
  });
}

function selectRows(database, table, options) {
  const normalized = normalizeListOptions(options);
  const clauses = [];
  const parameters = [];
  if (normalized.status != null) {
    clauses.push('status = ?');
    parameters.push(normalized.status);
  }
  if (normalized.source != null) {
    clauses.push('source = ?');
    parameters.push(normalized.source);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  return database.prepare(`SELECT * FROM ${table}${where} ORDER BY rowid`).all(...parameters);
}

export class SQLiteTaskRepository {
  constructor(database) {
    this.database = assertDatabase(database);
    assertRepositoryContract(this, 'SQLite Task repository');
  }

  create(entity) {
    const task = createTask(entity);
    if (this.getById(task.id) != null) {
      throw new Error(`Task with id "${task.id}" already exists`);
    }
    return transaction(this.database, () => {
      const placeholders = TASK_COLUMNS.map(() => '?').join(', ');
      this.database.prepare(
        `INSERT INTO tasks (${TASK_COLUMNS.join(', ')}) VALUES (${placeholders})`,
      ).run(...taskValues(task));
      insertDependencies(this.database, task);
      return this.getById(task.id);
    });
  }

  getById(id) {
    if (typeof id !== 'string') return null;
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return hydrateTask(this.database, row);
  }

  update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error(`Task with id "${id}" not found`);
    const task = updateTask(current, patch);
    return transaction(this.database, () => {
      const assignments = TASK_COLUMNS.filter((column) => column !== 'id')
        .map((column) => `${column} = ?`).join(', ');
      const values = TASK_COLUMNS.filter((column) => column !== 'id')
        .map((column) => task[column] ?? null);
      this.database.prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`).run(...values, id);
      this.database.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(id);
      insertDependencies(this.database, task);
      return this.getById(id);
    });
  }

  delete(id) {
    if (typeof id !== 'string') return false;
    return this.database.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  list(options = {}) {
    return selectRows(this.database, 'tasks', options)
      .map((row) => hydrateTask(this.database, row))
      .filter((task) => matchesListFilters(task, options));
  }
}

export class SQLiteEventRepository {
  constructor(database) {
    this.database = assertDatabase(database);
    assertRepositoryContract(this, 'SQLite Event repository');
  }

  create(entity) {
    const event = createCalendarEvent(entity);
    if (this.getById(event.id) != null) {
      throw new Error(`CalendarEvent with id "${event.id}" already exists`);
    }
    const placeholders = EVENT_COLUMNS.map(() => '?').join(', ');
    this.database.prepare(
      `INSERT INTO calendar_events (${EVENT_COLUMNS.join(', ')}) VALUES (${placeholders})`,
    ).run(...eventValues(event));
    return this.getById(event.id);
  }

  getById(id) {
    if (typeof id !== 'string') return null;
    return hydrateEvent(this.database.prepare('SELECT * FROM calendar_events WHERE id = ?').get(id));
  }

  update(id, patch) {
    const current = this.getById(id);
    if (!current) throw new Error(`CalendarEvent with id "${id}" not found`);
    const event = updateCalendarEvent(current, patch);
    const assignments = EVENT_COLUMNS.filter((column) => column !== 'id')
      .map((column) => `${column} = ?`).join(', ');
    const values = EVENT_COLUMNS.filter((column) => column !== 'id')
      .map((column) => column === 'all_day' ? (event.all_day ? 1 : 0) : (event[column] ?? null));
    this.database.prepare(`UPDATE calendar_events SET ${assignments} WHERE id = ?`).run(...values, id);
    return this.getById(id);
  }

  delete(id) {
    if (typeof id !== 'string') return false;
    return this.database.prepare('DELETE FROM calendar_events WHERE id = ?').run(id).changes > 0;
  }

  list(options = {}) {
    return selectRows(this.database, 'calendar_events', options)
      .map(hydrateEvent)
      .filter((event) => matchesListFilters(event, options));
  }
}

export class SQLiteStore {
  constructor(filename = ':memory:') {
    this.filename = filename;
    this.database = new DatabaseSync(filename);
    this.closed = false;
    try {
      this.database.exec('PRAGMA foreign_keys = ON');
      initializeSchema(this.database);
      this.taskRepository = new SQLiteTaskRepository(this.database);
      this.eventRepository = new SQLiteEventRepository(this.database);
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  get schemaVersion() {
    if (this.closed) throw new Error('SQLite store is closed');
    return getSchemaVersion(this.database);
  }

  close() {
    if (this.closed) return false;
    this.database.close();
    this.closed = true;
    return true;
  }
}

export function createSQLiteTaskRepository(database) {
  return new SQLiteTaskRepository(database);
}

export function createSQLiteEventRepository(database) {
  return new SQLiteEventRepository(database);
}

export function openSQLiteStore(filename = ':memory:') {
  return new SQLiteStore(filename);
}

export const createSQLiteStore = openSQLiteStore;
export const openSqliteStore = openSQLiteStore;
export const createSqliteStore = openSQLiteStore;
export const SqliteStore = SQLiteStore;
export const SqliteTaskRepository = SQLiteTaskRepository;
export const SqliteEventRepository = SQLiteEventRepository;
