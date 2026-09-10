'use strict';

const {
  GLOBAL_COMMAND_HISTORY_LIMIT, LOCAL_AI_CONTROL_PLANE_VERSION, NAVIGATION_ROUTE_IDS,
  createNexaCommandCapabilityRegistry, normalizeGlobalCommandContext,
  normalizeGlobalCommandProposal, normalizeLocalAiPlan, resolveDeterministicGlobalCommand,
} = require('../shared/nexaGlobalCommandContract');

const SENSITIVE_COMMAND_PATTERN = /(?:api[ _-]?key|authorization|bearer|cookie|credential|password|secret|token\s*[:=])/iu;
const ROUTE_ALIASES = Object.freeze({
  consumption: 'cost', learning: 'study-center', device: 'device-center', network: 'device-center',
  automation: 'automation-center', creator: 'creator-ops', settings: 'settings', calendar: 'calendar',
});
const AI_UNAVAILABLE_CODES = new Set([
  'SERVER_NOT_RUNNING', 'TIMEOUT', 'MODEL_NOT_LOADED', 'MODEL_ID_MISMATCH',
  'AI_PROVIDER_REJECTED', 'AI_PROVIDER_BUSY', 'AI_QUEUE_TIMEOUT', 'INVALID_RESPONSE',
  'STRUCTURED_OUTPUT_UNAVAILABLE', 'AI_CONFIGURATION_INCOMPLETE',
]);
const ERROR_CATEGORIES = Object.freeze({
  AI_CONFIGURATION_INCOMPLETE: 'CONFIGURATION_INCOMPLETE',
  SERVER_NOT_RUNNING: 'SERVICE_UNREACHABLE',
  MODEL_ID_MISMATCH: 'MODEL_MISMATCH',
  MODEL_NOT_LOADED: 'MODEL_NOT_READY',
  AI_PROVIDER_BUSY: 'QUEUE_TIMEOUT',
  AI_QUEUE_TIMEOUT: 'QUEUE_TIMEOUT',
  TIMEOUT: 'REQUEST_TIMEOUT',
  AI_PROVIDER_REJECTED: 'HTTP_REJECTED',
  INVALID_RESPONSE: 'INVALID_FORMAT',
  AI_RESPONSE_TOO_LARGE: 'INVALID_FORMAT',
  STRUCTURED_OUTPUT_UNAVAILABLE: 'STRUCTURED_OUTPUT_UNSUPPORTED',
  INVALID_NAVIGATION_TARGET: 'ACTION_UNSUPPORTED',
  CAPABILITY_UNAVAILABLE: 'ACTION_UNSUPPORTED',
  COMMAND_ADAPTER_UNAVAILABLE: 'ACTION_UNSUPPORTED',
  SECOND_CONFIRMATION_REQUIRED: 'PERMISSION_BLOCKED',
  CONFIRMATION_REQUIRED: 'PERMISSION_BLOCKED',
  AI_CANCELLED: 'USER_CANCELLED',
  AUDIT_WRITE_FAILED: 'PERSISTENCE_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
});
const STAGE_LABELS = Object.freeze({
  IPC_RECEIVED: '已接收命令', INPUT_VALIDATION: '参数与权限检查',
  PROVIDER_QUEUE: '等待本地 AI', MODEL_AND_CAPABILITY_SELECTION: '模型与能力选择',
  LOCAL_AI_REQUEST: '本地服务请求', RESPONSE_RECEIVED: '接收模型响应',
  SCHEMA_VALIDATION: 'JSON / Schema 校验', CAPABILITY_ROUTE: '能力路由',
  PROPOSAL_PREVIEW: '生成待确认提案', BUSINESS_EXECUTION: '业务执行',
  BUSINESS_PERSISTENCE: '业务持久化', UI_FEEDBACK: '界面反馈',
});

