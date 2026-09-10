import { createExpenseDetailStatisticsService } from '../services/expenseDetailStatisticsService.mjs';
import { createRecentTransactionsViewModel } from './recentTransactionsViewModel.mjs';

export const CONSUMPTION_HOME_WIDGET_ADAPTER_VERSION = '0.1';
export const CONSUMPTION_HOME_WIDGET_WAVE004_VERSION = '0.2';
export const DEFAULT_HOME_WIDGET_RECENT_LIMIT = 5;
export const MAX_HOME_WIDGET_RECENT_LIMIT = 8;

const FRESHNESS_STATUS = Object.freeze({
  current: 'current',
  historical: 'historical',
  empty: 'empty',
});

const CATEGORY_NAMES = Object.freeze({
  food: '餐饮',
  shopping: '购物',
  travel: '出行',
  transport: '交通',
  housing: '居住',
  utilities: '生活缴费',
  entertainment: '娱乐',
  health: '医疗健康',
  education: '学习教育',
  salary: '工资收入',
  other: '其他',
  uncategorized: '未分类',
});

function widgetError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw widgetError('INVALID_WIDGET_CLOCK', 'widget clock must return a valid date');
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function selectTopExpenseCategory(categoryBreakdown) {
  let top = null;
  for (const row of categoryBreakdown) {
    if (row.expenseCents <= 0) continue;
    if (top === null || row.expenseCents > top.expenseCents) top = row;
  }
  return top === null ? null : structuredClone(top);
}

function localizedFailure(error, contractVersion = CONSUMPTION_HOME_WIDGET_ADAPTER_VERSION) {
  if (contractVersion === CONSUMPTION_HOME_WIDGET_WAVE004_VERSION) {
    const invalid = typeof error?.code === 'string' && error.code.startsWith('INVALID_');
    return {
      ok: false,
      availability: { status: 'unavailable', reason: invalid ? 'INVALID_REQUEST' : 'QUERY_FAILED' },
      error: {
        code: invalid ? error.code : 'CONSUMPTION_WIDGET_UNAVAILABLE',
        message: '消费摘要暂不可用',
      },
    };
  }
  return {
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'CONSUMPTION_WIDGET_UNAVAILABLE',
      message: '消费摘要暂不可用',
    },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function safeLabel(value, fallback, maxLength = 80) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, maxLength);
}

function categoryName(categoryId) {
  return CATEGORY_NAMES[categoryId] ?? safeLabel(categoryId, CATEGORY_NAMES.other, 40);
}

function percentage(amountCents, totalCents) {
  if (!Number.isInteger(amountCents) || !Number.isInteger(totalCents) || totalCents <= 0) return null;
  return Math.round((amountCents / totalCents) * 10_000) / 100;
}

function wave004CategoryDistribution(detail) {
  const totals = new Map(detail.currencyBreakdown.map((row) => [row.currency, row.expenseCents]));
  return detail.currencyCategoryBreakdown
    .filter((row) => row.expenseCents > 0)
    .map((row) => ({
      category_id: safeLabel(row.key, 'other', 40),
      category_name: categoryName(row.key),
      amount_cents: row.expenseCents,
      currency: row.currency,
      percentage: percentage(row.expenseCents, totals.get(row.currency)),
    }))
    .sort((left, right) => right.amount_cents - left.amount_cents
      || left.currency.localeCompare(right.currency)
      || left.category_id.localeCompare(right.category_id));
}

function wave004RecentRows(rows) {
  return rows.map((row) => ({
    occurred_at: row.occurredAt,
    title: safeLabel(row.merchant, '未提供商户'),
    category_id: safeLabel(row.category, 'other', 40),
    category_name: categoryName(row.category),
    amount_cents: row.amountCents,
    currency: row.currency,
    direction: row.direction,
    platform: safeLabel(row.platform, 'unknown', 40),
  }));
}

function wave004Summary({ detailStatistics, recentTransactions, today, recentLimit, generatedAt }) {
  if (!Number.isInteger(recentLimit) || recentLimit < DEFAULT_HOME_WIDGET_RECENT_LIMIT || recentLimit > MAX_HOME_WIDGET_RECENT_LIMIT) {
    throw widgetError('INVALID_HOME_RECENT_LIMIT', 'Wave004 recentLimit must be an integer from 5 to 8');
  }
  const startDate = `${today.slice(0, 7)}-01`;
  const detail = detailStatistics.getDetailStatistics({ startDate, endDate: today }, { currencyAware: true });
  const recent = recentTransactions.getRecentTransactions({
    startDate,
    endDate: today,
    limit: recentLimit,
    includeCurrency: true,
    includeId: false,
  });
  const currencyRows = detail.currencyBreakdown;
  const currencyDaily = new Map(detail.currencyDailySeries
    .filter((row) => row.period === today)
    .map((row) => [row.currency, row.expenseCents]));
  const totalsByCurrency = currencyRows.map((row) => ({
    currency: row.currency,
    month_expense_cents: row.expenseCents,
    today_expense_cents: currencyDaily.get(row.currency) ?? 0,
  }));
  const currencies = currencyRows.map((row) => row.currency);
  const noData = detail.totals.count === 0;
  const mixedCurrency = currencies.length > 1;
  const currency = currencies.length === 1 ? currencies[0] : null;
  const latestOccurredAt = recent[0]?.occurredAt ?? null;
  const distribution = wave004CategoryDistribution(detail);
  const availability = noData
    ? { status: 'no_data', reason: 'NO_RECORDS' }
    : mixedCurrency
      ? { status: 'partial', reason: 'MULTI_CURRENCY' }
      : { status: 'available', reason: null };

  return deepFreeze({
    ok: true,
    value: {
      contract: 'ConsumptionHomeSummary',
      contractVersion: CONSUMPTION_HOME_WIDGET_WAVE004_VERSION,
      availability,
      period: { startDate, endDate: today },
      currency,
      month_expense_cents: currency === null ? null : currencyRows[0].expenseCents,
      today_expense_cents: currency === null ? null : (currencyDaily.get(currency) ?? 0),
      totals_by_currency: totalsByCurrency,
      category_distribution: distribution,
      recent_transactions: wave004RecentRows(recent),
      top_category: currency === null ? null : (distribution[0] ?? null),
      freshness: {
        as_of_date: today,
        latest_occurred_at: latestOccurredAt,
        status: latestOccurredAt === null
          ? FRESHNESS_STATUS.empty
          : latestOccurredAt === today
            ? FRESHNESS_STATUS.current
            : FRESHNESS_STATUS.historical,
        semantics: 'latest_record_date',
      },
      source: { kind: 'canonical_expense_repository', mode: 'core_injected_read_only' },
      empty_state: noData
        ? { code: 'NO_CONSUMPTION_RECORDS', message: '本月暂无消费记录。' }
        : null,
      generated_at: generatedAt,
    },
  });
}

