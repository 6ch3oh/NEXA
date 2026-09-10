export const EXPENSE_LOCAL_AI_CONTRACT_VERSION = '0.1.0';

const DETERMINISTIC_FIELDS = Object.freeze([
  'id', 'amountCents', 'currency', 'occurredAt', 'platform', 'sourceId', 'direction', 'dedupeKey',
]);

function fail(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function text(value, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeRecordContext(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw fail('INVALID_EXPENSE_RECORD', 'record must be an object');
  const result = {};
  for (const field of DETERMINISTIC_FIELDS) {
    if (['string', 'number', 'boolean'].includes(typeof record[field])) result[field] = record[field];
  }
  for (const field of ['merchant', 'category']) result[field] = text(record[field], 120);
  return Object.freeze(result);
}

function validateSuggestion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_AI_RESPONSE', 'suggestion must be an object');
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw fail('INVALID_AI_RESPONSE', 'confidence must be between zero and one');
  return Object.freeze({
    suggested_category: text(value.suggested_category, 64) || 'other',
    suggested_display_name: text(value.suggested_display_name, 120),
    tags: Object.freeze(Array.isArray(value.tags) ? value.tags.map((item) => text(item, 48)).filter(Boolean).slice(0, 8) : []),
    confidence,
    reason: text(value.reason, 300),
  });
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validateFilter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_AI_RESPONSE', 'filter must be an object');
  const result = {};
  for (const field of ['startDate', 'endDate']) {
    if (value[field] != null) {
      if (!validDate(value[field])) throw fail('INVALID_AI_RESPONSE', `${field} is invalid`);
      result[field] = value[field];
    }
  }
  for (const field of ['category', 'merchant', 'platform']) if (text(value[field])) result[field] = text(value[field], 120);
  if (value.direction != null) {
    if (!['expense', 'income'].includes(value.direction)) throw fail('INVALID_AI_RESPONSE', 'direction is invalid');
    result.direction = value.direction;
  }
  if (result.startDate && result.endDate && result.startDate > result.endDate) throw fail('INVALID_AI_RESPONSE', 'date range is invalid');
  return Object.freeze(result);
}

export function createExpenseLocalAiAdapter({
  provider,
  clock = () => new Date().toISOString(),
  timezone = 'Asia/Shanghai',
  confidenceThreshold = 0.7,
} = {}) {
  if (!provider || typeof provider.generateProposal !== 'function') throw fail('AI_UNCONFIGURED', 'shared local AI provider is required');
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
    throw fail('INVALID_CONFIDENCE_THRESHOLD', 'confidenceThreshold must be between zero and one');
  }
  return Object.freeze({
    getState() { return provider.getState?.() ?? { status: 'ready', configured: true }; },
    async suggest(record, { manualCategory = null } = {}) {
      const deterministic = safeRecordContext(record);
      const raw = await provider.generateProposal({ request: 'expense suggestion', context: deterministic, output_schema: 'expense-ai-suggestion-v0.1' });
      const suggestion = validateSuggestion(raw);
      const manual = text(manualCategory, 64);
      const providerState = provider.getState?.() ?? {};
      const modelId = text(providerState.model_id ?? providerState.diagnostics?.model_id, 200) || 'unknown-local-model';
      return Object.freeze({
        contract_version: EXPENSE_LOCAL_AI_CONTRACT_VERSION,
        source: 'local_ai',
        model_id: modelId,
        reason_identity: 'LOCAL_AI_SUGGESTION',
        category: suggestion.suggested_category,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        status: manual ? 'CONFIRMED_MANUAL' : (suggestion.confidence < confidenceThreshold ? 'PENDING_CONFIRMATION' : 'SUGGESTED'),
        deterministic_fields: deterministic,
        suggestion,
        effective_category: manual || suggestion.suggested_category,
        category_source: manual ? 'manual' : 'local_ai',
        reviewed: Boolean(manual),
        generated_at: clock(),
      });
    },
    async queryToFilter(request) {
      if (!text(request, 1000)) throw fail('INVALID_QUERY', 'request is required');
      const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(clock()));
      const raw = await provider.generateProposal({
        request: text(request, 1000), context: { current_date: currentDate, timezone }, output_schema: 'expense-query-filter-v0.1',
      });
      return validateFilter(raw);
    },
  });
}
