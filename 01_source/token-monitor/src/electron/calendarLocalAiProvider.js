'use strict';

const {
  calendarLocalAiReadiness,
  joinLocalEndpoint,
  normalizeCalendarLocalAiConfiguration
} = require('../shared/calendarLocalAiConfig');
const { GLOBAL_COMMAND_SCHEMA, LOCAL_AI_PLAN_SCHEMA } = require('../shared/nexaGlobalCommandContract');

const MAX_RESPONSE_CHARS = 1_000_000;
const DEFAULT_RECOVERY_INTERVAL_MS = 15_000;

const AI_RUNTIME_STATES = Object.freeze({
  DISABLED: 'AI_DISABLED',
  STARTING: 'AI_STARTING',
  READY: 'AI_READY',
  MODEL_NOT_LOADED: 'AI_MODEL_NOT_LOADED',
  SERVER_UNAVAILABLE: 'AI_SERVER_UNAVAILABLE',
  TIMEOUT: 'AI_TIMEOUT',
  INVALID_RESPONSE: 'AI_INVALID_RESPONSE',
  ERROR: 'AI_ERROR',
});

const CALENDAR_PROPOSAL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'operations', 'conflicts', 'clarification'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 1000 },
    operations: {
      type: 'array', minItems: 0, maxItems: 25,
      items: {
        type: 'object', additionalProperties: false,
        required: ['command_type', 'payload', 'change_summary'],
        properties: {
          operation_id: { type: 'string' },
          command_type: { type: 'string' },
          payload: { type: 'object' },
          change_summary: { type: 'string' },
          before: { type: ['object', 'null'] },
          after: { type: ['object', 'null'] },
          conflicts: { type: 'array', items: { type: 'string' } },
          needs_confirmation: { type: 'boolean' }
        }
      }
    },
    conflicts: { type: 'array', items: { type: 'string' } },
    clarification: { type: ['string', 'null'] }
  }
});

const HEALTH_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['status'], properties: { status: { type: 'string', enum: ['ok'] } }
});

const EXPENSE_SUGGESTION_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['suggested_category', 'suggested_display_name', 'tags', 'confidence', 'reason'],
  properties: {
    suggested_category: { type: 'string' },
    suggested_display_name: { type: 'string' },
    tags: { type: 'array', maxItems: 8, items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string' }
  }
});

const EXPENSE_FILTER_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['startDate', 'endDate', 'category', 'merchant', 'platform', 'direction'],
  properties: {
    startDate: { type: ['string', 'null'] }, endDate: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] }, merchant: { type: ['string', 'null'] },
    platform: { type: ['string', 'null'] }, direction: { type: ['string', 'null'], enum: ['expense', 'income', null] }
  }
});

const NOTIFICATION_CLASSIFICATION_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['semantic_category', 'confidence'],
  properties: {
    semantic_category: {
      type: 'string',
      enum: ['consumption', 'income', 'refund', 'transfer', 'order', 'logistics', 'chat', 'platform_alert', 'system', 'learning', 'finance', 'other']
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 }
  }
});

function schemaForInput(input) {
  if (input?.output_schema === 'nexa-local-ai-health-v0.1') return { name: 'nexa_local_ai_health_v0_1', schema: HEALTH_SCHEMA };
  if (input?.output_schema === 'nexa-global-command-v0.1') return { name: 'nexa_global_command_v0_1', schema: GLOBAL_COMMAND_SCHEMA };
  if (input?.output_schema === 'nexa-local-ai-plan-v0.1') return { name: 'nexa_local_ai_plan_v0_1', schema: LOCAL_AI_PLAN_SCHEMA };
  if (input?.output_schema === 'expense-ai-suggestion-v0.1') return { name: 'expense_ai_suggestion_v0_1', schema: EXPENSE_SUGGESTION_SCHEMA };
  if (input?.output_schema === 'expense-query-filter-v0.1') return { name: 'expense_query_filter_v0_1', schema: EXPENSE_FILTER_SCHEMA };
  if (input?.output_schema === 'nexa-notification-classification-v0.1') return { name: 'nexa_notification_classification_v0_1', schema: NOTIFICATION_CLASSIFICATION_SCHEMA };
  return { name: 'calendar_ai_proposal_v0_1', schema: CALENDAR_PROPOSAL_SCHEMA };
}

