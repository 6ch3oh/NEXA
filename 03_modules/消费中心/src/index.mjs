export const CONSUMPTION_PUBLIC_API_VERSION = '0.3';

// Domain
export {
  CANONICAL_FIELDS,
  VALID_DIRECTIONS,
  normalizeExpenseRecord,
  validateExpenseRecord,
} from './domain/expenseRecord.mjs';

// Repository
export {
  EXPENSE_REPOSITORY_CONTRACT_VERSION,
  assertRepositoryContract,
} from './repositories/expenseRepository.mjs';
export { createInMemoryExpenseRepository } from './repositories/inMemoryExpenseRepository.mjs';
export { createJsonFileExpenseRepository } from './repositories/jsonFileExpenseRepository.mjs';

// Query / statistics / presentation-neutral application services
export { createExpenseQueryService } from './queries/expenseQueryService.mjs';
export { calculateExpenseStatistics } from './statistics/expenseStatistics.mjs';
export {
  DEFAULT_RECENT_TRANSACTIONS_LIMIT,
  createRecentTransactionsViewModel,
} from './viewmodels/recentTransactionsViewModel.mjs';
export { createExpenseDetailStatisticsService } from './services/expenseDetailStatisticsService.mjs';
export { createConsumptionHomeWidgetAdapter } from './viewmodels/consumptionHomeWidgetAdapter.mjs';

// Classification / confidence contracts
export {
  CLASSIFICATION_METHODS,
  CLASSIFICATION_SOURCES,
  normalizeExpenseClassification,
  validateExpenseClassification,
} from './classification/expenseClassification.mjs';
export {
  CONFIDENCE_SOURCES,
  normalizeExpenseConfidence,
  serializeExpenseConfidence,
  validateExpenseConfidence,
} from './confidence/expenseConfidence.mjs';

// Structured source contracts and boundaries
export {
  EXPENSE_SOURCE_KINDS,
  createExpenseDataSource,
} from './contracts/expenseDataSource.mjs';
export { createExpenseSourceCandidate } from './contracts/expenseSourceCandidate.mjs';
export {
  FUTURE_SOURCE_ADAPTER_BOUNDARIES,
  FUTURE_SOURCE_ADAPTER_KINDS,
  createExpenseSourceAdapterBoundary,
} from './contracts/expenseSourceAdapterContract.mjs';

// Write / import / export application services
export { createExpenseCandidateIngestionService } from './services/expenseCandidateIngestionService.mjs';
export {
  MOBILE_EXPENSE_DRAFT_STATUSES,
  MOBILE_EXPENSE_DRAFT_WORKFLOW_VERSION,
  createMobileExpenseDraftWorkflow,
} from './services/mobileExpenseDraftWorkflow.mjs';
export { createExpenseImportService } from './import-export/expenseImportService.mjs';
export { createExpenseExportService } from './import-export/expenseExportService.mjs';
export { createExpenseReclassificationService } from './services/expenseReclassificationService.mjs';