export function createConsumptionHomeWidgetAdapter(queryService, options = {}) {
  if (!isPlainObject(options)) {
    throw widgetError('INVALID_WIDGET_ADAPTER_OPTIONS', 'widget adapter options must be a plain object');
  }
  const clock = options.now ?? (() => new Date());
  if (typeof clock !== 'function') {
    throw widgetError('INVALID_WIDGET_CLOCK', 'widget adapter now option must be a function');
  }

  const detailStatistics = createExpenseDetailStatisticsService(queryService);
  const recentTransactions = createRecentTransactionsViewModel(queryService);

  return Object.freeze({
    getSummary(summaryOptions = {}) {
      let contractVersion = CONSUMPTION_HOME_WIDGET_ADAPTER_VERSION;
      try {
        if (!isPlainObject(summaryOptions)) {
          throw widgetError('INVALID_WIDGET_OPTIONS', 'widget summary options must be a plain object');
        }

        contractVersion = summaryOptions.contractVersion ?? CONSUMPTION_HOME_WIDGET_ADAPTER_VERSION;
        if (![CONSUMPTION_HOME_WIDGET_ADAPTER_VERSION, CONSUMPTION_HOME_WIDGET_WAVE004_VERSION].includes(contractVersion)) {
          throw widgetError('INVALID_WIDGET_CONTRACT_VERSION', 'unsupported Home summary contract version');
        }
        const now = clock();
        const today = summaryOptions.today ?? localDateKey(now);
        if (typeof today !== 'string') {
          throw widgetError('INVALID_WIDGET_TODAY', 'widget today must be a YYYY-MM-DD string');
        }
        if (contractVersion === CONSUMPTION_HOME_WIDGET_WAVE004_VERSION) {
          const supportedKeys = new Set(['contractVersion', 'today', 'recentLimit']);
          if (Object.keys(summaryOptions).some((key) => !supportedKeys.has(key))) {
            throw widgetError('INVALID_WIDGET_OPTIONS', 'Wave004 summary options contain unsupported fields');
          }
          const generatedDate = now instanceof Date ? now : new Date(now);
          if (!Number.isFinite(generatedDate.getTime())) {
            throw widgetError('INVALID_WIDGET_CLOCK', 'widget clock must return a valid date');
          }
          return wave004Summary({
            detailStatistics,
            recentTransactions,
            today,
            recentLimit: summaryOptions.recentLimit ?? DEFAULT_HOME_WIDGET_RECENT_LIMIT,
            generatedAt: generatedDate.toISOString(),
          });
        }
        const startDate = summaryOptions.startDate ?? `${today.slice(0, 7)}-01`;
        const endDate = summaryOptions.endDate ?? today;
        const recentLimit = summaryOptions.recentLimit ?? DEFAULT_HOME_WIDGET_RECENT_LIMIT;

        const detail = detailStatistics.getDetailStatistics({ startDate, endDate });
        const recent = recentTransactions.getRecentTransactions({
          startDate,
          endDate,
          limit: recentLimit,
        });
        const todayRow = detail.dailySeries.find((row) => row.period === today);
        const latestOccurredAt = recent[0]?.occurredAt ?? null;

        return {
          ok: true,
          value: {
            period: structuredClone(detail.filters),
            totalExpenseCents: detail.totals.totalExpenseCents,
            todayExpenseCents: todayRow?.expenseCents ?? 0,
            recentTransactions: structuredClone(recent),
            topCategory: selectTopExpenseCategory(detail.categoryBreakdown),
            freshness: {
              asOfDate: today,
              latestOccurredAt,
              status: latestOccurredAt === null
                ? FRESHNESS_STATUS.empty
                : latestOccurredAt === today
                  ? FRESHNESS_STATUS.current
                  : FRESHNESS_STATUS.historical,
            },
          },
        };
      } catch (error) {
        return localizedFailure(error, contractVersion);
      }
    },
  });
}
