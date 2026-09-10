import { calculateExpenseStatistics } from '../statistics/expenseStatistics.mjs';

export const EXPENSE_DETAIL_STATISTICS_SERVICE_VERSION = '0.1';

const FILTER_KEYS = Object.freeze(['startDate', 'endDate', 'category', 'merchant', 'platform', 'direction']);
const FILTER_KEY_SET = new Set(FILTER_KEYS);

function serviceError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

export function createExpenseDetailStatisticsService(
  queryService,
  statisticsCalculator = calculateExpenseStatistics,
) {
  if (queryService === null || typeof queryService !== 'object' || typeof queryService.query !== 'function') {
    throw serviceError('INVALID_QUERY_SERVICE', 'detail statistics service requires a Query Service');
  }
  if (typeof statisticsCalculator !== 'function') {
    throw serviceError('INVALID_STATISTICS_SERVICE', 'statisticsCalculator must be a function');
  }

  return Object.freeze({
    getDetailStatistics(filters = {}, options = {}) {
      if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
        throw serviceError('INVALID_FILTERS', 'detail statistics filters must be a plain object');
      }
      if (options === null || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some((key) => key !== 'currencyAware')
        || (options.currencyAware !== undefined && typeof options.currencyAware !== 'boolean')) {
        throw serviceError('INVALID_STATISTICS_OPTIONS', 'detail statistics options are invalid');
      }
      for (const key of Object.keys(filters)) {
        if (!FILTER_KEY_SET.has(key)) {
          throw serviceError('INVALID_FILTERS', `unsupported detail statistics filter: ${key}`);
        }
      }

      const query = {};
      for (const key of FILTER_KEYS) {
        if (filters[key] !== undefined) query[key] = filters[key];
      }
      const records = queryService.query({ ...query, sortOrder: 'asc', offset: 0 });
      const statistics = statisticsCalculator(records, options.currencyAware ? { currencyAware: true } : undefined);
      const result = {
        filters: structuredClone(query),
        totals: statistics.totals,
        categoryBreakdown: statistics.byCategory,
        merchantBreakdown: statistics.byMerchant,
        platformBreakdown: statistics.byPlatform,
        dailySeries: statistics.daily,
        monthlySeries: statistics.monthly,
      };
      if (options.currencyAware) {
        result.currencyBreakdown = statistics.byCurrency;
        result.currencyCategoryBreakdown = statistics.byCurrencyCategory;
        result.currencyDailySeries = statistics.byCurrencyDaily;
      }
      return result;
    },
  });
}
