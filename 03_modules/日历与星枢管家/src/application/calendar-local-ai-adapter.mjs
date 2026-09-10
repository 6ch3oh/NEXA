import { createHash, randomUUID } from 'node:crypto';
import { createCommand, defaultRiskForCommandType, VALID_COMMAND_TYPES } from '../commands/contract.mjs';

export const CALENDAR_LOCAL_AI_CONTRACT_VERSION = '0.1.0';

const STATES = Object.freeze({
  DISABLED: 'disabled',
  UNCONFIGURED: 'unconfigured',
  READY: 'ready',
  ERROR: 'error',
});
const PROPOSAL_STATES = new Set(['draft', 'confirmed', 'cancelled', 'undone']);
const CONTEXT_FIELDS = Object.freeze(['date', 'events', 'tasks', 'timezone']);
const DETERMINISTIC_TIME_CONTEXT_FIELDS = Object.freeze(['current_date', 'current_time']);
const DIFF_FIELDS = Object.freeze([
  'id', 'task_id', 'plan_id', 'title', 'description', 'status', 'priority', 'date', 'due_at',
  'start_at', 'end_at', 'planned_start_at', 'planned_end_at', 'timezone'
]);

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeProviderMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const result = {};
  for (const field of ['provider_id', 'model_id', 'request_id']) {
    if (typeof value[field] === 'string' && value[field].trim()) result[field] = value[field].trim().slice(0, 200);
  }
  return Object.freeze(result);
}

function safeProviderRuntimeState(provider) {
  if (typeof provider?.getState !== 'function') return null;
  let value;
  try { value = provider.getState(); } catch (_) { return Object.freeze({ status: STATES.ERROR }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({ status: STATES.ERROR });
  const status = Object.values(STATES).includes(value.status) ? value.status : STATES.ERROR;
  const result = { status };
  if (typeof value.configured === 'boolean') result.configured = value.configured;
  if (typeof value.can_propose === 'boolean') result.can_propose = value.can_propose;
  for (const field of ['configuration_readiness', 'health_status', 'last_health_at', 'runtime_state', 'product_status', 'diagnostic_code']) {
    if (typeof value[field] === 'string' && value[field].trim()) result[field] = value[field].trim().slice(0, 100);
    else if (field === 'last_health_at' && value[field] === null) result[field] = null;
  }
  return Object.freeze(result);
}

function safeDiffSnapshot(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of DIFF_FIELDS) {
    if (value[field] === null || ['string', 'number', 'boolean'].includes(typeof value[field])) {
      result[field] = typeof value[field] === 'string' ? value[field].slice(0, 500) : value[field];
    }
  }
  return Object.keys(result).length > 0 ? freeze(result) : null;
}

function operationCategory(commandType) {
  if (commandType.endsWith('.get') || commandType.endsWith('.list')) return 'query';
  if (commandType.endsWith('.create')) return 'create';
  if (commandType.endsWith('.delete') || commandType.includes('.remove_') || commandType.includes('.reject_')) return 'delete';
  return 'update';
}

function currentLocalParts(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { current_date: `${parts.year}-${parts.month}-${parts.day}`, current_time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

function minimalContext(value, timezone, instant) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const context = { timezone, ...currentLocalParts(instant, timezone) };
  if (typeof source.date === 'string') context.date = source.date.slice(0, 10);
  for (const field of ['events', 'tasks']) {
    if (!Array.isArray(source[field])) continue;
    context[field] = source[field].slice(0, 100).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const projected = {};
      for (const key of ['id', 'title', 'start_at', 'end_at', 'status']) {
        if (['string', 'number', 'boolean'].includes(typeof item[key])) projected[key] = item[key];
      }
      return projected;
    }).filter(Boolean);
  }
  return freeze(context);
}