function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }
function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function safeText(value, limit = 2000) { return typeof value === 'string' ? value.trim().slice(0, limit) : ''; }
function historyText(value) { const text = safeText(value, 500); return SENSITIVE_COMMAND_PATTERN.test(text) ? '[已隐藏敏感命令]' : text; }
function errorCategory(error) {
  return ERROR_CATEGORIES[typeof error?.code === 'string' ? error.code : ''] || 'UNKNOWN_FAILURE';
}
function createCommandTrace({ commandId, clock, monotonicClock, provider }) {
  const stages = [];
  function add(name, status, startedAt, startedTick, error = null, detail = null) {
    const finishedAt = clock();
    const duration = Math.max(0, Math.round(monotonicClock() - startedTick));
    stages.push(Object.freeze({
      name, label: STAGE_LABELS[name] || name, status, started_at: startedAt,
      finished_at: finishedAt, duration_ms: duration,
      error_category: error ? errorCategory(error) : null,
      ...(detail ? { detail } : {}),
    }));
  }
  async function run(name, operation, detail = null) {
    const startedAt = clock(); const startedTick = monotonicClock();
    try {
      const value = await operation(); add(name, 'PASS', startedAt, startedTick, null, detail); return value;
    } catch (error) {
      add(name, 'FAIL', startedAt, startedTick, error, detail);
      if (error && typeof error === 'object' && !error.diagnostic_stage) error.diagnostic_stage = name;
      throw error;
    }
  }
  function mark(name, status, detail = null) {
    const startedAt = clock(); const startedTick = monotonicClock(); add(name, status, startedAt, startedTick, null, detail);
  }
  function snapshot({ error = null, writeState = 'NONE', capabilityValidation = 'UNKNOWN', evidenceGaps = [] } = {}) {
    const failureStage = error?.diagnostic_stage || stages.findLast?.((stage) => stage.status === 'FAIL')?.name || null;
    return Object.freeze({
      correlation_id: commandId, diagnostic_id: commandId,
      failure_stage: failureStage, failure_stage_label: failureStage ? (STAGE_LABELS[failureStage] || failureStage) : null,
      error_category: error ? errorCategory(error) : null,
      reason_code: typeof error?.code === 'string' ? error.code : null,
      model_id: safeText(provider?.getState?.()?.model_id, 200) || null,
      capability_validation: capabilityValidation,
      business_write_state: writeState,
      control_plane_version: LOCAL_AI_CONTROL_PLANE_VERSION,
      stages: Object.freeze(stages.map(clone)),
      evidence_gaps: Object.freeze(evidenceGaps.map((item) => safeText(item, 160)).filter(Boolean)),
      prompt_text_persisted: false,
    });
  }
  return Object.freeze({ mark, run, snapshot });
}
function safeError(error, request = '', { trace = null, writeState = 'NONE', capabilityValidation = 'UNKNOWN', evidenceGaps = [] } = {}) {
  const reasonCode = typeof error?.code === 'string' ? error.code : 'GLOBAL_COMMAND_FAILED';
  const aiUnavailable = AI_UNAVAILABLE_CODES.has(reasonCode);
  const diagnostic = trace?.snapshot?.({ error, writeState, capabilityValidation, evidenceGaps }) || null;
  const writeUnknown = writeState === 'UNKNOWN';
  return Object.freeze({
    ok: false, code: aiUnavailable ? 'LOCAL_AI_UNAVAILABLE' : reasonCode,
    ...(aiUnavailable ? { reason_code: reasonCode } : {}),
    message: writeUnknown ? '命令响应中断，执行结果待确认。请先查看诊断，避免重复操作。'
      : aiUnavailable ? '本地 AI 暂不可用，请稍后重试。' : '全局命令未完成，未执行任何未经确认的写操作。',
    failed_stage: diagnostic?.failure_stage_label || '尚未定位',
    suggested_action: writeUnknown ? '先核实业务记录，再决定是否重试。' : '查看技术详情后重试；若持续失败，请复制脱敏诊断报告。',
    diagnostic_id: diagnostic?.diagnostic_id || null,
    diagnostic,
    retained_request: historyText(request), real_write_count: writeUnknown ? null : 0,
    business_write_state: writeState,
  });
}
function noopAudit() {
  return Object.freeze({ record: async () => undefined, list: () => Object.freeze([]), getState: () => Object.freeze({ local_only: true, persistent: false, status: 'ready' }) });
}
function proposalFromStep(step) {
  const [domain, action] = step.capability.split('.');
  return Object.freeze({
    contract_version: LOCAL_AI_CONTROL_PLANE_VERSION, domain, action,
    intent: step.capability, parameters: step.arguments, confidence: 1,
    requires_confirmation: step.metadata.confirmation_required,
    clarification_question: null, capability: step.metadata,
  });
}

