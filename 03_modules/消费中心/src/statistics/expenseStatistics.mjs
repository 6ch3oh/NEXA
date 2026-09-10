import { CANONICAL_FIELDS, VALID_DIRECTIONS } from '../domain/expenseRecord.mjs';

export const EXPENSE_STATISTICS_VERSION = '0.1';

function statisticsError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertCanonicalRecord(record, index) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw statisticsError('INVALID_RECORD', `records[${index}] must be a canonical Expense record`);
  }
  for (const field of CANONICAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw statisticsError('INVALID_RECORD', `records[${index}] is missing canonical field: ${field}`);
    }
  }
  if (typeof record.id !== 'string' || typeof record.platform !== 'string' || record.platform === '') {
    throw statisticsError('INVALID_RECORD', `records[${index}] has an invalid canonical identity or platform`);
  }
  if (typeof record.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.occurredAt)) {
    throw statisticsError('INVALID_RECORD', `records[${index}] has an invalid occurredAt`);
  }
  if (!Number.isInteger(record.amountCents) || record.amountCents === 0) {
    throw statisticsError('INVALID_RECORD', `records[${index}] amountCents must be a non-zero integer`);
  }
  if (!VALID_DIRECTIONS.includes(record.direction)) {
    throw statisticsError('INVALID_RECORD', `records[${index}] has an invalid direction`);
  }
}

function emptyMetrics() {
  return { count: 0, expenseCents: 0, incomeCents: 0, netCents: 0 };
}

function addAmount(metrics, amountCents) {
  metrics.count += 1;
  if (amountCents > 0) metrics.expenseCents += amountCents;
  else metrics.incomeCents += Math.abs(amountCents);
  metrics.netCents = metrics.incomeCents - metrics.expenseCents;
}

function addToGroup(groups, key, amountCents) {
  let metrics = groups.get(key);
  if (!metrics) {
    metrics = emptyMetrics();
    groups.set(key, metrics);
  }
  addAmount(metrics, amountCents);
}

function addToNestedGroup(groups, outerKey, innerKey, amountCents) {
  let inner = groups.get(outerKey);
  if (!inner) {
    inner = new Map();
    groups.set(outerKey, inner);
  }
  addToGroup(inner, innerKey, amountCents);
}

function groupRows(groups, label) {
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, metrics]) => ({ [label]: key, ...metrics }));
}

function nestedGroupRows(groups, outerLabel, innerLabel) {
  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([outerKey, inner]) => groupRows(inner, innerLabel)
      .map((row) => ({ [outerLabel]: outerKey, ...row })));
}

export function calculateExpenseStatistics(records, options = {}) {
  if (!Array.isArray(records)) {
    throw statisticsError('INVALID_RECORDS', 'records must be an array of canonical Expense records');
  }

  const currencyAware = options?.currencyAware === true;

  const totals = { count: 0, totalExpenseCents: 0, totalIncomeCents: 0, netCents: 0 };
  const categories = new Map();
  const merchants = new Map();
  const platforms = new Map();
  const days = new Map();
  const months = new Map();
  const currencies = new Map();
  const currencyCategories = new Map();
  const currencyDays = new Map();

  records.forEach((record, index) => {
    assertCanonicalRecord(record, index);
    totals.count += 1;
    if (record.amountCents > 0) totals.totalExpenseCents += record.amountCents;
    else totals.totalIncomeCents += Math.abs(record.amountCents);
    totals.netCents = totals.totalIncomeCents - totals.totalExpenseCents;

    const category = typeof record.category === 'string' && record.category !== '' ? record.category : 'uncategorized';
    const merchant = typeof record.merchant === 'string' && record.merchant !== '' ? record.merchant : 'unknown';
    addToGroup(categories, category, record.amountCents);
    addToGroup(merchants, merchant, record.amountCents);
    addToGroup(platforms, record.platform, record.amountCents);
    addToGroup(days, record.occurredAt, record.amountCents);
    addToGroup(months, record.occurredAt.slice(0, 7), record.amountCents);
    if (currencyAware) {
      addToGroup(currencies, record.currency, record.amountCents);
      addToNestedGroup(currencyCategories, record.currency, category, record.amountCents);
      addToNestedGroup(currencyDays, record.currency, record.occurredAt, record.amountCents);
    }
  });

  const result = {
    totals,
    byCategory: groupRows(categories, 'key'),
    byMerchant: groupRows(merchants, 'key'),
    byPlatform: groupRows(platforms, 'key'),
    daily: groupRows(days, 'period'),
    monthly: groupRows(months, 'period'),
  };
  if (currencyAware) {
    result.byCurrency = groupRows(currencies, 'currency');
    result.byCurrencyCategory = nestedGroupRows(currencyCategories, 'currency', 'key');
    result.byCurrencyDaily = nestedGroupRows(currencyDays, 'currency', 'period');
  }
  return result;
}
