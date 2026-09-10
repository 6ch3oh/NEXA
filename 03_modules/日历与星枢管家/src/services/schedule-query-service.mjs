import { weekStartMondayOf } from '../domain/schedule-view.mjs';
import { evaluateScheduleRules } from '../rules/schedule-rules.mjs';
import { evaluateCommandPolicy, COMMAND_POLICY_DECISIONS } from '../rules/command-policy.mjs';
import { createTaskViewModel } from '../view-models/task-view-model.mjs';
import { TaskService } from './task-service.mjs';
import { CalendarService } from './calendar-service.mjs';
import {
  createDayViewModel,
  createWeekViewModel,
  createMonthViewModel,
} from '../view-models/schedule-view-model.mjs';

function assertService(service, method, label) {
  if (!service || typeof service[method] !== 'function') {
    throw new TypeError(`${label} must provide ${method}()`);
  }
  return service;
}

function taskAccessor(candidate) {
  if (candidate && typeof candidate.listTasks === 'function') return candidate;
  if (candidate && typeof candidate.list === 'function') return new TaskService(candidate);
  return assertService(candidate, 'listTasks', 'taskService or taskRepository');
}

function calendarAccessor(candidate) {
  if (candidate && typeof candidate.listEvents === 'function') return candidate;
  if (candidate && typeof candidate.list === 'function') return new CalendarService(candidate);
  return assertService(candidate, 'listEvents', 'calendarService or eventRepository');
}

function resolveCommands(explicitCommands, provider) {
  if (explicitCommands != null) {
    if (!Array.isArray(explicitCommands)) throw new TypeError('commands must be an array');
    return explicitCommands;
  }
  if (provider == null) return [];
  const commands = typeof provider === 'function' ? provider() : provider;
  if (!Array.isArray(commands)) throw new TypeError('commandProvider must resolve to an array');
  return commands;
}

export class ScheduleQueryService {
  constructor(input, calendarService) {
    const isOptionsObject = calendarService == null && input && (
      Object.hasOwn(input, 'taskService') || Object.hasOwn(input, 'taskRepository')
    );
    const options = isOptionsObject
      ? input
      : { taskService: input, calendarService };
    this.taskService = taskAccessor(options.taskService ?? options.taskRepository);
    this.calendarService = calendarAccessor(options.calendarService ?? options.eventRepository);
    this.commandProvider = options.commandProvider ?? null;
  }

  loadCollections() {
    return Object.freeze({
      tasks: this.taskService.listTasks(),
      events: this.calendarService.listEvents(),
    });
  }

  getDayView(date, { now, timezone, commands } = {}) {
    const { tasks, events } = this.loadCollections();
    const day = createDayViewModel(date, { tasks, events, now, timezone });
    const rules = evaluateScheduleRules({ tasks, events, now, timezone });
    const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task]));
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const toView = (entry) => createTaskViewModel(byId.get(entry.task_id), { tasksById, now, timezone });
    const commandDecisions = resolveCommands(commands, this.commandProvider).map(evaluateCommandPolicy);
    return Object.freeze({
      ...day,
      overdue: Object.freeze(rules.tasks.filter((entry) => entry.flags.overdue).map(toView)),
      blocked: Object.freeze(rules.tasks.filter((entry) => entry.flags.blocked).map(toView)),
      needs_confirmation: Object.freeze(
        commandDecisions.filter((entry) => entry.decision === COMMAND_POLICY_DECISIONS.REQUIRE_CONFIRMATION),
      ),
    });
  }

  getWeekView(dateOrWeekStart, { now, timezone } = {}) {
    const { tasks, events } = this.loadCollections();
    const weekStart = weekStartMondayOf(dateOrWeekStart);
    return createWeekViewModel(weekStart, { tasks, events, now, timezone });
  }

  getMonthView(year, month, { now, timezone } = {}) {
    const { tasks, events } = this.loadCollections();
    return createMonthViewModel(year, month, { tasks, events, now, timezone });
  }
}

export function createScheduleQueryService(input, calendarService) {
  return new ScheduleQueryService(input, calendarService);
}
