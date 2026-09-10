'use strict';

const { createHash } = require('node:crypto');
const { createNexaModuleController } = require('../shared/nexaModuleController');

const NEXA_TODAY_TOMORROW_DESCRIPTOR = Object.freeze({
  moduleId: 'today-tomorrow',
  contractVersion: 1,
  invokeChannels: Object.freeze([
    'nexa:today-tomorrow:get-home-summary',
    'nexa:today-tomorrow:get-date-summary',
    'nexa:today-tomorrow:get-month-summary',
    'nexa:today-tomorrow:get-view',
    'nexa:today-tomorrow:parse-home-input',
    'nexa:today-tomorrow:get-local-ai-state',
    'nexa:today-tomorrow:check-local-ai-health',
    'nexa:today-tomorrow:propose-local-ai',
    'nexa:today-tomorrow:confirm-local-ai',
    'nexa:today-tomorrow:cancel-local-ai',
    'nexa:today-tomorrow:undo-local-ai',
    'nexa:today-tomorrow:execute'
  ]),
  pushChannels: Object.freeze([])
});

class NexaTodayTomorrowBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaTodayTomorrowBridgeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaTodayTomorrowBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'TODAY_TOMORROW_REQUEST_FAILED';
  return Object.freeze({ ok: false, error: Object.freeze({ code, message: 'Today/Tomorrow request failed' }) });
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const HOME_SUBLABEL_KINDS = new Set([
  'important_reminder', 'fixed_schedule', 'todo_count', 'holiday', 'anniversary', 'event', 'empty'
]);

function boundedText(value, field, { nullable = false, limit = 200 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    fail('INVALID_HOME_SUMMARY', `${field} must be bounded text`);
  }
  return value;
}

function homeCount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_HOME_SUMMARY', `${field} must be a count`);
  return value;
}

function projectCalendarItem(value, field) {
  if (value === null) return null;
  if (!isPlainObject(value)) fail('INVALID_HOME_SUMMARY', `${field} must be an object or null`);
  const result = {};
  for (const key of ['id', 'title', 'display_time', 'start_at', 'end_at', 'status']) {
    if (value[key] === null || ['string', 'number', 'boolean'].includes(typeof value[key])) result[key] = value[key];
  }
  if (typeof result.title === 'string' && result.title.length > 200) result.title = `${result.title.slice(0, 199)}…`;
  if (value.is_happening_now === true || value.is_happening_now === false) {
    result.is_happening_now = value.is_happening_now;
  }
  return Object.freeze(result);
}

function projectTimeline(value, index) {
  if (!isPlainObject(value)) fail('INVALID_HOME_SUMMARY', `timeline[${index}] is invalid`);
  return Object.freeze({
    type: boundedText(value.type, `timeline[${index}].type`, { limit: 48 }),
    start_at: boundedText(value.start_at, `timeline[${index}].start_at`, { limit: 48 }),
    end_at: boundedText(value.end_at ?? null, `timeline[${index}].end_at`, { nullable: true, limit: 48 }),
    item: projectCalendarItem(value.item, `timeline[${index}].item`)
  });
}

function projectDateTask(value, index) {
  if (!isPlainObject(value)) fail('INVALID_HOME_SUMMARY', `tasks[${index}] is invalid`);
  const id = value.id ?? value.task_id;
  const result = {
    id: assertId(id, `tasks[${index}].id`),
    title: boundedText(value.title, `tasks[${index}].title`, { limit: 160 })
  };
  for (const field of [
    'status', 'priority', 'due_at', 'time_state', 'display_time', 'planned_start_at', 'planned_end_at', 'plan_id'
  ]) {
    if (value[field] === null || ['string', 'number', 'boolean'].includes(typeof value[field])) {
      result[field] = value[field];
    }
  }
  return Object.freeze(result);
}

function projectHandoff(value, expectedAction, date, field) {
  if (!isPlainObject(value) || value.route_id !== 'today-tomorrow' ||
      value.action !== expectedAction || value.date !== date) {
    fail('INVALID_HOME_SUMMARY', `${field} is invalid`);
  }
  return Object.freeze({ route_id: 'today-tomorrow', action: expectedAction, date });
}

