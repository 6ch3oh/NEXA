export const RECENT_TRANSACTIONS_VIEW_MODEL_VERSION = '0.1';
export const DEFAULT_RECENT_TRANSACTIONS_LIMIT = 10;

function viewModelError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

export function createRecentTransactionsViewModel(queryService) {
  if (queryService === null || typeof queryService !== 'object' || typeof queryService.query !== 'function') {
    throw viewModelError('INVALID_QUERY_SERVICE', 'recent transactions view model requires a Query Service');
  }

  return Object.freeze({
    getRecentTransactions(options = {}) {
      if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw viewModelError('INVALID_OPTIONS', 'recent transaction options must be a plain object');
      }
      const {
        limit = DEFAULT_RECENT_TRANSACTIONS_LIMIT,
        startDate,
        endDate,
        category,
        merchant,
        platform,
        direction,
        includeCurrency = false,
        includeId = true,
      } = options;
      if (typeof includeCurrency !== 'boolean' || typeof includeId !== 'boolean') {
        throw viewModelError('INVALID_PROJECTION_OPTIONS', 'recent transaction projection options must be boolean');
      }
      const records = queryService.query({
        startDate,
        endDate,
        category,
        merchant,
        platform,
        direction,
        sortOrder: 'desc',
        offset: 0,
        limit,
      });
      return records.map((record) => {
        const row = {};
        if (includeId) row.id = record.id;
        Object.assign(row, {
          occurredAt: record.occurredAt,
          amountCents: record.amountCents,
          direction: record.direction,
          merchant: record.merchant,
          category: record.category,
          platform: record.platform,
        });
        if (includeCurrency) row.currency = record.currency;
        return row;
      });
    },
  });
}