function providerError(code) {
  return Object.assign(new Error('Shared local AI provider request failed'), { code });
}

function safeJsonParse(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RESPONSE_CHARS) {
    throw providerError('INVALID_RESPONSE');
  }
  try { return JSON.parse(value); } catch (_) { throw providerError('INVALID_RESPONSE'); }
}

function modelRecordsFromPayload(payload) {
  const source = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  return Object.freeze(source.map((item) => {
    const id = String(item?.id || item?.name || item?.model || '').trim().slice(0, 200);
    const displayName = String(item?.display_name || item?.name || id).trim().slice(0, 200);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return Object.freeze({ id, display_name: displayName || id, service_listed: true });
  }).filter(Boolean));
}

function proposalFromResponse(protocol, payload) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.operations)) return payload;
  const content = protocol === 'openai-chat'
    ? payload?.choices?.[0]?.message?.content
    : payload?.message?.content ?? payload?.response;
  if (content && typeof content === 'object') return content;
  return safeJsonParse(content);
}

function enforceCalendarProposalSafety(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.operations)) return value;
  const clarification = typeof value.clarification === 'string' ? value.clarification.trim() : '';
  if (!clarification || value.operations.length === 0) return value;
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts.filter(Boolean) : [];
  if (conflicts.length > 0) return { ...value, clarification: null };
  return { ...value, operations: [] };
}

