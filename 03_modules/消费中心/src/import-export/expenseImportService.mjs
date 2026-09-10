import { assertRepositoryContract } from '../repositories/expenseRepository.mjs';
import { decodeLegacyExpenseJson } from '../storage/legacyExpenseJsonCodec.mjs';

export const EXPENSE_IMPORT_SERVICE_VERSION = '0.1';

export function createExpenseImportService(repository) {
  const repo = assertRepositoryContract(repository);

  return Object.freeze({
    importLegacyJson(jsonText, opts = {}) {
      const decoded = decodeLegacyExpenseJson(jsonText, opts);
      if (!decoded.ok) {
        return {
          ok: false,
          error: decoded.error,
          importedCount: 0,
          updatedCount: 0,
          duplicateCount: 0,
          rejectedCount: 0,
          errors: [{ stage: 'decode', code: decoded.error.code, message: decoded.error.message }],
        };
      }

      const written = repo.upsertMany(decoded.domainRecords, opts);
      if (!written.ok) {
        return {
          ok: false,
          error: written.error,
          importedCount: 0,
          updatedCount: 0,
          duplicateCount: decoded.duplicates.length,
          rejectedCount: decoded.rejected.length,
          errors: [{ stage: 'repository', code: written.error.code, message: written.error.message }],
        };
      }

      const repositoryErrors = written.results
        .filter((result) => !result.ok)
        .map((result) => ({ stage: 'repository', code: result.error.code, message: result.error.message }));
      const decodeErrors = decoded.rejected.map((entry) => ({
        stage: 'decode', code: entry.error.code, message: entry.error.message,
      }));

      return {
        ok: true,
        importedCount: written.added,
        updatedCount: written.updated,
        duplicateCount: decoded.duplicates.length + written.updated,
        rejectedCount: decoded.rejected.length + written.rejected,
        errors: [...decodeErrors, ...repositoryErrors],
      };
    },
  });
}
