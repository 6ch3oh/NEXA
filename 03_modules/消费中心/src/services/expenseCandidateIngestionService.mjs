import { normalizeExpenseRecord } from '../domain/expenseRecord.mjs';
import { assertRepositoryContract } from '../repositories/expenseRepository.mjs';
import {
  createExpenseSourceCandidate,
  expenseCandidateToDomainInput,
} from '../contracts/expenseSourceCandidate.mjs';

export const EXPENSE_CANDIDATE_INGESTION_SERVICE_VERSION = '0.1';

function rejected(error) {
  return {
    accepted: false,
    record: null,
    operation: null,
    duplicate: false,
    errors: [{ code: error?.code ?? 'INGESTION_FAILED', message: error?.message ?? 'candidate ingestion failed' }],
  };
}

export function createExpenseCandidateIngestionService(repository) {
  const repo = assertRepositoryContract(repository);

  function ingestExpenseCandidate(input) {
    let converted;
    try {
      converted = expenseCandidateToDomainInput(input);
    } catch (error) {
      return rejected(error);
    }

    const normalized = normalizeExpenseRecord(converted.domainInput);
    if (!normalized.ok) return rejected(normalized.error);
    const outcome = repo.upsert(normalized.record);
    if (!outcome.ok) return rejected(outcome.error);

    return {
      accepted: true,
      record: outcome.record,
      operation: outcome.operation,
      duplicate: outcome.operation === 'update',
      errors: [],
      issues: normalized.issues,
      metadata: {
        source: converted.candidate.source,
        classification: converted.candidate.classification,
        confidence: converted.candidate.confidence,
      },
    };
  }

  function ingestAndroidExpenseCandidate(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return rejected(Object.assign(new TypeError('Android candidate must be a plain object'), { code: 'INVALID_CANDIDATE' }));
    }
    if (input.source?.sourceKind !== undefined && input.source.sourceKind !== 'android_notification') {
      return rejected(Object.assign(new TypeError('Android input requires sourceKind android_notification'), { code: 'INVALID_SOURCE_KIND' }));
    }
    return ingestExpenseCandidate({
      ...input,
      source: { ...(input.source ?? {}), sourceKind: 'android_notification' },
    });
  }

  return Object.freeze({ ingestExpenseCandidate, ingestAndroidExpenseCandidate });
}
