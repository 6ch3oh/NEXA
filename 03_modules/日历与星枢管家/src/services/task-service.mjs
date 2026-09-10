import { randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import {
  createTask as createTaskEntity,
  updateTask as updateTaskEntity,
  completeTask as completeTaskEntity,
  TASK_STATUSES,
  isTaskBlocked,
} from '../domain/task.mjs';
import { assertRepositoryContract } from '../storage/contracts.mjs';

export class TaskNotFoundError extends Error {
  constructor(id) {
    super(`Task with id "${id}" not found`);
    this.name = 'TaskNotFoundError';
    this.task_id = id;
  }
}

function assertNow(now) {
  if (!isValidIsoTimestamp(now)) {
    throw new TypeError('now must be an explicit valid ISO timestamp');
  }
  return now;
}

function restoreOrThrow(repository, current, error) {
  try {
    repository.create(current);
  } catch (restoreError) {
    throw new AggregateError([error, restoreError], 'Task update failed and the previous entity could not be restored');
  }
  throw error;
}

function replaceTask(repository, current, next) {
  if (!repository.delete(current.id)) throw new TaskNotFoundError(current.id);
  try {
    return repository.create(next);
  } catch (error) {
    return restoreOrThrow(repository, current, error);
  }
}

export class TaskService {
  constructor(repository, { idFactory = () => `task_${randomUUID()}` } = {}) {
    this.repository = assertRepositoryContract(repository, 'TaskService repository');
    if (typeof idFactory !== 'function') throw new TypeError('idFactory must be a function');
    this.idFactory = idFactory;
  }

  createTask(input, { now } = {}) {
    const timestamp = assertNow(now);
    if (!input || typeof input !== 'object') throw new TypeError('TaskService.createTask expects an object');
    const id = input.id ?? this.idFactory();
    const task = createTaskEntity({
      ...input,
      id,
      created_at: timestamp,
      updated_at: timestamp,
    }, { now: timestamp });
    return this.repository.create(task);
  }

  getTask(id) {
    return this.repository.getById(id);
  }

  updateTask(id, patch, { now } = {}) {
    const timestamp = assertNow(now);
    const current = this.repository.getById(id);
    if (!current) throw new TaskNotFoundError(id);
    const next = updateTaskEntity(current, patch, { now: timestamp });
    return replaceTask(this.repository, current, next);
  }

  completeTask(id, { now } = {}) {
    const timestamp = assertNow(now);
    const current = this.repository.getById(id);
    if (!current) throw new TaskNotFoundError(id);
    if (current.status === TASK_STATUSES.COMPLETED) return current;
    const next = completeTaskEntity(current, { now: timestamp });
    return replaceTask(this.repository, current, next);
  }

  deleteTask(id) {
    return this.repository.delete(id);
  }

  listTasks(options = {}) {
    return this.repository.list(options);
  }

  isBlocked(id) {
    const task = this.repository.getById(id);
    if (!task) throw new TaskNotFoundError(id);
    const dependencies = Object.fromEntries(
      (task.dependencies ?? []).map((dependencyId) => [dependencyId, this.repository.getById(dependencyId)]),
    );
    return isTaskBlocked(task, dependencies);
  }
}

export function createTaskService(repository, options) {
  return new TaskService(repository, options);
}
