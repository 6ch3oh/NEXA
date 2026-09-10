'use strict';

const { createNexaModuleController } = require('../shared/nexaModuleController');
const { createNexaGlobalCommandRuntime } = require('./nexaGlobalCommandRuntime');

const GLOBAL_COMMAND_CHANNELS = Object.freeze({
  state: 'nexa:global-command:get-state', capabilities: 'nexa:global-command:get-capabilities',
  submit: 'nexa:global-command:submit', confirm: 'nexa:global-command:confirm', cancel: 'nexa:global-command:cancel',
  history: 'nexa:global-command:list-history', clearHistory: 'nexa:global-command:clear-history',
  feedback: 'nexa:global-command:report-feedback',
  models: 'nexa:global-command:list-models', selectModel: 'nexa:global-command:select-model',
  speechState: 'nexa:global-command:speech-state', transcribe: 'nexa:global-command:transcribe',
});
const NEXA_GLOBAL_COMMAND_DESCRIPTOR = Object.freeze({ moduleId: 'global-command', contractVersion: 1, invokeChannels: Object.freeze(Object.values(GLOBAL_COMMAND_CHANNELS)), pushChannels: Object.freeze([]) });

function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }
function unwrapDate(record) { return record.proposal.parameters.date || record.context.SELECTED_DATE || record.context.CURRENT_DATETIME.slice(0, 10); }
function calendarContext(record, summary = {}) {
  const dateTime = record.context.CURRENT_DATETIME;
  return Object.freeze({ date: unwrapDate(record), current_date: dateTime.slice(0, 10), current_time: dateTime.slice(11, 19), timezone: record.context.TIMEZONE, events: Object.freeze(Array.isArray(summary.events) ? summary.events : []), tasks: Object.freeze(Array.isArray(summary.tasks) ? summary.tasks : []) });
}
function isoDates(startDate, endDate, limit = 31) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/u.test(endDate || '')) return [];
  const start = new Date(`${startDate}T00:00:00Z`); const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || start > end) return [];
  const result = [];
  for (let cursor = start; cursor <= end && result.length < limit; cursor = new Date(cursor.valueOf() + 86_400_000)) result.push(cursor.toISOString().slice(0, 10));
  return result;
}
function expenseFilters(parameters, fallbackDate) {
  return Object.freeze({
    startDate: parameters.start_date || parameters.date || fallbackDate || undefined,
    endDate: parameters.end_date || parameters.date || fallbackDate || undefined,
    category: parameters.category || undefined, merchant: parameters.merchant || undefined,
    platform: parameters.platform || undefined, direction: parameters.direction || undefined,
  });
}
function clockMinutes(value) {
  const match = String(value || '').match(/T(\d{2}):(\d{2})/u);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function minuteClock(date, minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${date}T${hour}:${minute}:00`;
}
function deterministicFreeSlots(summary, date, durationMinutes = 60) {
  const duration = Number.isInteger(durationMinutes) && durationMinutes >= 15 && durationMinutes <= 480 ? durationMinutes : 60;
  const busy = (Array.isArray(summary?.events) ? summary.events : [])
    .map((event) => ({ start: clockMinutes(event?.start_at), end: clockMinutes(event?.end_at), event_id: event?.id || null }))
    .filter((interval) => interval.start !== null)
    .map((interval) => ({ ...interval, end: interval.end !== null && interval.end > interval.start ? interval.end : interval.start + 60 }))
    .sort((left, right) => left.start - right.start);
  const candidates = [];
  let cursor = 8 * 60;
  for (const interval of busy) {
    const start = Math.max(8 * 60, interval.start);
    const end = Math.min(22 * 60, interval.end);
    if (start - cursor >= duration) candidates.push(Object.freeze({ start_at: minuteClock(date, cursor), end_at: minuteClock(date, start) }));
    cursor = Math.max(cursor, end);
  }
  if (22 * 60 - cursor >= duration) candidates.push(Object.freeze({ start_at: minuteClock(date, cursor), end_at: minuteClock(date, 22 * 60) }));
  return Object.freeze({ date, duration_minutes: duration, working_window: Object.freeze({ start: '08:00', end: '22:00' }), candidates: Object.freeze(candidates.slice(0, 12)), source: 'calendar_real_events' });
}

function createProductionGlobalCommandAdapters({ composition } = {}) {
  if (!composition?.control || !composition?.todayTomorrow) fail('INVALID_GLOBAL_COMMAND_COMPOSITION', 'NEXA composition is required');
  const { control, todayTomorrow: calendar } = composition;
  async function execute(moduleId, command) { await control.startModule(moduleId); return control.executeModule(moduleId, command); }
  async function automationList() {
    const result = await execute('automation-center', { operation: 'list-automations', arguments: [] });
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.data?.automations)) return result.data.automations;
    return [];
  }
  async function automationId(parameters) {
    if (parameters.automation_id) return parameters.automation_id;
    if (!parameters.automation_name) fail('AUTOMATION_ID_REQUIRED', 'Automation target is required');
    const target = parameters.automation_name.toLocaleLowerCase('zh-CN');
    const matches = (await automationList()).filter((item) => String(item?.name || '').toLocaleLowerCase('zh-CN').includes(target));
    if (matches.length !== 1) fail('AUTOMATION_TARGET_AMBIGUOUS', 'Automation target must resolve to exactly one registered automation');
    return matches[0].automation_id;
  }
  async function safeRead(name, operation) {
    try { return Object.freeze({ name, availability: 'available', value: await operation() }); }
    catch (error) { return Object.freeze({ name, availability: 'unavailable', reason: typeof error?.code === 'string' ? error.code : 'MODULE_UNAVAILABLE' }); }
  }

  const adapters = {
    calendar: {
      async read(proposal, record) {
        await control.startModule('today-tomorrow');
        if (['today', 'query_date', 'query'].includes(proposal.action)) return calendar.getDateSummary({ date: unwrapDate(record) });
        if (proposal.action === 'query_range') {
          const dates = isoDates(proposal.parameters.start_date, proposal.parameters.end_date);
          if (dates.length === 0) return Object.freeze({ code: 'DATE_RANGE_REQUIRED', status: 'unavailable' });
          return Object.freeze({ start_date: dates[0], end_date: dates.at(-1), truncated: dates.length === 31 && dates.at(-1) !== proposal.parameters.end_date, dates: await Promise.all(dates.map((date) => calendar.getDateSummary({ date }))) });
        }
        const date = unwrapDate(record);
        const summary = await calendar.getDateSummary({ date });
        if (proposal.action === 'find_free_slots') return deterministicFreeSlots(summary, date, proposal.parameters.duration_minutes);
        return summary;
      },
      async propose(_proposal, record) {
        await control.startModule('today-tomorrow');
        const summary = await calendar.getDateSummary({ date: unwrapDate(record) });
        return calendar.proposeLocalAi({ request: record.request, context: calendarContext(record, summary) });
      },
      async confirm(_proposal, record, options) {
        await control.startModule('today-tomorrow');
        return calendar.confirmLocalAi(record.adapterProposal.proposal_id, { confirmed: true, highRiskConfirmed: options.highRiskConfirmed === true, operationIds: options.operationIds });
      },
      async cancel(_proposal, record) { await control.startModule('today-tomorrow'); return calendar.cancelLocalAi(record.adapterProposal.proposal_id); },
    },
    consumption: {
      read(proposal, record) {
        if (['pending_drafts', 'mobile_drafts'].includes(proposal.action)) return execute('consumption', { type: 'list-mobile-drafts', payload: { options: { limit: 20 } } });
        const hasStructuredParameters = Object.hasOwn(proposal.parameters, 'start_date');
        if (!hasStructuredParameters && ['query', 'trend'].includes(proposal.action)) return execute('consumption', { type: 'ai-query-filter', payload: { request: record.request } });
        return execute('consumption', { type: 'statistics', payload: { filters: expenseFilters(proposal.parameters, proposal.action === 'query_day' ? unwrapDate(record) : undefined) } });
      },
      propose(proposal) {
        if (!proposal.parameters.selected_object_id || !proposal.parameters.category) fail('RECLASSIFY_ARGUMENTS_REQUIRED', 'Expense record and category are required');
        return Object.freeze({ capability: 'consumption.reclassify', record_id: proposal.parameters.selected_object_id, category: proposal.parameters.category, confirmation_required: true });
      },
      confirm(proposal) {
        return execute('consumption', { type: 'reclassify-record', payload: { recordId: proposal.parameters.selected_object_id, category: proposal.parameters.category } });
      },
    },
    automation: {
      async read(proposal) {
        if (proposal.action === 'list') return automationList();
        const id = await automationId(proposal.parameters);
        if (proposal.action === 'recent_runs') return execute('automation-center', { operation: 'list-recent-runs', arguments: [id, { limit: proposal.parameters.count || 20 }] });
        return execute('automation-center', { operation: 'get-automation-status', arguments: [id] });
      },
      propose(proposal) { return Object.freeze({ capability: `automation.${proposal.action}`, parameters: proposal.parameters, confirmation_required: true, execution_boundary: 'ExecutionHub' }); },
      async confirm(proposal) {
        if (proposal.action === 'create') {
          const capabilityEnvelope = await execute('automation-center', { operation: 'capabilities', arguments: [] });
          const routeEnvelope = await execute('automation-center', { operation: 'available-ai-routes', arguments: [] });
          const capabilityData = capabilityEnvelope?.data || capabilityEnvelope;
          const routeData = routeEnvelope?.data || routeEnvelope;
          const target = (capabilityData?.creation_targets || []).find((item) => item?.safety_policy_ref?.credential_mode === 'CREDENTIAL_FREE' && item?.safety_policy_ref?.authorization_mode === 'NOT_REQUIRED');
          const route = (routeData?.routes || []).find((item) => item?.profile_id === 'LOCAL_DIAGNOSTIC' && item?.provider === 'local' && item?.max_ai_calls === 0);
          if (!target || !route) fail('LOCAL_DIAGNOSTIC_TEMPLATE_UNAVAILABLE', 'Credential-free local diagnostic automation template is unavailable');
          const name = proposal.parameters.automation_name || 'NEXA 本地诊断';
          const id = `nexa-local-diagnostic-${Date.now()}`;
          return execute('automation-center', { operation: 'create-automation', arguments: [{
            automation_id: id, name, description: '由 NEXA Local AI Control Plane 创建的本地诊断自动化。', enabled: false,
            execution_target: target.execution_target, input: { operation: 'NEXA_EXECUTION_CHAIN_HEALTHCHECK' }, ai_route: route,
            schedule_policy: { kind: 'MANUAL', timezone: null, once_at: null, local_time: null, day_of_week: null, scheduler_status: 'NOT_APPLICABLE' },
            safety_policy_ref: target.safety_policy_ref,
          }] });
        }
        const id = await automationId(proposal.parameters);
        if (proposal.action === 'update') {
          const name = proposal.parameters.query || proposal.parameters.automation_name;
          if (!name) fail('AUTOMATION_UPDATE_REQUIRED', 'Automation update requires an explicit new name');
          return execute('automation-center', { operation: 'update-automation', arguments: [id, { name }] });
        }
        const operation = ({ run: 'manual-run', manual_run: 'manual-run', enable: 'enable-automation', disable: 'disable-automation' })[proposal.action];
        if (!operation) fail('COMMAND_ADAPTER_UNAVAILABLE', 'Automation operation is unavailable');
        return execute('automation-center', { operation, arguments: [id] });
      },
    },
    learning: {
      async read(proposal) {
        const summary = await execute('study-center', { operation: 'get-home-summary' });
        if (['lookup_word', 'query_word'].includes(proposal.action) && proposal.parameters.word) {
          const cards = Array.isArray(summary?.cards) ? summary.cards : [];
          return Object.freeze({ query: proposal.parameters.word, cards: cards.filter((card) => String(card?.word || '').toLocaleLowerCase('en-US') === proposal.parameters.word.toLocaleLowerCase('en-US')) });
        }
        return summary;
      },
      propose(proposal) {
        return Object.freeze({ capability: `learning.${proposal.action}`, parameters: proposal.parameters, confirmation_required: true });
      },
      confirm(proposal) {
        const count = Number.isInteger(proposal.parameters.count) && proposal.parameters.count > 0 ? proposal.parameters.count : 20;
        const dailyNewLimit = Math.min(count, 10);
        return execute('study-center', { operation: 'update-plan', plan: { dailyNewLimit, dailyReviewLimit: Math.max(0, count - dailyNewLimit), dailyTotalLimit: count } });
      },
    },
    device: {
      read(proposal) {
        const operation = ({
          summary: 'dashboard', cpu: 'performance', memory: 'performance', gpu: 'performance', storage: 'performance',
          connected_devices: 'overview', mobile_status: 'dashboard', status: 'dashboard', performance: 'performance',
          network: 'network', connections: 'overview', apex: 'diagnostics',
        })[proposal.action];
        return execute('device-center', { operation });
      },
    },
    network: {
      read(proposal) {
        const operation = ['apex_status'].includes(proposal.action) ? 'diagnostics' : ['light_probe_status'].includes(proposal.action) ? 'history' : 'network';
        return execute('device-center', { operation });
      },
    },
    market: {
      read(proposal) {
        const method = ({ watchlist: 'get_watchlist', summary: 'get_market_home', instrument: 'get_instrument_detail', recent_observations: 'list_evidence', overview: 'get_market_home', query: 'get_instrument_detail' })[proposal.action];
        return execute('market', { method, params: { instrument: proposal.parameters.instrument || proposal.parameters.selected_object_id || undefined } });
      },
    },
    creator: {
      read(proposal) {
        if (['accounts', 'summary', 'performance', 'overview'].includes(proposal.action)) return execute('creator-ops', { type: 'GET_READINESS' });
        const view = proposal.action === 'portfolio' ? 'portfolio' : 'recent';
        return execute('creator-ops', { type: 'WORKS_QUERY', request: { operation: 'list', view } });
      },
    },
    dashi: {
      read(proposal) {
        const operation = ({ today: 'list-tasks', tasks: 'list-tasks', workflow: 'get-task-execution-context', status: 'get-source-health', overview: 'get-board-overview', query: 'list-tasks' })[proposal.action];
        const command = operation === 'list-tasks' ? { operation, options: {} } : operation === 'get-task-execution-context' ? { operation, taskId: proposal.parameters.task_id || proposal.parameters.selected_object_id } : { operation };
        return execute('dashi', command);
      },
    },
    starbench: {
      read(proposal) {
        const capability = ({ summary: 'evaluation_results', models: 'request_records', latest_results: 'evaluation_results', compare: 'evaluation_history', overview: 'evaluation_results', query: 'evaluation_results' })[proposal.action];
        return execute('starbench', { operation: 'read', capability, query: {} });
      },
    },
    global_query: {
      async read(_proposal, record) {
        const date = record.context.CURRENT_DATETIME.slice(0, 10);
        const sections = await Promise.all([
          safeRead('calendar', () => control.startModule('today-tomorrow').then(() => calendar.getDateSummary({ date }))),
          safeRead('consumption', () => execute('consumption', { type: 'statistics', payload: { filters: { startDate: date, endDate: date } } })),
          safeRead('automation', () => automationList()),
          safeRead('learning', () => execute('study-center', { operation: 'get-home-summary' })),
          safeRead('device', () => execute('device-center', { operation: 'dashboard' })),
        ]);
        return Object.freeze({ date, source: 'deterministic_real_module_aggregation', sections });
      },
    },
  };
  return Object.freeze(Object.fromEntries(Object.entries(adapters).map(([key, value]) => [key, Object.freeze(value)])));
}

function createNexaGlobalCommandIpcHandlers(runtime, speechToTextProvider = null) {
  if (!runtime || typeof runtime.submit !== 'function' || typeof runtime.confirm !== 'function') fail('INVALID_GLOBAL_COMMAND_RUNTIME', 'Global Command runtime is required');
  return Object.freeze({
    [GLOBAL_COMMAND_CHANNELS.state]: () => runtime.getState(),
    [GLOBAL_COMMAND_CHANNELS.capabilities]: () => runtime.getCapabilities(),
    [GLOBAL_COMMAND_CHANNELS.submit]: (_event, input) => runtime.submit(input),
    [GLOBAL_COMMAND_CHANNELS.confirm]: (_event, proposalId, options) => runtime.confirm(proposalId, options),
    [GLOBAL_COMMAND_CHANNELS.cancel]: (_event, proposalId) => runtime.cancel(proposalId),
    [GLOBAL_COMMAND_CHANNELS.history]: () => runtime.listHistory(),
    [GLOBAL_COMMAND_CHANNELS.clearHistory]: () => runtime.clearHistory(),
    [GLOBAL_COMMAND_CHANNELS.feedback]: (_event, diagnosticId, status) => runtime.reportFeedback(diagnosticId, status),
    [GLOBAL_COMMAND_CHANNELS.models]: () => runtime.listModels({ refresh: true }),
    [GLOBAL_COMMAND_CHANNELS.selectModel]: (_event, modelId) => runtime.selectModel(modelId),
    [GLOBAL_COMMAND_CHANNELS.speechState]: () => speechToTextProvider?.getState?.() || Object.freeze({ status: 'provider_ready_gap', can_transcribe: false, local_only: true }),
    [GLOBAL_COMMAND_CHANNELS.transcribe]: (_event, input) => { if (!speechToTextProvider?.transcribe) fail('STT_PROVIDER_UNAVAILABLE', 'Local speech-to-text provider is unavailable'); return speechToTextProvider.transcribe(input); },
  });
}
function createNexaGlobalCommandController(runtime) {
  if (!runtime || typeof runtime.submit !== 'function') fail('INVALID_GLOBAL_COMMAND_RUNTIME', 'Global Command runtime is required');
  return createNexaModuleController({
    start() {}, stop() {}, getSnapshot() { return runtime.getState(); },
    execute(command) {
      if (!command || typeof command !== 'object' || Array.isArray(command)) fail('INVALID_GLOBAL_COMMAND_INPUT', 'command is required');
      if (command.type === 'submit') return runtime.submit(command.input);
      if (command.type === 'confirm') return runtime.confirm(command.proposalId, command.options);
      if (command.type === 'cancel') return runtime.cancel(command.proposalId);
      fail('UNSUPPORTED_GLOBAL_COMMAND_OPERATION', 'unsupported global command controller operation');
    },
  });
}
function createProductionNexaGlobalCommandRuntime({ composition, provider, clock, timezone, auditLog, runtimeCoordinator } = {}) {
  return createNexaGlobalCommandRuntime({ provider, adapters: createProductionGlobalCommandAdapters({ composition }), clock, timezone, auditLog, runtimeCoordinator });
}

module.exports = {
  GLOBAL_COMMAND_CHANNELS, NEXA_GLOBAL_COMMAND_DESCRIPTOR, createNexaGlobalCommandController,
  createNexaGlobalCommandIpcHandlers, createProductionGlobalCommandAdapters, createProductionNexaGlobalCommandRuntime,
  expenseFilters, isoDates,
};
