import { assertTemporalContext } from '../rules/schedule-rules.mjs';

export const SUPPORTED_LOCAL_COMMAND_TYPES = Object.freeze([
  'task.create',
  'task.get',
  'task.update',
  'task.complete',
  'task.delete',
  'task.list',
  'calendar.create',
  'calendar.get',
  'calendar.update',
  'calendar.delete',
  'calendar.list',
]);

export class LocalCommandPayloadError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'LocalCommandPayloadError';
    this.code = 'INVALID_COMMAND_PAYLOAD';
  }
}

export class UnsupportedLocalCommandError extends Error {
  constructor(commandType) {
    super(`Unsupported local command_type "${commandType}"`);
    this.name = 'UnsupportedLocalCommandError';
    this.code = 'DENY_UNSUPPORTED';
  }
}

export { LocalCommandPayloadError as InvalidLocalCommandPayloadError };

export function isSupportedLocalCommandType(commandType) {
  return SUPPORTED_LOCAL_COMMAND_TYPES.includes(commandType);
}

function requireId(payload, entity) {
  const alias = entity === 'task' ? 'task_id' : 'event_id';
  const value = payload.id ?? payload[alias];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LocalCommandPayloadError(`payload.id or payload.${alias} must be a non-empty string`);
  }
  return value;
}

function withoutKeys(input, keys) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}

function createInput(payload, key, timezone) {
  const value = payload[key] ?? payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalCommandPayloadError(`payload.${key} must be an object when provided`);
  }
  const input = withoutKeys(value, [key, 'filters', 'patch']);
  return input.timezone == null ? { ...input, timezone } : input;
}

function updateInput(payload, entity) {
  requireId(payload, entity);
  const patch = payload.patch ?? withoutKeys(payload, ['id', 'task_id', 'event_id']);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new LocalCommandPayloadError('payload.patch must be an object when provided');
  }
  if (Object.keys(patch).length === 0) {
    throw new LocalCommandPayloadError('payload.patch must not be empty');
  }
  return patch;
}

function listInput(payload) {
  const wrapperKeys = ['options', 'filters'];
  const wrapper = wrapperKeys.find((key) => payload[key] != null);
  if (wrapper && Object.keys(payload).some((key) => key !== wrapper)) {
    throw new LocalCommandPayloadError('list payload contains unsupported field outside options/filters');
  }
  const filters = payload.options ?? payload.filters ?? payload;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    throw new LocalCommandPayloadError('payload.filters must be an object when provided');
  }
  const allowed = new Set(['status', 'source', 'start_at', 'end_at']);
  const unsupported = Object.keys(filters).find((key) => !allowed.has(key));
  if (unsupported) throw new LocalCommandPayloadError(`list payload contains unsupported field "${unsupported}"`);
  return filters;
}

function assertMethod(target, method, owner) {
  if (!target || typeof target[method] !== 'function') {
    throw new TypeError(`${owner}.${method} must be a function`);
  }
}

export class LocalCommandHandler {
  constructor({ taskService, calendarService } = {}) {
    for (const method of ['createTask', 'getTask', 'updateTask', 'completeTask', 'deleteTask', 'listTasks']) {
      assertMethod(taskService, method, 'taskService');
    }
    for (const method of ['createEvent', 'getEvent', 'updateEvent', 'deleteEvent', 'listEvents']) {
      assertMethod(calendarService, method, 'calendarService');
    }
    this.taskService = taskService;
    this.calendarService = calendarService;
  }

  supports(commandType) {
    return isSupportedLocalCommandType(commandType);
  }

  validate(command) {
    if (!this.supports(command?.command_type)) {
      throw new UnsupportedLocalCommandError(command?.command_type);
    }
    const { command_type: type, payload } = command;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LocalCommandPayloadError('payload must be an object');
    }
    if (['task.get', 'task.complete', 'task.delete', 'calendar.get', 'calendar.delete'].includes(type)) {
      requireId(payload, type.startsWith('task.') ? 'task' : 'calendar');
    } else if (['task.update', 'calendar.update'].includes(type)) {
      updateInput(payload, type.startsWith('task.') ? 'task' : 'calendar');
    } else if (['task.list', 'calendar.list'].includes(type)) {
      listInput(payload);
    } else if (type === 'task.create') {
      createInput(payload, 'task');
    } else if (type === 'calendar.create') {
      createInput(payload, 'event');
    }
    return command;
  }

  execute(command, { now, timezone } = {}) {
    this.validate(command);
    const context = assertTemporalContext(now, timezone);
    const { command_type: type, payload } = command;
    switch (type) {
      case 'task.create':
        return this.taskService.createTask(createInput(payload, 'task', context.timezone), { now: context.now });
      case 'task.get':
        return this.taskService.getTask(requireId(payload, 'task'));
      case 'task.update':
        return this.taskService.updateTask(requireId(payload, 'task'), updateInput(payload, 'task'), { now: context.now });
      case 'task.complete':
        return this.taskService.completeTask(requireId(payload, 'task'), { now: context.now });
      case 'task.delete':
        return this.taskService.deleteTask(requireId(payload, 'task'));
      case 'task.list':
        return this.taskService.listTasks(listInput(payload));
      case 'calendar.create':
        return this.calendarService.createEvent(createInput(payload, 'event', context.timezone), { now: context.now });
      case 'calendar.get':
        return this.calendarService.getEvent(requireId(payload, 'calendar'));
      case 'calendar.update':
        return this.calendarService.updateEvent(requireId(payload, 'calendar'), updateInput(payload, 'calendar'), { now: context.now });
      case 'calendar.delete':
        return this.calendarService.deleteEvent(requireId(payload, 'calendar'));
      case 'calendar.list':
        return this.calendarService.listEvents(listInput(payload));
      default:
        throw new UnsupportedLocalCommandError(type);
    }
  }
}

export function createLocalCommandHandler(services) {
  return new LocalCommandHandler(services);
}
