'use strict';

const CONSUMPTION_HOME_WIDGET_CHANNEL = 'nexa:consumption:get-home-summary';
const FRESHNESS_STATES = new Set(['current', 'historical', 'empty']);
const WAVE004_AVAILABILITY = new Set(['available', 'no_data', 'partial']);
const WAVE004_REASONS = new Set([null, 'NO_RECORDS', 'MULTI_CURRENCY']);

class NexaConsumptionHomeWidgetBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaConsumptionHomeWidgetBridgeError';
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new NexaConsumptionHomeWidgetBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeString(value) {
  return typeof value === 'string' ? value : null;
}

function safeCents(value) {
  if (!Number.isSafeInteger(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption cents must be safe integers');
  return value;
}

function nullableCents(value, field) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} must be a safe integer or null`);
  }
  return value;
}

function requiredString(value, field, limit = 160) {
  if (typeof value !== 'string' || value.length === 0 || value.length > limit) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} must be bounded text`);
  }
  return value;
}

function currencyCode(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = requiredString(value, field, 3);
  if (!/^[A-Z]{3}$/.test(text)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} is invalid`);
  return text;
}

function dateOnly(value, field) {
  const text = requiredString(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} is invalid`);
  }
  return text;
}

function isoTimestamp(value, field) {
  const text = requiredString(value, field, 48);
  if (Number.isNaN(Date.parse(text))) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} is invalid`);
  return text;
}

function percentage(value, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `${field} must be a percentage or null`);
  }
  return value;
}

function projectTransaction(value) {
  if (!isPlainObject(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption transaction is invalid');
  return Object.freeze({
    id: safeString(value.id),
    occurredAt: safeString(value.occurredAt),
    amountCents: safeCents(value.amountCents),
    direction: safeString(value.direction),
    merchant: safeString(value.merchant),
    category: safeString(value.category),
    platform: safeString(value.platform)
  });
}

function projectTopCategory(value) {
  if (value === null) return null;
  if (!isPlainObject(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption top category is invalid');
  return Object.freeze({
    key: safeString(value.key),
    count: Number.isSafeInteger(value.count) ? value.count : null,
    expenseCents: safeCents(value.expenseCents),
    incomeCents: Number.isSafeInteger(value.incomeCents) ? value.incomeCents : null,
    netCents: Number.isSafeInteger(value.netCents) ? value.netCents : null
  });
}

function projectSummary(value) {
  if (!isPlainObject(value) || !isPlainObject(value.period) || !isPlainObject(value.freshness) ||
      !Array.isArray(value.recentTransactions) || !FRESHNESS_STATES.has(value.freshness.status)) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption Home Widget summary is invalid');
  }
  return Object.freeze({
    period: Object.freeze({
      startDate: safeString(value.period.startDate),
      endDate: safeString(value.period.endDate)
    }),
    totalExpenseCents: safeCents(value.totalExpenseCents),
    todayExpenseCents: safeCents(value.todayExpenseCents),
    recentTransactions: Object.freeze(value.recentTransactions.map(projectTransaction)),
    topCategory: projectTopCategory(value.topCategory),
    freshness: Object.freeze({
      asOfDate: safeString(value.freshness.asOfDate),
      latestOccurredAt: value.freshness.latestOccurredAt === null
        ? null
        : safeString(value.freshness.latestOccurredAt),
      status: value.freshness.status
    })
  });
}

function projectWave004Total(value, index) {
  if (!isPlainObject(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `totals_by_currency[${index}] is invalid`);
  return Object.freeze({
    currency: currencyCode(value.currency, `totals_by_currency[${index}].currency`),
    month_expense_cents: safeCents(value.month_expense_cents),
    today_expense_cents: safeCents(value.today_expense_cents)
  });
}

function projectWave004Category(value, index) {
  if (!isPlainObject(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `category_distribution[${index}] is invalid`);
  return Object.freeze({
    category_id: requiredString(value.category_id, `category_distribution[${index}].category_id`, 40),
    category_name: requiredString(value.category_name, `category_distribution[${index}].category_name`, 80),
    amount_cents: safeCents(value.amount_cents),
    currency: currencyCode(value.currency, `category_distribution[${index}].currency`),
    percentage: percentage(value.percentage, `category_distribution[${index}].percentage`)
  });
}

function projectWave004Transaction(value, index) {
  if (!isPlainObject(value)) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', `recent_transactions[${index}] is invalid`);
  return Object.freeze({
    occurred_at: dateOnly(value.occurred_at, `recent_transactions[${index}].occurred_at`),
    title: requiredString(value.title, `recent_transactions[${index}].title`, 80),
    category_id: requiredString(value.category_id, `recent_transactions[${index}].category_id`, 40),
    category_name: requiredString(value.category_name, `recent_transactions[${index}].category_name`, 80),
    amount_cents: safeCents(value.amount_cents),
    currency: currencyCode(value.currency, `recent_transactions[${index}].currency`),
    direction: ['expense', 'income'].includes(value.direction)
      ? value.direction
      : (() => { throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'recent transaction direction is invalid'); })(),
    platform: requiredString(value.platform, `recent_transactions[${index}].platform`, 40)
  });
}

function projectWave004Summary(value) {
  if (!isPlainObject(value) || value.contract !== 'ConsumptionHomeSummary' || value.contractVersion !== '0.2' ||
      !isPlainObject(value.availability) || !WAVE004_AVAILABILITY.has(value.availability.status) ||
      !WAVE004_REASONS.has(value.availability.reason) || !isPlainObject(value.period) ||
      !Array.isArray(value.totals_by_currency) || !Array.isArray(value.category_distribution) ||
      !Array.isArray(value.recent_transactions) || value.recent_transactions.length > 8 ||
      !isPlainObject(value.freshness) || !FRESHNESS_STATES.has(value.freshness.status) ||
      !isPlainObject(value.source)) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption Home Summary V0.2 is invalid');
  }
  if (value.source.kind !== 'canonical_expense_repository' || value.source.mode !== 'core_injected_read_only') {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption Home Summary source is invalid');
  }
  const emptyState = value.empty_state === null
    ? null
    : Object.freeze({
        code: value.empty_state?.code === 'NO_CONSUMPTION_RECORDS'
          ? value.empty_state.code
          : (() => { throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption empty state is invalid'); })(),
        message: '本月暂无消费记录。'
      });
  const availabilityPairs = {
    available: null,
    no_data: 'NO_RECORDS',
    partial: 'MULTI_CURRENCY'
  };
  if (availabilityPairs[value.availability.status] !== value.availability.reason) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption availability pair is invalid');
  }
  const totals = value.totals_by_currency.map(projectWave004Total);
  const categories = value.category_distribution.map(projectWave004Category);
  const recent = value.recent_transactions.map(projectWave004Transaction);
  const currencies = new Set(totals.map((row) => row.currency));
  if (categories.some((row) => row.amount_cents <= 0 || !currencies.has(row.currency)) ||
      recent.some((row) => !currencies.has(row.currency))) {
    throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption currency partition is invalid');
  }
  const scalarCurrency = currencyCode(value.currency, 'currency', { nullable: true });
  const monthExpense = nullableCents(value.month_expense_cents, 'month_expense_cents');
  const todayExpense = nullableCents(value.today_expense_cents, 'today_expense_cents');
  if (value.availability.status === 'no_data' && (
    scalarCurrency !== null || monthExpense !== null || todayExpense !== null || value.top_category !== null ||
    totals.length !== 0 || categories.length !== 0 || recent.length !== 0 || emptyState === null
  )) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption no-data state is inconsistent');
  if (value.availability.status === 'partial' && (
    scalarCurrency !== null || monthExpense !== null || todayExpense !== null || value.top_category !== null ||
    currencies.size < 2 || emptyState !== null
  )) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption multi-currency state is inconsistent');
  if (value.availability.status === 'available' && (
    scalarCurrency === null || monthExpense === null || todayExpense === null || currencies.size !== 1 ||
    !currencies.has(scalarCurrency) || emptyState !== null
  )) throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption available state is inconsistent');
  return Object.freeze({
    contract: 'ConsumptionHomeSummary',
    contractVersion: '0.2',
    availability: Object.freeze({
      status: value.availability.status,
      reason: value.availability.reason
    }),
    period: Object.freeze({
      startDate: dateOnly(value.period.startDate, 'period.startDate'),
      endDate: dateOnly(value.period.endDate, 'period.endDate')
    }),
    currency: scalarCurrency,
    month_expense_cents: monthExpense,
    today_expense_cents: todayExpense,
    totals_by_currency: Object.freeze(totals),
    category_distribution: Object.freeze(categories),
    recent_transactions: Object.freeze(recent),
    top_category: value.top_category === null ? null : projectWave004Category(value.top_category, 'top_category'),
    freshness: Object.freeze({
      as_of_date: dateOnly(value.freshness.as_of_date, 'freshness.as_of_date'),
      latest_occurred_at: value.freshness.latest_occurred_at === null
        ? null
        : dateOnly(value.freshness.latest_occurred_at, 'freshness.latest_occurred_at'),
      status: value.freshness.status,
      semantics: value.freshness.semantics === 'latest_record_date'
        ? value.freshness.semantics
        : (() => { throw bridgeError('INVALID_CONSUMPTION_SUMMARY', 'Consumption freshness semantics is invalid'); })()
    }),
    source: Object.freeze({
      kind: 'canonical_expense_repository',
      mode: 'core_injected_read_only'
    }),
    empty_state: emptyState,
    generated_at: isoTimestamp(value.generated_at, 'generated_at')
  });
}

function normalizeRequest(request) {
  if (request === undefined) return Object.freeze({ contractVersion: '0.1' });
  if (!isPlainObject(request)) throw bridgeError('INVALID_WIDGET_OPTIONS', 'Consumption Home request must be an object');
  const keys = Object.keys(request);
  if (keys.some((key) => !['contractVersion', 'recentLimit'].includes(key))) {
    throw bridgeError('INVALID_WIDGET_OPTIONS', 'Consumption Home request contains unsupported fields');
  }
  const contractVersion = request.contractVersion ?? '0.1';
  if (!['0.1', '0.2'].includes(contractVersion)) {
    throw bridgeError('INVALID_WIDGET_CONTRACT_VERSION', 'Consumption Home contract version is unsupported');
  }
  if (contractVersion === '0.1' && request.recentLimit !== undefined) {
    throw bridgeError('INVALID_WIDGET_OPTIONS', 'Consumption Home V0.1 does not accept recentLimit');
  }
  const recentLimit = request.recentLimit ?? 5;
  if (contractVersion === '0.2' && (!Number.isSafeInteger(recentLimit) || recentLimit < 5 || recentLimit > 8)) {
    throw bridgeError('INVALID_HOME_RECENT_LIMIT', 'Consumption Home recentLimit must be from 5 to 8');
  }
  return Object.freeze(contractVersion === '0.2'
    ? { contractVersion, recentLimit }
    : { contractVersion });
}

function safeFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code
    : 'CONSUMPTION_WIDGET_UNAVAILABLE';
  return Object.freeze({
    ok: false,
    availability: Object.freeze({ status: 'unavailable', reason: 'QUERY_FAILED' }),
    error: Object.freeze({ code, message: '消费摘要暂不可用' })
  });
}

function createNexaConsumptionHomeWidgetIpcHandlers({ control, adapter } = {}) {
  if (!control || typeof control.startModule !== 'function') {
    throw bridgeError('INVALID_CONTROL', 'NEXA module control is required');
  }
  if (!adapter || typeof adapter.getSummary !== 'function' || Object.keys(adapter).length !== 1) {
    throw bridgeError('INVALID_WIDGET_ADAPTER', 'Consumption Home Widget Adapter V0.1 is required');
  }

  return Object.freeze({
    [CONSUMPTION_HOME_WIDGET_CHANNEL]: async (_event, request) => {
      try {
        await control.startModule('consumption');
        const options = normalizeRequest(request);
        const result = await adapter.getSummary(options);
        if (result?.ok !== true) return safeFailure(result?.error);
        return Object.freeze({
          ok: true,
          value: options.contractVersion === '0.2'
            ? projectWave004Summary(result.value)
            : projectSummary(result.value)
        });
      } catch (error) {
        return safeFailure(error);
      }
    }
  });
}

module.exports = {
  CONSUMPTION_HOME_WIDGET_CHANNEL,
  NexaConsumptionHomeWidgetBridgeError,
  createNexaConsumptionHomeWidgetIpcHandlers,
  normalizeRequest,
  projectSummary,
  projectWave004Summary
};
