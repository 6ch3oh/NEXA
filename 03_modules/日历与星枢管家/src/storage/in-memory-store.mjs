import { createTask, updateTask } from '../domain/task.mjs';
import { createCalendarEvent, updateCalendarEvent } from '../domain/calendar-event.mjs';
import { assertRepositoryContract, matchesListFilters } from './contracts.mjs';

function createInMemoryRepository({ entityName, createEntity, updateEntity }) {
  const rows = new Map();
  const repo = {
    create(entity) {
      const created = createEntity(entity);
      if (rows.has(created.id)) {
        throw new Error(`${entityName} with id "${created.id}" already exists`);
      }
      rows.set(created.id, created);
      return created;
    },
    getById(id) {
      if (typeof id !== 'string') return null;
      return rows.has(id) ? rows.get(id) : null;
    },
    update(id, patch) {
      const current = rows.get(id);
      if (!current) {
        throw new Error(`${entityName} with id "${id}" not found`);
      }
      const updated = updateEntity(current, patch);
      rows.set(id, updated);
      return updated;
    },
    delete(id) {
      return rows.delete(id);
    },
    list(options = {}) {
      return [...rows.values()].filter((entity) => matchesListFilters(entity, options));
    },
  };
  assertRepositoryContract(repo, `${entityName} repository`);
  return repo;
}

export function createInMemoryTaskStore() {
  return createInMemoryRepository({
    entityName: 'Task',
    createEntity: createTask,
    updateEntity: updateTask,
  });
}

export function createInMemoryEventStore() {
  return createInMemoryRepository({
    entityName: 'CalendarEvent',
    createEntity: createCalendarEvent,
    updateEntity: updateCalendarEvent,
  });
}