function projectDateSummary(value, { embedded = false } = {}) {
  if (!isPlainObject(value) || (!embedded && value.contract_version !== '0.2.0') ||
      !Array.isArray(value.events) || !Array.isArray(value.timeline) || value.availability !== 'available') {
    fail('INVALID_HOME_SUMMARY', 'Calendar date summary is invalid');
  }
  const date = assertDate(value.date, 'date');
  const kind = boundedText(value.sublabel_kind, 'sublabel_kind', { limit: 48 });
  if (!HOME_SUBLABEL_KINDS.has(kind)) fail('INVALID_HOME_SUMMARY', 'sublabel_kind is invalid');
  if (!Number.isSafeInteger(value.sublabel_priority) || value.sublabel_priority < 10 || value.sublabel_priority > 60) {
    fail('INVALID_HOME_SUMMARY', 'sublabel_priority is invalid');
  }
  const projected = {
    date,
    todo_count: homeCount(value.todo_count, 'todo_count'),
    event_count: homeCount(value.event_count, 'event_count'),
    holiday_label: boundedText(value.holiday_label, 'holiday_label', { nullable: true, limit: 80 }),
    anniversary_label: boundedText(value.anniversary_label, 'anniversary_label', { nullable: true, limit: 80 }),
    sublabel: boundedText(value.sublabel, 'sublabel', { limit: 80 }),
    sublabel_kind: kind,
    sublabel_priority: value.sublabel_priority,
    events: Object.freeze(value.events.map((item, index) => projectCalendarItem(item, `events[${index}]`))),
    next_event: projectCalendarItem(value.next_event, 'next_event'),
    timeline: Object.freeze(value.timeline.map(projectTimeline)),
    detail_handoff: projectHandoff(value.detail_handoff, 'view-date', date, 'detail_handoff'),
    edit_handoff: projectHandoff(value.edit_handoff, 'edit-date', date, 'edit_handoff'),
    availability: 'available'
  };
  if (!embedded) {
    if (!isPlainObject(value.freshness) || value.freshness.status !== 'unknown' ||
        value.freshness.reason !== 'source_timestamp_unavailable') {
      fail('INVALID_HOME_SUMMARY', 'Calendar freshness is invalid');
    }
    const generatedAt = boundedText(value.generated_at, 'generated_at', { limit: 48 });
    if (Number.isNaN(Date.parse(generatedAt)) || value.freshness.generated_at !== generatedAt) {
      fail('INVALID_HOME_SUMMARY', 'Calendar generated timestamp is invalid');
    }
    projected.contract_version = '0.2.0';
    projected.generated_at = generatedAt;
    projected.freshness = Object.freeze({
      status: 'unknown',
      reason: 'source_timestamp_unavailable',
      generated_at: generatedAt
    });
  }
  return Object.freeze(projected);
}

function projectMonthSummary(value) {
  if (!isPlainObject(value) || value.contract_version !== '0.2.0' || !isPlainObject(value.range) ||
      !Array.isArray(value.dates) || value.dates.length > 62 || value.availability !== 'available' ||
      !isPlainObject(value.freshness) || value.freshness.status !== 'unknown' ||
      value.freshness.reason !== 'source_timestamp_unavailable') {
    fail('INVALID_HOME_SUMMARY', 'Calendar month summary is invalid');
  }
  const startDate = assertDate(value.range.start_date, 'range.start_date');
  const endDate = assertDate(value.range.end_date, 'range.end_date');
  const generatedAt = boundedText(value.generated_at, 'generated_at', { limit: 48 });
  if (Number.isNaN(Date.parse(generatedAt)) || value.freshness.generated_at !== generatedAt) {
    fail('INVALID_HOME_SUMMARY', 'Calendar generated timestamp is invalid');
  }
  return Object.freeze({
    contract_version: '0.2.0',
    range: Object.freeze({ start_date: startDate, end_date: endDate }),
    dates: Object.freeze(value.dates.map((item) => projectDateSummary(item, { embedded: true }))),
    today_summary: projectDateSummary(value.today_summary, { embedded: true }),
    next_event: projectCalendarItem(value.next_event, 'next_event'),
    availability: 'available',
    generated_at: generatedAt,
    freshness: Object.freeze({
      status: 'unknown',
      reason: 'source_timestamp_unavailable',
      generated_at: generatedAt
    })
  });
}