function validateOperation(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw publicError('INVALID_AI_RESPONSE', `operation ${index} is invalid`);
  const commandType = nonEmpty(value.command_type, `operations[${index}].command_type`);
  if (!VALID_COMMAND_TYPES.includes(commandType)) {
    throw publicError('INVALID_AI_RESPONSE', `operation ${index} has an unsupported command type`);
  }
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw publicError('INVALID_AI_RESPONSE', `operation ${index} payload is invalid`);
  }
  const riskLevel = defaultRiskForCommandType(commandType);
  const category = operationCategory(commandType);
  const isWrite = category !== 'query';
  return freeze({
    operation_id: typeof value.operation_id === 'string' && value.operation_id.trim()
      ? value.operation_id.trim().slice(0, 200)
      : `operation-${index + 1}`,
    command_type: commandType,
    payload: clone(value.payload),
    category,
    is_write: isWrite,
    risk_level: riskLevel,
    requires_confirmation: isWrite,
    requires_second_confirmation: isWrite && riskLevel === 'high',
    change_summary: typeof value.change_summary === 'string' ? value.change_summary.trim().slice(0, 500) : '',
    before: safeDiffSnapshot(value.before ?? (category === 'delete' ? value.payload : null)),
    after: safeDiffSnapshot(value.after ?? (['create', 'update'].includes(category) ? value.payload : null)),
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts.filter((item) => typeof item === 'string').map((item) => item.trim().slice(0, 500)).filter(Boolean)
      : [],
  });
}

function validateProviderProposal(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw publicError('INVALID_AI_RESPONSE', 'Local calendar AI returned an invalid proposal');
  const clarification = typeof value.clarification === 'string' ? value.clarification.trim().slice(0, 1000) : '';
  if (clarification && Array.isArray(value.operations) && value.operations.length > 0) {
    throw publicError('INVALID_AI_RESPONSE', 'A clarification proposal cannot contain executable operations');
  }
  if (!Array.isArray(value.operations) || value.operations.length > 25 || (value.operations.length === 0 && !clarification)) {
    throw publicError('INVALID_AI_RESPONSE', 'Local calendar AI proposal must contain operations or a clarification');
  }
  const operations = value.operations.map(validateOperation);
  const knownEventIds = new Set((context.events || []).map((item) => String(item.id || '')).filter(Boolean));
  for (const operation of operations) {
    if (!['update', 'delete'].includes(operation.category) || !operation.command_type.startsWith('calendar.')) continue;
    const targetId = String(operation.payload.id || operation.payload.event_id || operation.payload.target_event_id || '');
    if (!targetId || !knownEventIds.has(targetId)) {
      throw publicError('INVALID_AI_RESPONSE', 'Local calendar AI may only update or delete an event supplied in context');
    }
  }
  return freeze({
    summary: nonEmpty(value.summary, 'summary').slice(0, 1000),
    operations,
    clarification: clarification || null,
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts.filter((item) => typeof item === 'string').map((item) => item.trim().slice(0, 500)).filter(Boolean)
      : [],
    provider_metadata: safeProviderMetadata(value.provider_metadata),
  });
}

function inputDigest(request) {
  return createHash('sha256').update(request, 'utf8').digest('hex');
}