function requestMessages(input) {
  if (input?.output_schema === 'nexa-local-ai-health-v0.1') {
    return [
      { role: 'system', content: 'Return only the JSON object required by the response schema.' },
      { role: 'user', content: 'Return status ok.' }
    ];
  }
  if (input?.output_schema === 'expense-ai-suggestion-v0.1') {
    return [
      { role: 'system', content: 'Suggest only category, merchant display name, tags, confidence, and reason. Never alter amount, currency, timestamp, platform, order id, or source evidence. Return only schema JSON.' },
      { role: 'user', content: JSON.stringify({ record: input.context }) }
    ];
  }
  if (input?.output_schema === 'expense-query-filter-v0.1') {
    return [
      { role: 'system', content: 'Convert the request to the exact expense filter schema. Use null for unspecified fields. Return only schema JSON.' },
      { role: 'user', content: JSON.stringify({ request: input.request, current_date: input.context?.current_date, timezone: input.context?.timezone }) }
    ];
  }
  if (input?.output_schema === 'nexa-global-command-v0.1') {
    return [
      {
        role: 'system',
        content: [
          'Map the explicit user request to exactly one registered NEXA command and return only schema JSON.',
          'Never invent an action, identifier, amount, current date, selected object, file, credential, shell command, or system API.',
          'Explicit user wording outranks relative time, selected object/date/module, and defaults in that order.',
          'CURRENT_MODULE is context only and must never constrain an explicit cross-module request.',
          'For navigation.open use one route_id from: home, cost, calendar, automation-center, study-center, device-center, market, creator-ops, dashi, starbench, settings.',
          'Use domain clarify and action ask with a concrete clarification_question when required time or target details are ambiguous.',
          'Do not execute anything and do not claim a command succeeded.',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify({ request: input.request, context: input.context }) },
    ];
  }
  if (input?.output_schema === 'nexa-local-ai-plan-v0.1') {
    return [
      {
        role: 'system',
        content: [
          'Create a bounded NEXA capability plan and return only schema JSON.',
          'Use one to six steps. Each dependency index must reference an earlier step.',
          'Use only a capability listed in context.AVAILABLE_CAPABILITIES and never invent identifiers or data.',
          'The capability field must be exactly one listed identity such as calendar.create, with no metadata suffix.',
          'READ steps may execute directly. Any WRITE or HIGH_RISK step must remain a proposal requiring confirmation.',
          'When the user explicitly asks to create, arrange, update, run, enable, or disable something, select the matching WRITE capability; do not downgrade the request to a READ-only plan.',
          'For an explicit calendar meeting with a date and time, use calendar.create. For a conditional study arrangement, first use calendar.query_range, then calendar.find_free_slots, then learning.create_plan with dependencies.',
          'For a broad request about what happened today across NEXA, use global_query.search rather than a single module read.',
          'Broad periods such as morning, afternoon, and evening are valid bounded windows for a free-slot query; do not ask for an exact time when a duration is already given.',
          'If clarification_question is not null, include no WRITE steps and use clarify.ask.',
          'Ask one concrete clarification question when a required target, date, time, or content is missing.',
          'Never include credentials, shell commands, network-setting changes, payment, publishing, or file deletion.',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify({ request: input.request, context: input.context }) },
    ];
  }
  if (input?.output_schema === 'nexa-notification-classification-v0.1') {
    return [
      { role: 'system', content: 'Classify notification content into the exact schema category. The app identity is deterministic context and must not be changed. Never extract or reproduce credentials, codes, amounts, timestamps, or other fields. Return schema JSON only.' },
      { role: 'user', content: JSON.stringify({ context: input.context }) }
    ];
  }
  const system = [
    'Return one JSON object for calendar-ai-proposal-v0.1.',
    'The object must contain summary and operations.',
    'Each operation must contain command_type, payload, change_summary, optional before, after, and conflicts.',
    'Allowed command types are task.create, task.update, task.complete, task.delete, task.get, task.list, calendar.create, calendar.update, calendar.complete, calendar.delete, calendar.get, calendar.list, and planning commands.',
    'For ambiguous requests, clarification must be a non-empty question and operations MUST be empty. Otherwise clarification must be null.',
    'For update/delete, use only an event id present in context; never invent a target event id.',
    'Never claim that an operation was executed. Never include secrets or prose outside JSON.'
  ].join(' ');
  return [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify({ request: input.request, context: input.context, output_schema: input.output_schema }) }
  ];
}

function requestBody(configuration, input) {
  const messages = requestMessages(input);
  if (configuration.protocol === 'openai-chat') {
    return {
      model: configuration.modelId,
      messages,
      stream: false,
      temperature: 0,
      max_tokens: input?.output_schema === 'nexa-local-ai-health-v0.1' ? 24
        : input?.output_schema === 'nexa-local-ai-plan-v0.1' ? 800
          : input?.output_schema === 'nexa-global-command-v0.1' ? 600
          : input?.output_schema === 'nexa-notification-classification-v0.1' ? 80
            : input?.output_schema?.startsWith('expense-') ? 320 : 900,
      ...(configuration.structuredJsonCapability === 'native' ? { response_format: { type: 'json_object' } } : {}),
      ...(configuration.structuredJsonCapability === 'json-schema' ? {
        response_format: { type: 'json_schema', json_schema: { ...schemaForInput(input), strict: true } }
      } : {})
    };
  }
  if (configuration.protocol === 'ollama-chat') {
    return {
      model: configuration.modelId,
      messages,
      stream: false,
      ...(configuration.structuredJsonCapability === 'native' ? { format: 'json' } : {})
    };
  }
  throw providerError('AI_PROTOCOL_UNSUPPORTED');
}

function runtimeState(readiness, healthStatus, failureCode) {
  if (readiness.status === 'disabled') return AI_RUNTIME_STATES.DISABLED;
  if (!readiness.canGenerate) return AI_RUNTIME_STATES.ERROR;
  if (healthStatus === 'available') return AI_RUNTIME_STATES.READY;
  if (healthStatus === 'checking' || healthStatus === 'not_checked') return AI_RUNTIME_STATES.STARTING;
  if (failureCode === 'MODEL_NOT_LOADED' || failureCode === 'MODEL_ID_MISMATCH') return AI_RUNTIME_STATES.MODEL_NOT_LOADED;
  if (failureCode === 'SERVER_NOT_RUNNING') return AI_RUNTIME_STATES.SERVER_UNAVAILABLE;
  if (failureCode === 'TIMEOUT' || failureCode === 'AI_QUEUE_TIMEOUT') return AI_RUNTIME_STATES.TIMEOUT;
  if (['INVALID_RESPONSE', 'STRUCTURED_OUTPUT_UNAVAILABLE', 'AI_PROVIDER_REJECTED', 'AI_RESPONSE_TOO_LARGE'].includes(failureCode)) {
    return AI_RUNTIME_STATES.INVALID_RESPONSE;
  }
  return AI_RUNTIME_STATES.ERROR;
}

function publicState(readiness, healthStatus, lastHealthAt, failureCode, revision) {
  const runtime = runtimeState(readiness, healthStatus, failureCode);
  const status = readiness.status === 'disabled' ? 'disabled'
    : readiness.canGenerate ? (healthStatus === 'failed' ? 'error' : 'ready')
      : 'unconfigured';
  return Object.freeze({
    status,
    runtime_state: runtime,
    product_status: runtime === AI_RUNTIME_STATES.READY ? '就绪'
      : runtime === AI_RUNTIME_STATES.STARTING ? '启动中' : '暂不可用',
    diagnostic_code: failureCode,
    revision,
    configured: readiness.configured,
    model_id: readiness.configuration.modelId || null,
    configuration_readiness: readiness.status,
    health_status: readiness.canHealthCheck ? healthStatus : 'not_available',
    last_health_at: lastHealthAt,
    can_propose: readiness.canGenerate && healthStatus !== 'failed'
  });
}

function createCalendarLocalAiProviderRuntime({
  getConfiguration,
  updateConfiguration,
  fetchImpl,
  resolveCredential = () => '',
  clock = () => new Date().toISOString(),
  recoveryIntervalMs = DEFAULT_RECOVERY_INTERVAL_MS,
  modelListTimeoutMs = 5_000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  if (typeof getConfiguration !== 'function') throw new TypeError('getConfiguration must be a function');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof resolveCredential !== 'function') throw new TypeError('resolveCredential must be a function');
  if (!Number.isInteger(recoveryIntervalMs) || recoveryIntervalMs < 1_000) throw new TypeError('recoveryIntervalMs must be at least 1000');
  if (!Number.isInteger(modelListTimeoutMs) || modelListTimeoutMs < 1) throw new TypeError('modelListTimeoutMs must be a positive integer');
  let active = 0;
  let healthStatus = 'not_checked';
  let lastHealthAt = null;
  let lastFailureCode = null;
  let stateRevision = 0;
  let configurationSignature = '';
  let lastDiagnostics = null;
  let recoveryTimer = null;
  let healthCheckPromise = null;
  let healthCheckMode = null;
  let lastModels = Object.freeze([]);
  const capacityWaiters = [];
  let capacityWaiterSequence = 0;

  function capacityPriority(value) {
    return value === 'background' ? 2 : value === 'maintenance' ? 1 : 0;
  }

  function removeCapacityWaiter(waiter) {
    const index = capacityWaiters.indexOf(waiter);
    if (index >= 0) capacityWaiters.splice(index, 1);
  }

  function dispatchCapacityWaiters() {
    while (capacityWaiters.length > 0) {
      const waiter = capacityWaiters[0];
      if (active >= waiter.maxConcurrency) return;
      capacityWaiters.shift();
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener?.('abort', waiter.abort);
      active += 1;
      waiter.resolve();
    }
  }

  function acquireCapacity(configuration, signal, priority = 'interactive') {
    if (signal?.aborted) return Promise.reject(providerError('AI_CANCELLED'));
    if (active < configuration.maxConcurrency && capacityWaiters.length === 0) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        maxConcurrency: configuration.maxConcurrency,
        priority: capacityPriority(priority),
        sequence: capacityWaiterSequence += 1,
        signal,
        resolve,
        reject,
        timer: null,
        abort: null,
      };
      const fail = (code) => {
        removeCapacityWaiter(waiter);
        clearTimeout(waiter.timer);
        signal?.removeEventListener?.('abort', waiter.abort);
        reject(providerError(code));
      };
      waiter.abort = () => fail('AI_CANCELLED');
      waiter.timer = setTimeout(
        () => fail('AI_QUEUE_TIMEOUT'),
        configuration.timeoutMs
      );
      waiter.timer?.unref?.();
      signal?.addEventListener?.('abort', waiter.abort, { once: true });
      const insertAt = capacityWaiters.findIndex((queued) =>
        queued.priority > waiter.priority ||
        (queued.priority === waiter.priority && queued.sequence > waiter.sequence));
      if (insertAt < 0) capacityWaiters.push(waiter);
      else capacityWaiters.splice(insertAt, 0, waiter);
      dispatchCapacityWaiters();
    });
  }

  function releaseCapacity() {
    active = Math.max(0, active - 1);
    dispatchCapacityWaiters();
  }

  function stopRecovery() {
    if (recoveryTimer !== null) clearIntervalFn(recoveryTimer);
    recoveryTimer = null;
  }

  function scheduleRecovery() {
    if (recoveryTimer !== null) return;
    recoveryTimer = setIntervalFn(() => healthCheck({ full: true, deep: false }), recoveryIntervalMs);
    recoveryTimer?.unref?.();
  }

  function updateHealth(status, failureCode = null, diagnostics = lastDiagnostics) {
    const changed = healthStatus !== status || lastFailureCode !== failureCode || lastDiagnostics !== diagnostics;
    healthStatus = status;
    lastFailureCode = failureCode;
    lastDiagnostics = diagnostics;
    if (changed) stateRevision += 1;
  }

  function current() {
    const readiness = calendarLocalAiReadiness(getConfiguration());
    const signature = JSON.stringify(readiness.configuration);
    if (signature !== configurationSignature) {
      configurationSignature = signature;
      lastModels = Object.freeze([]);
      updateHealth('not_checked', null, null);
      lastHealthAt = null;
      stopRecovery();
    }
    return readiness;
  }

  function getState() {
    const readiness = current();
    const selectedModelId = readiness.configuration.modelId || null;
    const selectedCapabilities = Object.freeze({
      ordinary_chat: lastDiagnostics?.model_loaded === true ? 'available' : 'unverified',
      structured_command: lastDiagnostics?.global_command_readiness === 'PASS' ? 'available' : 'unverified',
      tool_calling: 'unverified',
      vision: 'unverified'
    });
    return Object.freeze({
      ...publicState(readiness, healthStatus, lastHealthAt, lastFailureCode, stateRevision),
      diagnostics: lastDiagnostics,
      models: Object.freeze(lastModels.map((model) => Object.freeze({
        ...model,
        selected: model.id === selectedModelId,
        loaded: model.id === selectedModelId && lastDiagnostics?.model_loaded === true ? true : null,
        capabilities: model.id === selectedModelId ? selectedCapabilities : Object.freeze({
          ordinary_chat: 'unverified', structured_command: 'unverified', tool_calling: 'unverified', vision: 'unverified'
        })
      })))
    });
  }

  function authorizationHeaders(configuration) {
    if (configuration.authorizationMode === 'none') return {};
    const credential = resolveCredential(configuration.credentialReference);
    if (typeof credential !== 'string' || credential.length === 0) throw providerError('AI_CREDENTIAL_UNAVAILABLE');
    return { authorization: `Bearer ${credential}` };
  }

  async function boundedFetch(url, options, timeoutMs, externalSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    } catch (_) {
      throw providerError(controller.signal.aborted ? 'TIMEOUT' : 'SERVER_NOT_RUNNING');
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener?.('abort', abort);
    }
  }

  async function boundedResponseText(response, timeoutMs) {
    let timer = null;
    try {
      return await Promise.race([
        response.text(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(providerError('TIMEOUT')), timeoutMs);
        })
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function performHealthCheck({ full = true, deep = true } = {}) {
    const readiness = current();
    if (!readiness.canHealthCheck) return Object.freeze({ ok: false, code: 'AI_CONFIGURATION_INCOMPLETE', state: getState() });
    updateHealth('checking', null);
    const started = Date.now();
    let capacityAcquired = false;
    try {
      const configuration = readiness.configuration;
      const response = await boundedFetch(
        joinLocalEndpoint(configuration.baseUrl, configuration.healthCheckEndpoint),
        { method: 'GET', headers: { accept: 'application/json' } },
        configuration.timeoutMs
      );
      if (!response?.ok) throw providerError('INVALID_RESPONSE');
      const modelsPayload = safeJsonParse(await response.text());
      lastModels = modelRecordsFromPayload(modelsPayload);
      const modelIds = lastModels.map((item) => item.id);
      if (modelIds.length === 0) throw providerError('MODEL_NOT_LOADED');
      if (!modelIds.includes(configuration.modelId)) throw providerError('MODEL_ID_MISMATCH');
      let schemaValidated = lastDiagnostics?.calendar_readiness === 'PASS';
      let expenseSchemaValidated = lastDiagnostics?.expense_readiness === 'PASS';
      let globalCommandSchemaValidated = lastDiagnostics?.global_command_readiness === 'PASS';
      if (full && configuration.protocol === 'openai-chat' && configuration.structuredJsonCapability === 'json-schema') {
        await acquireCapacity(configuration, null, 'maintenance');
        capacityAcquired = true;
        schemaValidated = false;
        expenseSchemaValidated = false;
        globalCommandSchemaValidated = false;
        const generation = await boundedFetch(
          joinLocalEndpoint(configuration.baseUrl, configuration.generationEndpoint),
          {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json', ...authorizationHeaders(configuration) },
            body: JSON.stringify(requestBody(configuration, { output_schema: 'nexa-local-ai-health-v0.1' }))
          },
          configuration.timeoutMs
        );
        if (!generation?.ok) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
        const generated = proposalFromResponse(configuration.protocol, safeJsonParse(await generation.text()));
        schemaValidated = generated?.status === 'ok';
        if (!schemaValidated) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
        if (deep) {
          const expenseGeneration = await boundedFetch(
            joinLocalEndpoint(configuration.baseUrl, configuration.generationEndpoint),
            {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json', ...authorizationHeaders(configuration) },
              body: JSON.stringify(requestBody(configuration, {
                output_schema: 'expense-ai-suggestion-v0.1',
                context: { merchant: 'fixture merchant', category: 'other' }
              }))
            },
            configuration.timeoutMs
          );
          if (!expenseGeneration?.ok) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
          const expenseGenerated = proposalFromResponse(configuration.protocol, safeJsonParse(await expenseGeneration.text()));
          expenseSchemaValidated = typeof expenseGenerated?.suggested_category === 'string' &&
            typeof expenseGenerated?.suggested_display_name === 'string' && Array.isArray(expenseGenerated?.tags) &&
            Number.isFinite(expenseGenerated?.confidence) && typeof expenseGenerated?.reason === 'string';
          if (!expenseSchemaValidated) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
          const globalGeneration = await boundedFetch(
            joinLocalEndpoint(configuration.baseUrl, configuration.generationEndpoint),
            {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json', ...authorizationHeaders(configuration) },
              body: JSON.stringify(requestBody(configuration, {
                output_schema: 'nexa-global-command-v0.1',
                request: '打开设备与网络',
                context: {
                  CURRENT_DATETIME: '2026-09-05T09:30:00+08:00', TIMEZONE: 'Asia/Shanghai',
                  CURRENT_MODULE: 'home', SELECTED_OBJECT: '', SELECTED_DATE: '',
                  AVAILABLE_CAPABILITIES: ['navigation.open:read:available']
                }
              }))
            },
            configuration.timeoutMs
          );
          if (!globalGeneration?.ok) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
          const globalGenerated = proposalFromResponse(configuration.protocol, safeJsonParse(await globalGeneration.text()));
          globalCommandSchemaValidated = typeof globalGenerated?.domain === 'string' &&
            typeof globalGenerated?.action === 'string' && typeof globalGenerated?.intent === 'string' &&
            globalGenerated?.parameters && typeof globalGenerated.parameters === 'object' &&
            Number.isFinite(globalGenerated?.confidence) && typeof globalGenerated?.requires_confirmation === 'boolean' &&
            (globalGenerated?.clarification_question === null || typeof globalGenerated?.clarification_question === 'string');
          if (!globalCommandSchemaValidated) throw providerError('STRUCTURED_OUTPUT_UNAVAILABLE');
        } else {
          expenseSchemaValidated = schemaValidated;
          globalCommandSchemaValidated = schemaValidated;
        }
      }
      lastHealthAt = clock();
      const latencyMs = Math.max(0, Date.now() - started);
      lastDiagnostics = Object.freeze({
        runtime: configuration.providerId,
        service_status: 'RUNNING',
        model_id: configuration.modelId,
        model_listed: true,
        model_loaded: full ? true : null,
        localhost_only: /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/iu.test(configuration.baseUrl),
        structured_output: configuration.structuredJsonCapability,
        schema_validated: schemaValidated && expenseSchemaValidated && globalCommandSchemaValidated,
        calendar_readiness: schemaValidated ? 'PASS' : 'FAIL',
        expense_readiness: expenseSchemaValidated ? 'PASS' : 'FAIL',
        global_command_readiness: globalCommandSchemaValidated ? 'PASS' : 'FAIL',
        response_latency_ms: latencyMs,
        probe_mode: !full ? 'MODEL_PRESENCE' : deep ? 'DEEP_SCHEMA' : 'STRICT_JSON_MINIMUM'
      });
      updateHealth('available', null, lastDiagnostics);
      stopRecovery();
      return Object.freeze({
        ok: true,
        code: 'AI_HEALTHY',
        latencyMs,
        diagnostics: lastDiagnostics,
        state: getState()
      });
    } catch (error) {
      lastHealthAt = clock();
      const failureCode = error?.code || 'INVALID_RESPONSE';
      updateHealth('failed', failureCode, Object.freeze({ code: failureCode }));
      scheduleRecovery();
      return Object.freeze({ ok: false, code: error?.code || 'INVALID_RESPONSE', latencyMs: Math.max(0, Date.now() - started), state: getState() });
    } finally {
      if (capacityAcquired) releaseCapacity();
    }
  }

  function healthCheck(options = {}) {
    const requestedMode = options.full === false ? 'quick' : options.deep === false ? 'full' : 'deep';
    const requestedRank = { quick: 0, full: 1, deep: 2 }[requestedMode];
    if (healthCheckPromise) {
      const activeRank = { quick: 0, full: 1, deep: 2 }[healthCheckMode];
      if (requestedRank <= activeRank) return healthCheckPromise;
      return healthCheckPromise.then(() => healthCheck(options));
    }
    healthCheckMode = requestedMode;
    healthCheckPromise = performHealthCheck({
      full: requestedMode !== 'quick',
      deep: requestedMode === 'deep'
    }).finally(() => {
      healthCheckPromise = null;
      healthCheckMode = null;
    });
    return healthCheckPromise;
  }

  async function listModels({ refresh = true } = {}) {
    const readiness = current();
    if (!readiness.canHealthCheck) throw providerError('AI_CONFIGURATION_INCOMPLETE');
    if (refresh || lastModels.length === 0) {
      const configuration = readiness.configuration;
      const response = await boundedFetch(
        joinLocalEndpoint(configuration.baseUrl, configuration.healthCheckEndpoint),
        { method: 'GET', headers: { accept: 'application/json', ...authorizationHeaders(configuration) } },
        Math.min(configuration.timeoutMs, modelListTimeoutMs)
      );
      if (!response?.ok) throw providerError('AI_PROVIDER_REJECTED');
      lastModels = modelRecordsFromPayload(safeJsonParse(await boundedResponseText(
        response,
        Math.min(configuration.timeoutMs, modelListTimeoutMs)
      )));
      if (lastModels.length === 0) throw providerError('MODEL_NOT_LOADED');
      stateRevision += 1;
    }
    return getState().models;
  }

  async function selectModel(modelId) {
    if (typeof updateConfiguration !== 'function') throw providerError('AI_MODEL_SELECTION_UNAVAILABLE');
    const normalizedModelId = String(modelId || '').trim().slice(0, 200);
    const models = await listModels({ refresh: true });
    if (!models.some((model) => model.id === normalizedModelId)) throw providerError('MODEL_ID_MISMATCH');
    const next = normalizeCalendarLocalAiConfiguration({ ...current().configuration, modelId: normalizedModelId });
    await updateConfiguration(next);
    current();
    await healthCheck({ full: false, deep: false });
    return getState();
  }

  async function generateProposal(input, { signal, priority = 'interactive' } = {}) {
    const readiness = current();
    if (!readiness.canGenerate) throw providerError('AI_CONFIGURATION_INCOMPLETE');
    const configuration = normalizeCalendarLocalAiConfiguration(readiness.configuration);
    const deadline = Date.now() + configuration.timeoutMs;
    await acquireCapacity(configuration, signal, priority);
    try {
      const remainingTimeoutMs = Math.max(1, deadline - Date.now());
      const response = await boundedFetch(
        joinLocalEndpoint(configuration.baseUrl, configuration.generationEndpoint),
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...authorizationHeaders(configuration)
          },
          body: JSON.stringify(requestBody(configuration, input))
        },
        remainingTimeoutMs,
        signal
      );
      if (!response?.ok) throw providerError('AI_PROVIDER_REJECTED');
      const contentLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_CHARS) throw providerError('AI_RESPONSE_TOO_LARGE');
      const payload = safeJsonParse(await response.text());
      lastHealthAt = clock();
      updateHealth('available', null, lastDiagnostics);
      stopRecovery();
      const proposal = proposalFromResponse(configuration.protocol, payload);
      return input?.output_schema === 'calendar-ai-proposal-v0.1'
        ? enforceCalendarProposalSafety(proposal)
        : proposal;
    } catch (error) {
      const failureCode = signal?.aborted ? 'TIMEOUT' : (error?.code || 'SERVER_NOT_RUNNING');
      lastHealthAt = clock();
      updateHealth('failed', failureCode, Object.freeze({ code: failureCode }));
      scheduleRecovery();
      if (signal?.aborted) throw providerError('AI_CANCELLED');
      throw error?.code ? error : providerError('SERVER_NOT_RUNNING');
    } finally {
      releaseCapacity();
    }
  }

  function generatePlan(input, options) {
    return generateProposal({ ...input, output_schema: 'nexa-local-ai-plan-v0.1' }, options);
  }

  return Object.freeze({ generateProposal, generatePlan, getState, healthCheck, listModels, selectModel, stop: stopRecovery });
}

module.exports = {
  CALENDAR_PROPOSAL_SCHEMA,
  EXPENSE_FILTER_SCHEMA,
  EXPENSE_SUGGESTION_SCHEMA,
  NOTIFICATION_CLASSIFICATION_SCHEMA,
  HEALTH_SCHEMA,
  AI_RUNTIME_STATES,
  DEFAULT_RECOVERY_INTERVAL_MS,
  MAX_RESPONSE_CHARS,
  modelRecordsFromPayload,
  createCalendarLocalAiProviderRuntime,
  createSharedLocalAiProviderRuntime: createCalendarLocalAiProviderRuntime,
  enforceCalendarProposalSafety,
  proposalFromResponse,
  requestBody
};