function projectTask(task) {
  if (!isPlainObject(task)) return null;
  const projected = {};
  for (const field of ['id', 'title', 'description', 'status', 'priority', 'due_at', 'source', 'time_state']) {
    const value = task[field];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) projected[field] = value;
  }
  return Object.freeze(projected);
}

function validatePublicApi(publicApi) {
  if (publicApi?.TODAY_TOMORROW_PUBLIC_API_VERSION !== '0.1.0' ||
      typeof publicApi.createTodayTomorrowApplication !== 'function' ||
      publicApi.CALENDAR_HOME_WIDGET_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi.createCalendarHomeWidgetAdapter !== 'function' ||
      publicApi.CALENDAR_HOME_SUMMARY_CONTRACT_VERSION !== '0.2.0' ||
      typeof publicApi.createCalendarHomeSummaryAdapter !== 'function' ||
      publicApi.CALENDAR_LOCAL_AI_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi.createCalendarLocalAiAdapter !== 'function') {
    fail('INVALID_PUBLIC_API', 'Today/Tomorrow Public API V0.1.0 is required');
  }
}

function validateHomeWidget(widget) {
  if (typeof widget?.getTodaySummary !== 'function' || typeof widget?.parseButlerInput !== 'function') {
    fail('INVALID_HOME_WIDGET', 'Calendar Home Widget Public Contract V0.1.0 is required');
  }
}

function validateHomeSummaryAdapter(adapter) {
  if (typeof adapter?.getDateSummary !== 'function' || typeof adapter?.getMonthSummary !== 'function' ||
      Object.keys(adapter).length !== 2) {
    fail('INVALID_HOME_SUMMARY_ADAPTER', 'Calendar Home Summary Public Contract V0.2.0 is required');
  }
}

function validateApplication(application) {
  for (const method of [
    'start', 'stop', 'getStatus', 'getToday', 'getTomorrow', 'getTask', 'getReminders',
    'assignTaskToDay', 'confirmTaskTime', 'changeTaskTime', 'removeTaskTime',
    'confirmCarryover', 'rejectCarryover', 'execute'
  ]) {
    if (typeof application?.[method] !== 'function') {
      fail('INVALID_APPLICATION', 'Today/Tomorrow application surface is incomplete');
    }
  }
}

function assertDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail('INVALID_COMMAND', `${field} must be an ISO date`);
  }
  return value;
}

function assertId(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    fail('INVALID_COMMAND', `${field} must be a bounded non-empty string`);
  }
  return value;
}

function assertTaskTitle(value) {
  if (typeof value !== 'string') {
    fail('INVALID_COMMAND', 'title must be bounded non-empty text');
  }
  const title = value.replace(/\s+/gu, ' ').trim();
  if (title.length === 0 || title.length > 160) {
    fail('INVALID_COMMAND', 'title must be bounded non-empty text');
  }
  return title;
}

function localTaskIdentity(commandId) {
  const digest = createHash('sha256').update(commandId, 'utf8').digest('hex').slice(0, 24);
  return Object.freeze({
    taskId: `home-task-${digest}`,
    assignCommandId: `home-assign-${digest}`
  });
}

function assertTime(value, field) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(Date.parse(value))) {
    fail('INVALID_COMMAND', `${field} must be an explicit timestamp`);
  }
  return value;
}

