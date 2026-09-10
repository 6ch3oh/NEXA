import { assertRepositoryContract } from '../repositories/expenseRepository.mjs';
import { createExpenseQueryService } from '../queries/expenseQueryService.mjs';
import { encodeLegacyExpenseJson } from '../storage/legacyExpenseJsonCodec.mjs';

export const EXPENSE_EXPORT_SERVICE_VERSION = '0.1';

export function createExpenseExportService({ repository, queryService } = {}) {
  const repo = assertRepositoryContract(repository);
  const query = queryService ?? createExpenseQueryService(repo);
  if (query === null || typeof query !== 'object' || typeof query.query !== 'function') {
    const error = new TypeError('expense export requires a Query Service');
    error.code = 'INVALID_QUERY_SERVICE';
    throw error;
  }

  function encode(records, opts) {
    const encoded = encodeLegacyExpenseJson(records, opts);
    if (!encoded.ok) return encoded;
    return { ...encoded, exportedCount: encoded.document.records.length };
  }

  return Object.freeze({
    exportAll(opts = {}) {
      return encode(repo.list(), opts);
    },
    exportFiltered(queryOptions = {}, opts = {}) {
      return encode(query.query(queryOptions), opts);
    },
  });
}
