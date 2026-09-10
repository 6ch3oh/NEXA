import { mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { createButlerNotionRuntime } from '../adapters/notion/notion-runtime-factory.mjs';
import { CommandDispatcher } from '../commands/dispatcher.mjs';
import { createCommand } from '../commands/contract.mjs';
import { CompositeCommandHandler } from '../commands/composite-command-handler.mjs';
import { LocalCommandHandler } from '../commands/local-command-handler.mjs';
import { PlanningCommandHandler } from '../commands/planning-command-handler.mjs';
import { SQLiteCommandReceiptStore } from '../commands/sqlite-receipt-store.mjs';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { addDays } from '../domain/schedule-view.mjs';
import { DailyPlanReminderIntegration } from '../planning/daily-plan-reminder-integration.mjs';
import { DailyPlanningService } from '../planning/daily-planning-service.mjs';
import { NotificationOutboxService } from '../planning/notification-outbox-service.mjs';
import { SQLiteNotificationOutboxStore } from '../planning/sqlite-notification-outbox-store.mjs';
import { SQLiteDailyPlanStore } from '../planning/sqlite-daily-plan-store.mjs';
import { ReminderService } from '../reminders/reminder-service.mjs';
import { SQLiteReminderStore } from '../reminders/sqlite-reminder-store.mjs';
import { CalendarService } from '../services/calendar-service.mjs';
import { TaskService } from '../services/task-service.mjs';
import { TodayTomorrowPlanningService } from '../services/today-tomorrow-planning-service.mjs';
import { openSQLiteStore } from '../storage/sqlite-store.mjs';
import { createReminderViewModel } from '../view-models/reminder-view-model.mjs';

export const TODAY_TOMORROW_PUBLIC_API_VERSION = '0.1.0';

const DATABASE_FILENAME = 'today-tomorrow-v0.1.sqlite';

function validateConfiguration({ dataRoot, timezone, clock, notion = null } = {}) {
  if (typeof dataRoot !== 'string' || dataRoot.trim() === '' || !isAbsolute(dataRoot)) {
    throw new TypeError('dataRoot must be a non-empty absolute platform data directory');
  }
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new TypeError('timezone must be a non-empty explicit IANA timezone');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const now = clock();
  if (!isValidIsoTimestamp(now) || !/(Z|[+-]\d{2}:\d{2})$/.test(now)) {
    throw new TypeError('clock must return an explicit ISO timestamp');
  }
  if (notion != null && (!notion || typeof notion !== 'object' || Array.isArray(notion))) {
    throw new TypeError('notion must be null or an optional configuration object');
  }
  if (notion != null && (!notion.windowLike || typeof notion.windowLike !== 'object')) {
    throw new TypeError('notion.windowLike must provide the existing Legacy Notion host path');
  }
  return Object.freeze({
    dataRoot: resolve(dataRoot),
    timezone,
    clock,
    notion: notion == null ? null : Object.freeze({
      windowLike: notion.windowLike,
      syncPolicy: notion.syncPolicy,
      mapper: notion.mapper,
    }),
  });
}

function lifecycleView(state) {
  return Object.freeze({
    api_version: TODAY_TOMORROW_PUBLIC_API_VERSION,
    state,
    started: state === 'started',
  });
}

function createComposition(config) {
  mkdirSync(config.dataRoot, { recursive: true });
  let sqlite = null;
  let notionRuntime = null;
  try {
    sqlite = openSQLiteStore(join(config.dataRoot, DATABASE_FILENAME));
    const dailyPlanStore = new SQLiteDailyPlanStore(sqlite.database);
    const reminderStore = new SQLiteReminderStore(sqlite.database);
    const taskService = new TaskService(sqlite.taskRepository);
    const calendarService = new CalendarService(sqlite.eventRepository);
    const notificationOutboxStore = new SQLiteNotificationOutboxStore(sqlite.database);
    const notificationOutboxService = new NotificationOutboxService(notificationOutboxStore);
    const dailyPlanningService = new DailyPlanningService({
      store: dailyPlanStore,
      taskRepository: sqlite.taskRepository,
      eventRepository: sqlite.eventRepository,
    });
    const reminderService = new ReminderService(reminderStore, { notificationOutboxService });
    const reminderIntegration = new DailyPlanReminderIntegration(reminderStore, { notificationOutboxService });
    notionRuntime = config.notion == null ? null : createButlerNotionRuntime({
      windowLike: config.notion.windowLike,
      taskRepository: sqlite.taskRepository,
      timezone: config.timezone,
      clock: config.clock,
      syncPolicy: config.notion.syncPolicy,
      mapper: config.notion.mapper,
    });
    const reconcilePlan = (result, now) => {
      if (result?.status === 'CONFLICT_WARNING') return result;
      const entry = result?.entry ?? result;
      if (!entry || entry.task_id == null) return result;
      const task = taskService.getTask(entry.task_id);
      if (task) reminderIntegration.reconcile({ plan: entry, task, now });
      return result;
    };
    const localCommandHandler = new LocalCommandHandler({ taskService, calendarService });
    const planningCommandHandler = new PlanningCommandHandler({
      dailyPlanningService,
      dailyPlanStore,
      onPlanChanged: reconcilePlan,
    });
    const commandDispatcher = new CommandDispatcher({
      handler: new CompositeCommandHandler([localCommandHandler, planningCommandHandler]),
      receiptStore: new SQLiteCommandReceiptStore(sqlite.database),
    });
    const planningService = new TodayTomorrowPlanningService({
      taskRepository: sqlite.taskRepository,
      eventRepository: sqlite.eventRepository,
      dailyPlanStore,
      reminderStore,
      commandDispatcher,
      dailyPlanningService,
      reminderIntegration,
    });
    return {
      sqlite,
      taskService,
      calendarService,
      dailyPlanStore,
      reminderStore,
      reminderService,
      notificationOutboxStore,
      notificationOutboxService,
      dailyPlanningService,
      reminderIntegration,
      commandDispatcher,
      planningService,
      notionRuntime,
    };
  } catch (error) {
    notionRuntime?.dispose();
    sqlite?.close();
    throw error;
  }
}

function publicContext(config, input = {}) {
  const now = input.now ?? config.clock();
  if (!isValidIsoTimestamp(now) || !/(Z|[+-]\d{2}:\d{2})$/.test(now)) {
    throw new TypeError('now must be an explicit ISO timestamp');
  }
  return Object.freeze({ now, timezone: config.timezone });
}

export function createTodayTomorrowApplication(options) {
  const config = validateConfiguration(options);
  let state = 'created';
  let composition = null;
  let lastNotionRuntime = null;

  function requireStarted() {
    if (state !== 'started' || composition == null) throw new Error('Today/Tomorrow application is not started');
    return composition;
  }

  function start() {
    if (state === 'started') return Object.freeze({ ...lifecycleView(state), already_started: true });
    composition = createComposition(config);
    lastNotionRuntime = composition.notionRuntime;
    state = 'started';
    return Object.freeze({ ...lifecycleView(state), already_started: false });
  }

  function stop() {
    if (state !== 'started' || composition == null) return false;
    const current = composition;
    composition = null;
    try {
      current.notionRuntime?.dispose();
    } finally {
      try {
        current.sqlite.close();
      } finally {
        state = 'stopped';
      }
    }
    return true;
  }

  function planningCommand(commandType, payload, options, now) {
    const input = {
      command_id: options.command_id,
      command_type: commandType,
      payload,
      created_at: options.command_created_at ?? now,
      source: 'local',
    };
    if (options.confirmation_state != null) input.confirmation_state = options.confirmation_state;
    else if (
      options.actor === 'user' &&
      [
        'planning.confirm_task_time',
        'planning.change_task_time',
        'planning.remove_task_time',
        'planning.confirm_carryover',
        'planning.reject_carryover',
      ].includes(commandType)
    ) input.confirmation_state = 'confirmed';
    return createCommand(input);
  }

  function dispatchPlanning(commandType, payload, options = {}) {
    const current = requireStarted();
    const context = publicContext(config, options);
    const result = current.commandDispatcher.dispatch(
      planningCommand(commandType, payload, options, context.now),
      context,
    );
    if (result.status === 'executed') return result.data;
    if (result.status === 'duplicate') return result.data?.result ?? null;
    if (result.code === 'CONFLICT_WARNING') return result.data;
    if (result.status === 'confirmation_required') {
      throw new Error('Only an explicit user action may confirm this planning action');
    }
    const error = new Error(result.error?.message ?? `Planning command failed: ${result.code}`);
    error.code = result.code;
    throw error;
  }

  const application = {
    start,
    init: start,
    stop,
    dispose: stop,
    getStatus: () => lifecycleView(state),
    getToday(date, options = {}) {
      const current = requireStarted();
      return current.planningService.getToday(date, publicContext(config, options));
    },
    getTomorrow(today, options = {}) {
      const current = requireStarted();
      const context = publicContext(config, options);
      return current.planningService.getTomorrow(today, {
        ...context,
        carryover_suggestions: current.dailyPlanningService.carryoverSuggestions(today, addDays(today, 1)),
      });
    },
    getTask(taskId) {
      return requireStarted().taskService.getTask(taskId);
    },
    listTasks(options = {}) {
      return requireStarted().taskService.listTasks(options);
    },
    getReminders(options = {}) {
      const current = requireStarted();
      const context = publicContext(config, options);
      return Object.freeze(current.reminderStore.list().map((item) => createReminderViewModel(item, context)));
    },
    execute(command, options = {}) {
      const current = requireStarted();
      const context = publicContext(config, options);
      if (command?.command_type === 'task.complete') return current.planningService.completeTask(command, context);
      return current.commandDispatcher.dispatch(command, context);
    },
    assignTaskToDay(taskId, planDate, options = {}) {
      return dispatchPlanning('planning.assign_task_to_day', {
        task_id: taskId,
        plan_date: planDate,
        position: options.position,
        plan_source: options.source,
      }, options);
    },
    confirmTaskTime(planId, options = {}) {
      return dispatchPlanning('planning.confirm_task_time', {
        plan_id: planId,
        planned_start_at: options.planned_start_at,
        planned_end_at: options.planned_end_at,
        actor: options.actor,
        accept_conflicts: options.accept_conflicts,
      }, options);
    },
    changeTaskTime(planId, options = {}) {
      return dispatchPlanning('planning.change_task_time', {
        plan_id: planId,
        planned_start_at: options.planned_start_at,
        planned_end_at: options.planned_end_at,
        actor: options.actor,
        accept_conflicts: options.accept_conflicts,
      }, options);
    },
    removeTaskTime(planId, options = {}) {
      return dispatchPlanning('planning.remove_task_time', {
        plan_id: planId,
        actor: options.actor,
      }, options);
    },
    reorderTasks(planDate, orderedPlanIds, options = {}) {
      const normalizedOptions = { actor: options.actor ?? 'user', ...options };
      return dispatchPlanning('planning.reorder_tasks', {
        plan_date: planDate,
        ordered_plan_ids: orderedPlanIds,
        actor: normalizedOptions.actor,
      }, normalizedOptions);
    },
    confirmCarryover(planId, toDate, options = {}) {
      return dispatchPlanning('planning.confirm_carryover', {
        plan_id: planId,
        to_date: toDate,
        actor: options.actor,
      }, options);
    },
    rejectCarryover(planId, options = {}) {
      return dispatchPlanning('planning.reject_carryover', {
        plan_id: planId,
        actor: options.actor,
      }, options);
    },
  };
  if (config.notion != null) {
    application.notion = Object.freeze({
      getAndSync(options = {}) {
        return requireStarted().notionRuntime.getAndSync(options);
      },
      refreshAndSync(options = {}) {
        return requireStarted().notionRuntime.refreshAndSync(options);
      },
      testConnection() {
        return requireStarted().notionRuntime.testConnection();
      },
      openExternal(target) {
        return requireStarted().notionRuntime.openExternal(target);
      },
      getStatus() {
        const runtime = composition?.notionRuntime ?? lastNotionRuntime;
        if (!runtime) throw new Error('Today/Tomorrow application is not started');
        return runtime.getStatus();
      },
    });
  }
  return Object.freeze(application);
}