function createNexaTodayTomorrowController({
  publicApi,
  dataRoot,
  timezone,
  clock,
  localAiProvider = null,
  localAiUndoExecutor = null
}) {
  validatePublicApi(publicApi);
  let application = null;
  let homeWidget = null;
  let homeSummaryAdapter = null;
  let localAiAdapter = null;

  function app() {
    if (!application) fail('APPLICATION_NOT_STARTED', 'Today/Tomorrow application is not started');
    return application;
  }

  function widget() {
    if (!homeWidget) fail('APPLICATION_NOT_STARTED', 'Calendar Home Widget is not started');
    return homeWidget;
  }

  function summaryAdapter() {
    if (!homeSummaryAdapter) fail('APPLICATION_NOT_STARTED', 'Calendar Home Summary is not started');
    return homeSummaryAdapter;
  }

  function aiAdapter() {
    if (!localAiAdapter) fail('APPLICATION_NOT_STARTED', 'Calendar Local AI adapter is not started');
    return localAiAdapter;
  }

  const controller = createNexaModuleController({
    start() {
      application = publicApi.createTodayTomorrowApplication({ dataRoot, timezone, clock });
      validateApplication(application);
      homeWidget = publicApi.createCalendarHomeWidgetAdapter({
        calendarApplication: application,
        timezone,
        clock
      });
      validateHomeWidget(homeWidget);
      homeSummaryAdapter = publicApi.createCalendarHomeSummaryAdapter({
        calendarApplication: application,
        timezone,
        clock
      });
      validateHomeSummaryAdapter(homeSummaryAdapter);
      localAiAdapter = publicApi.createCalendarLocalAiAdapter({
        timezone,
        clock,
        provider: localAiProvider,
        commandExecutor: (command) => app().execute(command),
        undoExecutor: localAiUndoExecutor
      });
      return application.start();
    },
    stop() {
      const current = application;
      homeWidget = null;
      homeSummaryAdapter = null;
      localAiAdapter = null;
      application = null;
      return current?.stop();
    },
    getSnapshot() {
      return application ? cloneJson(application.getStatus()) : Object.freeze({
        api_version: publicApi.TODAY_TOMORROW_PUBLIC_API_VERSION,
        state: 'stopped',
        started: false
      });
    },
    execute(command) {
      if (!isPlainObject(command) || typeof command.type !== 'string') {
        fail('INVALID_COMMAND', 'Today/Tomorrow command must be a plain object with a type');
      }
      const current = app();
      switch (command.type) {
        case 'get-today':
          return cloneJson(current.getToday(assertDate(command.date, 'date')));
        case 'get-tomorrow':
          return cloneJson(current.getTomorrow(assertDate(command.today, 'today')));
        case 'get-task':
          return projectTask(current.getTask(assertId(command.taskId, 'taskId')));
        case 'get-reminders':
          return cloneJson(current.getReminders());
        case 'assign-day':
          return cloneJson(current.assignTaskToDay(
            assertId(command.taskId, 'taskId'), assertDate(command.planDate, 'planDate'), { actor: 'user' }
          ));
        case 'confirm-time':
        case 'change-time': {
          const input = {
            planned_start_at: assertTime(command.plannedStartAt, 'plannedStartAt'),
            planned_end_at: assertTime(command.plannedEndAt, 'plannedEndAt'),
            actor: 'user',
            accept_conflicts: command.acceptConflicts === true
          };
          return cloneJson(command.type === 'confirm-time'
            ? current.confirmTaskTime(assertId(command.planId, 'planId'), input)
            : current.changeTaskTime(assertId(command.planId, 'planId'), input));
        }
        case 'remove-time':
          return cloneJson(current.removeTaskTime(assertId(command.planId, 'planId'), { actor: 'user' }));
        case 'confirm-carryover':
          return cloneJson(current.confirmCarryover(
            assertId(command.planId, 'planId'), assertDate(command.toDate, 'toDate'), { actor: 'user' }
          ));
        case 'reject-carryover':
          return cloneJson(current.rejectCarryover(assertId(command.planId, 'planId'), { actor: 'user' }));
        case 'create-day-task': {
          const commandId = assertId(command.commandId, 'commandId');
          const planDate = assertDate(command.planDate, 'planDate');
          const title = assertTaskTitle(command.title);
          const { taskId, assignCommandId } = localTaskIdentity(commandId);
          const created = current.execute({
            command_id: commandId,
            command_type: 'task.create',
            payload: {
              task: {
                id: taskId,
                title,
                due_at: planDate,
                time_state: 'date_only'
              }
            },
            created_at: clock(),
            risk_level: 'low',
            requires_confirmation: false,
            confirmation_state: 'not_required',
            source: 'local'
          });
          if (!created || !['executed', 'duplicate'].includes(created.status)) {
            fail('TASK_CREATE_FAILED', 'Local task creation did not complete');
          }
          const plan = current.assignTaskToDay(taskId, planDate, {
            actor: 'user',
            command_id: assignCommandId
          });
          return cloneJson({
            status: created.status === 'duplicate' ? 'existing' : 'created',
            task: projectTask(current.getTask(taskId)),
            plan
          });
        }
        case 'complete-task': {
          const taskId = assertId(command.taskId, 'taskId');
          return cloneJson(current.execute({
            command_id: assertId(command.commandId, 'commandId'),
            command_type: 'task.complete',
            payload: { task_id: taskId },
            created_at: clock(),
            risk_level: 'medium',
            requires_confirmation: false,
            confirmation_state: 'not_required',
            source: 'local'
          }));
        }
        default:
          fail('UNKNOWN_COMMAND', 'Today/Tomorrow command is not supported');
      }
    }
  });

  return Object.freeze({
    ...controller,
    getHomeSummary(input = {}) {
      return cloneJson(widget().getTodaySummary(input));
    },
    getDateSummary(input = {}) {
      const summary = projectDateSummary(summaryAdapter().getDateSummary(input));
      const today = app().getToday(summary.date);
      const seen = new Set();
      const tasks = [
        ...(Array.isArray(today?.confirmed_task_plans) ? today.confirmed_task_plans : []),
        ...(Array.isArray(today?.unplaced_tasks) ? today.unplaced_tasks : [])
      ].map(projectDateTask).filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
      });
      return Object.freeze({ ...summary, tasks: Object.freeze(tasks) });
    },
    getMonthSummary(input) {
      return projectMonthSummary(summaryAdapter().getMonthSummary(input));
    },
    parseHomeInput(input) {
      if (typeof input !== 'string' || input.trim() === '' || input.length > 2000) {
        fail('INVALID_BUTLER_INPUT', 'Butler input must be a bounded non-empty string');
      }
      return cloneJson(widget().parseButlerInput(input));
    },
    getLocalAiState() {
      return cloneJson(aiAdapter().getState());
    },
    async checkLocalAiHealth() {
      if (!localAiProvider || typeof localAiProvider.healthCheck !== 'function') {
        return Object.freeze({ ok: false, code: 'AI_CONFIGURATION_INCOMPLETE', networkRequestPerformed: false });
      }
      return cloneJson(await localAiProvider.healthCheck());
    },
    proposeLocalAi(input) {
      if (!isPlainObject(input)) fail('INVALID_AI_INPUT', 'Calendar Local AI input must be an object');
      return aiAdapter().propose({ request: input.request, context: input.context });
    },
    confirmLocalAi(proposalId, options = {}) {
      return aiAdapter().confirm(assertId(proposalId, 'proposalId'), {
        confirmed: options?.confirmed === true,
        highRiskConfirmed: options?.highRiskConfirmed === true,
        operationIds: options?.operationIds
      });
    },
    cancelLocalAi(proposalId) {
      return aiAdapter().cancel(assertId(proposalId, 'proposalId'));
    },
    undoLocalAi(proposalId, options = {}) {
      return aiAdapter().undo(assertId(proposalId, 'proposalId'), { confirmed: options?.confirmed === true });
    }
  });
}