export function createCalendarLocalAiAdapter({
  enabled = true,
  provider = null,
  commandExecutor = null,
  undoExecutor = null,
  timezone,
  clock = () => new Date().toISOString(),
  timeoutMs = 30_000,
} = {}) {
  nonEmpty(timezone, 'timezone');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new TypeError('timeoutMs must be between 100 and 120000');
  if (provider != null && typeof provider.generateProposal !== 'function') throw new TypeError('provider.generateProposal must be a function');
  if (provider?.getState != null && typeof provider.getState !== 'function') throw new TypeError('provider.getState must be a function');
  if (commandExecutor != null && typeof commandExecutor !== 'function') throw new TypeError('commandExecutor must be a function');
  if (undoExecutor != null && typeof undoExecutor !== 'function') throw new TypeError('undoExecutor must be a function');

  const proposals = new Map();
  let lastErrorAt = null;

  function state() {
    const runtime = provider == null ? null : safeProviderRuntimeState(provider);
    if (runtime?.status === STATES.READY && runtime?.can_propose !== false) lastErrorAt = null;
    const status = !enabled ? STATES.DISABLED
      : provider == null ? STATES.UNCONFIGURED
        : lastErrorAt ? STATES.ERROR
          : runtime?.status || STATES.READY;
    const configured = provider != null && runtime?.configured !== false;
    const canPropose = status === STATES.READY && runtime?.can_propose !== false;
    return freeze({
      contract_version: CALENDAR_LOCAL_AI_CONTRACT_VERSION,
      status,
      configured,
      can_propose: canPropose,
      can_write: canPropose && commandExecutor != null,
      runtime_connection: configured ? 'configured' : 'human_blocked',
      last_error_at: lastErrorAt,
      ...(runtime?.configuration_readiness ? { configuration_readiness: runtime.configuration_readiness } : {}),
      ...(runtime?.health_status ? { health_status: runtime.health_status } : {}),
      ...(Object.hasOwn(runtime || {}, 'last_health_at') ? { last_health_at: runtime.last_health_at } : {}),
      ...(runtime?.runtime_state ? { runtime_state: runtime.runtime_state } : {}),
      ...(runtime?.product_status ? { product_status: runtime.product_status } : {}),
      ...(runtime?.diagnostic_code ? { diagnostic_code: runtime.diagnostic_code } : {}),
    });
  }

  function publicProposal(record) {
    return freeze(clone(record));
  }

  function requireProposal(proposalId) {
    const record = proposals.get(nonEmpty(proposalId, 'proposalId'));
    if (!record) throw publicError('PROPOSAL_NOT_FOUND', 'Calendar AI proposal was not found');
    return record;
  }

  async function propose({ request, context = {}, signal } = {}) {
    const prompt = nonEmpty(request, 'request');
    const current = state();
    if (current.status === STATES.DISABLED) throw publicError('AI_DISABLED', 'Local calendar AI is disabled');
    if (current.status === STATES.UNCONFIGURED) throw publicError('AI_UNCONFIGURED', 'Local calendar AI is not configured');

    const requestedAt = clock();
    const safeContext = minimalContext(context, timezone, requestedAt);
    const controller = new AbortController();
    let timeoutTriggered = false;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort(publicError('AI_TIMEOUT', 'Local calendar AI request timed out'));
    }, timeoutMs);
    try {
      const raw = await provider.generateProposal(freeze({
        contract_version: CALENDAR_LOCAL_AI_CONTRACT_VERSION,
        request: prompt,
        context: safeContext,
        output_schema: 'calendar-ai-proposal-v0.1',
      }), { signal: controller.signal });
      const validated = validateProviderProposal(raw, safeContext);
      const createdAt = clock();
      const record = {
        contract_version: CALENDAR_LOCAL_AI_CONTRACT_VERSION,
        proposal_id: `calendar_ai_${randomUUID()}`,
        status: 'draft',
        summary: validated.summary,
        clarification: validated.clarification,
        operations: validated.operations,
        conflicts: validated.conflicts,
        provider_metadata: validated.provider_metadata,
        audit: {
          created_at: createdAt,
          input_sha256: inputDigest(prompt),
          context_fields: [...CONTEXT_FIELDS, ...DETERMINISTIC_TIME_CONTEXT_FIELDS]
            .filter((field) => Object.hasOwn(safeContext, field)),
          confirmed_at: null,
          cancelled_at: null,
          undone_at: null,
        },
        execution_receipts: [],
      };
      proposals.set(record.proposal_id, record);
      lastErrorAt = null;
      return publicProposal(record);
    } catch (error) {
      lastErrorAt = clock();
      if (controller.signal.aborted) throw publicError(
        timeoutTriggered || error?.code === 'AI_TIMEOUT' || controller.signal.reason?.code === 'AI_TIMEOUT'
          ? 'AI_TIMEOUT'
          : 'AI_CANCELLED',
        'Local calendar AI request did not complete'
      );
      if (error?.code === 'INVALID_AI_RESPONSE') throw error;
      throw publicError('AI_REQUEST_FAILED', 'Local calendar AI request failed');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    }
  }

  async function confirm(proposalId, { confirmed = false, highRiskConfirmed = false, operationIds } = {}) {
    const record = requireProposal(proposalId);
    if (record.status !== 'draft') throw publicError('PROPOSAL_NOT_DRAFT', 'Only a draft proposal can be confirmed');
    if (record.operations.length === 0) throw publicError('CLARIFICATION_REQUIRED', 'Clarify the request before confirmation');
    if (confirmed !== true) throw publicError('CONFIRMATION_REQUIRED', 'Explicit confirmation is required');
    const selectedIds = operationIds === undefined
      ? record.operations.map((item) => item.operation_id)
      : Array.isArray(operationIds)
        ? [...new Set(operationIds.map((item) => nonEmpty(item, 'operationIds[]')))]
        : [];
    if (selectedIds.length === 0) throw publicError('OPERATION_SELECTION_REQUIRED', 'At least one proposal operation must be selected');
    const knownIds = new Set(record.operations.map((item) => item.operation_id));
    if (selectedIds.some((item) => !knownIds.has(item))) throw publicError('INVALID_OPERATION_SELECTION', 'Proposal operation selection is invalid');
    const selected = record.operations.filter((item) => selectedIds.includes(item.operation_id));
    if (selected.some((item) => item.requires_second_confirmation) && highRiskConfirmed !== true) {
      throw publicError('SECOND_CONFIRMATION_REQUIRED', 'High-risk calendar changes require a second confirmation');
    }
    if (!commandExecutor) throw publicError('CALENDAR_WRITE_UNAVAILABLE', 'Calendar writes are not configured');
    const receipts = [];
    for (const operation of selected) {
      const command = createCommand({
        command_type: operation.command_type,
        payload: operation.payload,
        created_at: clock(),
        requires_confirmation: operation.requires_confirmation,
        confirmation_state: operation.requires_confirmation ? 'confirmed' : 'not_required',
        source: 'calendar-local-ai-confirmed',
      });
      receipts.push(await commandExecutor(command));
    }
    record.status = 'confirmed';
    record.audit.confirmed_at = clock();
    record.selected_operation_ids = selectedIds;
    record.execution_receipts = receipts.map(clone);
    return publicProposal(record);
  }

  function cancel(proposalId) {
    const record = requireProposal(proposalId);
    if (record.status !== 'draft') throw publicError('PROPOSAL_NOT_DRAFT', 'Only a draft proposal can be cancelled');
    record.status = 'cancelled';
    record.audit.cancelled_at = clock();
    return publicProposal(record);
  }

  async function undo(proposalId, { confirmed = false } = {}) {
    const record = requireProposal(proposalId);
    if (record.status !== 'confirmed') throw publicError('PROPOSAL_NOT_CONFIRMED', 'Only a confirmed proposal can be undone');
    if (confirmed !== true) throw publicError('CONFIRMATION_REQUIRED', 'Undo requires explicit confirmation');
    if (!undoExecutor) throw publicError('UNDO_UNAVAILABLE', 'Calendar undo is not configured');
    await undoExecutor(record.execution_receipts.map(clone));
    record.status = 'undone';
    record.audit.undone_at = clock();
    return publicProposal(record);
  }

  return Object.freeze({
    cancel,
    confirm,
    getProposal(proposalId) { return publicProposal(requireProposal(proposalId)); },
    getState: state,
    listProposals() { return freeze([...proposals.values()].map(publicProposal)); },
    propose,
    undo,
  });
}

export { PROPOSAL_STATES as CALENDAR_LOCAL_AI_PROPOSAL_STATES, STATES as CALENDAR_LOCAL_AI_STATES };