function createNexaGlobalCommandRuntime({
  provider, adapters = {}, clock = () => new Date().toISOString(), timezone = 'Asia/Shanghai',
  historyLimit = GLOBAL_COMMAND_HISTORY_LIMIT, registry = createNexaCommandCapabilityRegistry(),
  auditLog = noopAudit(), runtimeCoordinator = null, monotonicClock = () => Date.now(),
} = {}) {
  if (!provider || typeof provider.generateProposal !== 'function' || typeof provider.getState !== 'function') fail('INVALID_GLOBAL_COMMAND_PROVIDER', 'Shared Local AI Provider is required');
  if (!isPlainObject(adapters) || typeof clock !== 'function' || typeof monotonicClock !== 'function' || !safeText(timezone, 100)) fail('INVALID_GLOBAL_COMMAND_RUNTIME', 'Global Command runtime options are invalid');
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) fail('INVALID_HISTORY_LIMIT', 'historyLimit must be between one and one hundred');
  if (!auditLog || typeof auditLog.record !== 'function') fail('INVALID_COMMAND_AUDIT', 'Command audit log is invalid');
  const proposals = new Map(); const diagnostics = new Map(); const history = []; let sequence = 0;

  function capabilityContext(inputContext) {
    const normalized = normalizeGlobalCommandContext(inputContext);
    return Object.freeze({
      ...normalized, CURRENT_DATETIME: normalized.CURRENT_DATETIME || clock(), TIMEZONE: normalized.TIMEZONE || timezone,
      AVAILABLE_CAPABILITIES: Object.freeze(registry.list()
        .filter((item) => item.availability === 'available')
        .map((item) => `${item.domain}.${item.action}`)),
    });
  }
  async function route(input, trace = null) {
    const validated = await (trace?.run?.('INPUT_VALIDATION', async () => {
      if (!isPlainObject(input)) fail('INVALID_GLOBAL_COMMAND_INPUT', 'Global Command input must be an object');
      const request = safeText(input.request); if (!request) fail('INVALID_GLOBAL_COMMAND_INPUT', 'A bounded non-empty request is required');
      return { request, context: capabilityContext(input.context) };
    }) || Promise.resolve().then(() => {
      if (!isPlainObject(input)) fail('INVALID_GLOBAL_COMMAND_INPUT', 'Global Command input must be an object');
      const request = safeText(input.request); if (!request) fail('INVALID_GLOBAL_COMMAND_INPUT', 'A bounded non-empty request is required');
      return { request, context: capabilityContext(input.context) };
    }));
    const { request, context } = validated;
    const deterministic = await (trace?.run?.('MODEL_AND_CAPABILITY_SELECTION', async () => resolveDeterministicGlobalCommand(request, registry), { source: 'deterministic_registry' }) || Promise.resolve(resolveDeterministicGlobalCommand(request, registry)));
    if (deterministic) {
      trace?.mark?.('PROVIDER_QUEUE', 'NOT_REQUIRED', { source: 'deterministic_fast_path' });
      trace?.mark?.('LOCAL_AI_REQUEST', 'NOT_REQUIRED', { source: 'deterministic_fast_path' });
      trace?.mark?.('RESPONSE_RECEIVED', 'NOT_REQUIRED', { source: 'deterministic_fast_path' });
      trace?.mark?.('SCHEMA_VALIDATION', 'PASS', { source: 'registered_deterministic_contract' });
      return Object.freeze({ request, context, proposal: deterministic, plan: null, resolution_source: 'DETERMINISTIC_FAST_PATH' });
    }
    trace?.mark?.('PROVIDER_QUEUE', 'ENTERED', { priority: 'interactive' });
    if (typeof provider.generatePlan === 'function' && input.single_step !== true) {
      const rawPlan = await (trace?.run?.('LOCAL_AI_REQUEST', () => provider.generatePlan({ request, context }), { output_schema: 'nexa-local-ai-plan-v0.1' }) || provider.generatePlan({ request, context }));
      trace?.mark?.('RESPONSE_RECEIVED', 'PASS');
      const plan = await (trace?.run?.('SCHEMA_VALIDATION', async () => normalizeLocalAiPlan(rawPlan, registry)) || Promise.resolve(normalizeLocalAiPlan(rawPlan, registry)));
      return Object.freeze({ request, context, proposal: null, plan, resolution_source: 'SHARED_LOCAL_AI_PLANNER' });
    }
    const raw = await (trace?.run?.('LOCAL_AI_REQUEST', () => provider.generateProposal({ request, context, output_schema: 'nexa-global-command-v0.1' }), { output_schema: 'nexa-global-command-v0.1' }) || provider.generateProposal({ request, context, output_schema: 'nexa-global-command-v0.1' }));
    trace?.mark?.('RESPONSE_RECEIVED', 'PASS');
    const proposal = await (trace?.run?.('SCHEMA_VALIDATION', async () => normalizeGlobalCommandProposal(raw, registry)) || Promise.resolve(normalizeGlobalCommandProposal(raw, registry)));
    return Object.freeze({ request, context, proposal, plan: null, resolution_source: 'SHARED_LOCAL_AI' });
  }
  function addHistory(record, status) {
    history.unshift(Object.freeze({
      command_id: record.proposal_id, command_text: historyText(record.request),
      domain: record.proposal?.domain || 'multi_step', action: record.proposal?.action || 'plan',
      capabilities_used: record.plan?.steps?.map((step) => step.capability) || [`${record.proposal.domain}.${record.proposal.action}`],
      execution_status: status, origin_device: record.origin_device, timestamp: clock(),
    }));
    history.splice(historyLimit);
  }
  async function audit(record, status, extra = {}) {
    await auditLog.record({
      command_id: record.proposal_id, origin_device: record.origin_device, text: historyText(record.request),
      domain: record.proposal?.domain || 'multi_step', plan: record.plan, capabilities_used: record.plan?.steps?.map((step) => step.capability) || (record.proposal ? [`${record.proposal.domain}.${record.proposal.action}`] : []),
      proposal: record.proposal, confirmation: extra.confirmation || null, result: extra.result || null,
      diagnostic: extra.diagnostic || null,
      status, timestamp: clock(),
    });
  }
  function adapterFor(proposal) { return adapters[proposal.domain]; }
  async function executeRead(record, proposal = record.proposal) {
    if (proposal.domain === 'clarify') return Object.freeze({ type: 'clarification', question: proposal.clarification_question });
    if (proposal.domain === 'navigation' || (proposal.domain === 'settings' && proposal.action === 'open')) {
      const requestedRoute = proposal.parameters.route_id || (proposal.domain === 'settings' ? 'settings' : null);
      const routeId = ROUTE_ALIASES[requestedRoute] || requestedRoute;
      if (!NAVIGATION_ROUTE_IDS.includes(routeId)) fail('INVALID_NAVIGATION_TARGET', 'Navigation target is not a registered NEXA route');
      return Object.freeze({ type: 'navigation', route_id: routeId });
    }
    if (proposal.domain === 'safe_refresh') return Object.freeze({ type: 'refresh', route_id: proposal.parameters.route_id || record.context.CURRENT_MODULE || 'home' });
    if (!proposal.capability.available) return Object.freeze({ type: 'unavailable', code: 'CAPABILITY_UNAVAILABLE', adapter: proposal.capability.adapter_identity, reason: proposal.capability.unavailable_reason });
    const adapter = adapterFor(proposal);
    if (!adapter || typeof adapter.read !== 'function') return Object.freeze({ type: 'unavailable', code: 'COMMAND_ADAPTER_UNAVAILABLE', adapter: proposal.capability.adapter_identity });
    return Object.freeze({ type: 'result', value: clone(await adapter.read(proposal, record)) });
  }
  async function prepareWrite(record, proposal = record.proposal) {
    if (!proposal.capability.available) return Object.freeze({ type: 'unavailable', code: 'CAPABILITY_UNAVAILABLE', adapter: proposal.capability.adapter_identity, reason: proposal.capability.unavailable_reason });
    const adapter = adapterFor(proposal);
    let adapterProposal = null;
    if (adapter && typeof adapter.propose === 'function') adapterProposal = clone(await adapter.propose(proposal, record));
    return Object.freeze({ type: 'proposal', value: clone(adapterProposal || proposal), adapterProposal });
  }
  async function executePlan(record) {
    if (record.plan.clarification_question) return Object.freeze({ type: 'clarification', question: record.plan.clarification_question });
    const results = [];
    for (const step of record.plan.steps) {
      const proposal = proposalFromStep(step);
      const stepRecord = { ...record, proposal, dependencyResults: step.depends_on.map((index) => results[index]?.outcome) };
      const outcome = proposal.requires_confirmation ? await prepareWrite(stepRecord, proposal) : await executeRead(stepRecord, proposal);
      results.push(Object.freeze({ index: step.index, capability: step.capability, depends_on: step.depends_on, outcome }));
    }
    record.planResults = results;
    if (record.plan.requires_confirmation) {
      return Object.freeze({ type: 'plan_preview', intent: record.plan.intent, confirmation_summary: record.plan.confirmation_summary, steps: clone(results) });
    }
    return Object.freeze({ type: 'plan_result', intent: record.plan.intent, steps: clone(results) });
  }
  async function submit(input) {
    const proposalId = `global-command:${Date.parse(clock()) || 0}:${sequence += 1}`;
    const trace = createCommandTrace({ commandId: proposalId, clock, monotonicClock, provider });
    trace.mark('IPC_RECEIVED', 'PASS', { origin: safeText(input?.origin_device, 100) || 'desktop' });
    let record = { proposal_id: proposalId, request: safeText(input?.request), origin_device: safeText(input?.origin_device, 100) || 'desktop', context: {}, proposal: null, plan: null, resolution_source: null, adapterProposal: null, planResults: null, status: 'routing' };
    try {
      const routed = await route(input, trace);
      record = { ...record, request: routed.request, context: routed.context, proposal: routed.proposal, plan: routed.plan, resolution_source: routed.resolution_source, status: 'routed' };
      proposals.set(proposalId, record); while (proposals.size > historyLimit) proposals.delete(proposals.keys().next().value);
      trace.mark('CAPABILITY_ROUTE', 'PASS', { domain: record.proposal?.domain || 'multi_step' });
      const outcome = await trace.run('BUSINESS_EXECUTION', async () => {
        if (record.plan) return executePlan(record);
        if (record.proposal.requires_confirmation) {
          const prepared = await prepareWrite(record);
          record.adapterProposal = prepared.adapterProposal || null;
          return prepared;
        }
        return executeRead(record);
      }, { write_authorized: false });
      record.status = ['proposal', 'plan_preview'].includes(outcome.type) ? 'pending_confirmation' : 'completed';
      trace.mark('PROPOSAL_PREVIEW', record.status === 'pending_confirmation' ? 'PASS' : 'NOT_REQUIRED');
      trace.mark('BUSINESS_PERSISTENCE', 'NOT_REQUIRED', { real_write_count: 0 });
      trace.mark('UI_FEEDBACK', 'PENDING');
      const diagnostic = trace.snapshot({ writeState: 'NONE', capabilityValidation: 'PASS' });
      diagnostics.set(proposalId, { trace, record });
      while (diagnostics.size > historyLimit) diagnostics.delete(diagnostics.keys().next().value);
      addHistory(record, record.status); await audit(record, record.status, { result: outcome, diagnostic });
      return Object.freeze({
        ok: true, proposal_id: proposalId, proposal: clone(record.proposal), plan: clone(record.plan),
        resolution_source: record.resolution_source, status: record.status, outcome, real_write_count: 0,
        diagnostic_id: proposalId, diagnostic,
      });
    } catch (error) {
      trace.mark('UI_FEEDBACK', 'PENDING');
      const result = safeError(error, input?.request, { trace, writeState: 'NONE', capabilityValidation: record.status === 'routed' ? 'PASS' : 'UNKNOWN' });
      record.status = 'failed'; diagnostics.set(proposalId, { trace, record });
      while (diagnostics.size > historyLimit) diagnostics.delete(diagnostics.keys().next().value);
      await audit(record, 'failed', { result, diagnostic: result.diagnostic });
      return result;
    }
  }
  async function confirmPlan(record, options) {
    const writes = record.plan.steps.filter((step) => step.metadata.read_write_class === 'WRITE');
    if (writes.some((step) => step.metadata.risk_class === 'HIGH_RISK') && options?.highRiskConfirmed !== true) fail('SECOND_CONFIRMATION_REQUIRED', 'second confirmation required');
    const values = [];
    for (const step of writes) {
      if (!step.metadata.available) fail('CAPABILITY_UNAVAILABLE', step.metadata.unavailable_reason || 'capability unavailable');
      const proposal = proposalFromStep(step); const adapter = adapterFor(proposal);
      if (!adapter || typeof adapter.confirm !== 'function') fail('COMMAND_ADAPTER_UNAVAILABLE', 'adapter missing');
      const prepared = record.planResults?.find((item) => item.index === step.index)?.outcome?.adapterProposal || null;
      values.push(await adapter.confirm(proposal, { ...record, proposal, adapterProposal: prepared }, options));
    }
    return Object.freeze({ type: 'plan_result', values: clone(values) });
  }
  async function confirm(proposalId, options = {}) {
    const record = proposals.get(safeText(proposalId, 200));
    if (!record) return safeError(Object.assign(new Error('proposal missing'), { code: 'PROPOSAL_NOT_FOUND' }));
    if (record.status !== 'pending_confirmation') return safeError(Object.assign(new Error('not pending'), { code: 'PROPOSAL_NOT_PENDING' }));
    if (options?.confirmed !== true) return safeError(Object.assign(new Error('confirmation required'), { code: 'CONFIRMATION_REQUIRED' }));
    const diagnosticEntry = diagnostics.get(record.proposal_id);
    const trace = diagnosticEntry?.trace || createCommandTrace({ commandId: record.proposal_id, clock, monotonicClock, provider });
    let executionStarted = false;
    try {
      const result = await trace.run('BUSINESS_EXECUTION', async () => {
        if (record.plan) { executionStarted = true; return confirmPlan(record, options); }
        if (record.proposal.capability.classification === 'high_risk' && options?.highRiskConfirmed !== true) fail('SECOND_CONFIRMATION_REQUIRED', 'second confirmation required');
        const adapter = adapterFor(record.proposal);
        if (!adapter || typeof adapter.confirm !== 'function') fail('COMMAND_ADAPTER_UNAVAILABLE', 'adapter missing');
        executionStarted = true;
        return adapter.confirm(record.proposal, record, options);
      }, { write_authorized: true });
      trace.mark('BUSINESS_PERSISTENCE', 'PASS', { adapter_acknowledged: true });
      trace.mark('UI_FEEDBACK', 'PENDING');
      const diagnostic = trace.snapshot({ writeState: 'CONFIRMED', capabilityValidation: 'PASS' });
      record.status = 'confirmed'; addHistory(record, 'confirmed'); await audit(record, 'confirmed', { confirmation: { confirmed: true, high_risk_confirmed: options?.highRiskConfirmed === true }, result, diagnostic });
      return Object.freeze({ ok: true, proposal_id: record.proposal_id, status: 'confirmed', value: clone(result), diagnostic_id: record.proposal_id, diagnostic });
    } catch (error) {
      const writeState = executionStarted ? 'UNKNOWN' : 'NONE';
      const result = safeError(error, '', { trace, writeState, capabilityValidation: 'PASS', evidenceGaps: executionStarted ? ['adapter_commit_boundary_not_observable_after_error'] : [] });
      await audit(record, 'confirmation_failed', { confirmation: { confirmed: true }, result, diagnostic: result.diagnostic }); return result;
    }
  }
  async function cancel(proposalId) {
    const record = proposals.get(safeText(proposalId, 200));
    if (!record) return safeError(Object.assign(new Error('proposal missing'), { code: 'PROPOSAL_NOT_FOUND' }));
    if (record.status !== 'pending_confirmation') return safeError(Object.assign(new Error('not pending'), { code: 'PROPOSAL_NOT_PENDING' }));
    record.status = 'cancelled';
    if (!record.plan && record.adapterProposal && adapters[record.proposal.domain]?.cancel) await adapters[record.proposal.domain].cancel(record.proposal, record);
    const trace = diagnostics.get(record.proposal_id)?.trace || createCommandTrace({ commandId: record.proposal_id, clock, monotonicClock, provider });
    trace.mark('BUSINESS_EXECUTION', 'CANCELLED');
    trace.mark('BUSINESS_PERSISTENCE', 'NOT_REQUIRED', { real_write_count: 0 });
    trace.mark('UI_FEEDBACK', 'PENDING');
    const diagnostic = trace.snapshot({ writeState: 'NONE', capabilityValidation: 'PASS' });
    addHistory(record, 'cancelled'); await audit(record, 'cancelled', { confirmation: { confirmed: false }, result: { real_write_count: 0 }, diagnostic });
    return Object.freeze({ ok: true, proposal_id: record.proposal_id, status: 'cancelled', real_write_count: 0, diagnostic_id: record.proposal_id, diagnostic });
  }

  async function reportFeedback(diagnosticId, status = 'rendered') {
    const entry = diagnostics.get(safeText(diagnosticId, 200));
    if (!entry) return Object.freeze({ ok: false, code: 'DIAGNOSTIC_NOT_FOUND' });
    if (!['rendered', 'render_failed'].includes(status)) return Object.freeze({ ok: false, code: 'DIAGNOSTIC_FEEDBACK_INVALID' });
    const normalized = status === 'render_failed' ? 'FAIL' : 'PASS';
    entry.trace.mark('UI_FEEDBACK', normalized, { renderer_status: normalized === 'PASS' ? 'rendered' : 'render_failed' });
    const error = normalized === 'FAIL' ? Object.assign(new Error('render failed'), { code: 'RENDER_FAILED', diagnostic_stage: 'UI_FEEDBACK' }) : null;
    const diagnostic = entry.trace.snapshot({ error, writeState: entry.record.status === 'confirmed' ? 'CONFIRMED' : 'NONE', capabilityValidation: 'PASS' });
    await audit(entry.record, normalized === 'FAIL' ? 'render_failed' : 'ui_feedback', { result: { renderer_status: status }, diagnostic });
    return Object.freeze({ ok: true, diagnostic_id: diagnosticId, status });
  }

  return Object.freeze({
    route, submit, confirm, cancel, reportFeedback,
    listModels(options) {
      if (typeof provider.listModels !== 'function') return Object.freeze([]);
      return provider.listModels(options);
    },
    selectModel(modelId) {
      if (typeof provider.selectModel !== 'function') fail('AI_MODEL_SELECTION_UNAVAILABLE', 'Model selection is unavailable');
      return provider.selectModel(modelId);
    },
    getState() {
      return Object.freeze({
        provider: clone(provider.getState()), runtime_coordinator: clone(runtimeCoordinator?.getState?.() || null),
        audit: clone(auditLog.getState?.() || null), control_plane_version: LOCAL_AI_CONTROL_PLANE_VERSION,
        contract_version: '0.1.0', domains: Object.freeze(registry.listDomains()), capability_count: registry.list().length,
        planner: Object.freeze({ enabled: typeof provider.generatePlan === 'function', max_steps: 6 }),
      });
    },
    getCapabilities() { return Object.freeze(registry.list()); },
    listHistory() { return Object.freeze(history.map(clone)); },
    clearHistory() { history.splice(0); return Object.freeze({ ok: true, remaining: 0 }); },
  });
}

module.exports = { createNexaGlobalCommandRuntime, historyText, proposalFromStep, safeError };