function createNexaTodayTomorrowIpcHandlers(control, homeWidgetReader) {
  if (!control || typeof control.startModule !== 'function' || typeof control.executeModule !== 'function') {
    fail('INVALID_CONTROL', 'NEXA module control is required');
  }
  if (!homeWidgetReader || typeof homeWidgetReader.getHomeSummary !== 'function' ||
      typeof homeWidgetReader.getDateSummary !== 'function' ||
      typeof homeWidgetReader.getMonthSummary !== 'function' ||
      typeof homeWidgetReader.parseHomeInput !== 'function' ||
      typeof homeWidgetReader.getLocalAiState !== 'function' ||
      typeof homeWidgetReader.checkLocalAiHealth !== 'function' ||
      typeof homeWidgetReader.proposeLocalAi !== 'function' ||
      typeof homeWidgetReader.confirmLocalAi !== 'function' ||
      typeof homeWidgetReader.cancelLocalAi !== 'function' ||
      typeof homeWidgetReader.undoLocalAi !== 'function') {
    fail('INVALID_HOME_WIDGET_READER', 'Calendar Home Widget reader is required');
  }
  async function execute(command) {
    try {
      await control.startModule('today-tomorrow');
      return Object.freeze({ ok: true, value: await control.executeModule('today-tomorrow', command) });
    } catch (error) {
      return safeError(error);
    }
  }
  async function read(operation) {
    try {
      await control.startModule('today-tomorrow');
      return Object.freeze({ ok: true, value: await operation() });
    } catch (error) {
      return safeError(error);
    }
  }
  return Object.freeze({
    'nexa:today-tomorrow:get-home-summary': (_event, date) => read(() => (
      homeWidgetReader.getHomeSummary(date === undefined ? {} : { date })
    )),
    'nexa:today-tomorrow:get-date-summary': (_event, date) => read(() => (
      homeWidgetReader.getDateSummary(date === undefined ? {} : { date: assertDate(date, 'date') })
    )),
    'nexa:today-tomorrow:get-month-summary': (_event, startDate, endDate) => read(() => (
      homeWidgetReader.getMonthSummary({
        start_date: assertDate(startDate, 'startDate'),
        end_date: assertDate(endDate, 'endDate')
      })
    )),
    'nexa:today-tomorrow:get-view': (_event, view, date) => {
      if (view !== 'today' && view !== 'tomorrow') {
        return safeError(new NexaTodayTomorrowBridgeError('INVALID_VIEW', 'Unknown Today/Tomorrow view'));
      }
      return execute(view === 'tomorrow'
        ? { type: 'get-tomorrow', today: date }
        : { type: 'get-today', date });
    },
    'nexa:today-tomorrow:parse-home-input': (_event, input) => read(() => (
      homeWidgetReader.parseHomeInput(input)
    )),
    'nexa:today-tomorrow:get-local-ai-state': () => read(() => homeWidgetReader.getLocalAiState()),
    'nexa:today-tomorrow:check-local-ai-health': () => read(() => homeWidgetReader.checkLocalAiHealth()),
    'nexa:today-tomorrow:propose-local-ai': (_event, input) => read(() => homeWidgetReader.proposeLocalAi(input)),
    'nexa:today-tomorrow:confirm-local-ai': (_event, proposalId, options) => read(() => (
      homeWidgetReader.confirmLocalAi(proposalId, options)
    )),
    'nexa:today-tomorrow:cancel-local-ai': (_event, proposalId) => read(() => (
      homeWidgetReader.cancelLocalAi(proposalId)
    )),
    'nexa:today-tomorrow:undo-local-ai': (_event, proposalId, options) => read(() => (
      homeWidgetReader.undoLocalAi(proposalId, options)
    )),
    'nexa:today-tomorrow:execute': (_event, command) => execute(command)
  });
}

module.exports = {
  NEXA_TODAY_TOMORROW_DESCRIPTOR,
  NexaTodayTomorrowBridgeError,
  createNexaTodayTomorrowController,
  createNexaTodayTomorrowIpcHandlers,
  localTaskIdentity,
  projectDateSummary,
  projectMonthSummary
};
