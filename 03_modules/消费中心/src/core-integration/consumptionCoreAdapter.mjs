// Core-facing production dependency boundary: this module consumes only Public API V0.3.
import * as consumptionPublicApi from '../index.mjs';

export const CONSUMPTION_CORE_ADAPTER_VERSION = '0.4';

const REQUIRED_PUBLIC_API_VERSION = '0.3';
const CAPABILITY_IDENTIFIERS = Object.freeze([
  'query',
  'recent',
  'statistics',
  'ingest-candidate',
  'import-legacy',
  'export-legacy',
  'list-mobile-drafts',
  'create-mobile-draft',
  'auto-import-mobile-draft',
  'auto-import-pending-mobile-drafts',
  'update-mobile-draft',
  'confirm-mobile-draft',
  'ignore-mobile-draft',
  'merge-mobile-drafts',
  'undo-mobile-draft',
  'remove-record',
  'reclassify-record',
]);

function adapterError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainObject(value, field, fallback = {}) {
  const resolved = value === undefined ? fallback : value;
  if (!isPlainObject(resolved)) {
    throw adapterError('INVALID_CORE_COMMAND', `${field} must be a plain object`);
  }
  return resolved;
}

function assertPublicApiCompatibility() {
  if (consumptionPublicApi.CONSUMPTION_PUBLIC_API_VERSION !== REQUIRED_PUBLIC_API_VERSION) {
    throw adapterError(
      'UNSUPPORTED_CONSUMPTION_PUBLIC_API',
      `Consumption Public API ${REQUIRED_PUBLIC_API_VERSION} is required`,
    );
  }
}

export function getConsumptionPublicApiInfo() {
  return Object.freeze({
    version: consumptionPublicApi.CONSUMPTION_PUBLIC_API_VERSION,
    exportCount: Object.keys(consumptionPublicApi).length,
    entry: 'src/index.mjs',
  });
}

export function createConsumptionCoreAdapter(options = {}) {
  assertPublicApiCompatibility();
  if (!isPlainObject(options)) {
    throw adapterError('INVALID_CORE_ADAPTER_OPTIONS', 'Core Adapter options must be a plain object');
  }
  if (!Object.hasOwn(options, 'repository')) {
    throw adapterError('MISSING_REPOSITORY', 'Core must inject an Expense Repository');
  }

  const repository = consumptionPublicApi.assertRepositoryContract(options.repository);
  const queryService = consumptionPublicApi.createExpenseQueryService(repository);
  const recentViewModel = consumptionPublicApi.createRecentTransactionsViewModel(queryService);
  const detailStatistics = consumptionPublicApi.createExpenseDetailStatisticsService(queryService);
  const ingestion = consumptionPublicApi.createExpenseCandidateIngestionService(repository);
  const importer = consumptionPublicApi.createExpenseImportService(repository);
  const exporter = consumptionPublicApi.createExpenseExportService({ repository, queryService });
  const reclassification = consumptionPublicApi.createExpenseReclassificationService(repository);
  const mobileDraftWorkflow = typeof options.mobileDraftFilePath === 'string'
    ? consumptionPublicApi.createMobileExpenseDraftWorkflow({
        filePath: options.mobileDraftFilePath,
        repository,
        now: options.now,
      })
    : null;

  function requireMobileDraftWorkflow() {
    if (!mobileDraftWorkflow) {
      throw adapterError('MOBILE_DRAFT_STORE_NOT_CONFIGURED', 'Core must inject a mobile draft file path');
    }
    return mobileDraftWorkflow;
  }

  return Object.freeze({
    listCapabilities() {
      return [...CAPABILITY_IDENTIFIERS];
    },

    query(queryOptions = {}) {
      return queryService.query(requirePlainObject(queryOptions, 'query options'));
    },

    recent(options = {}) {
      return recentViewModel.getRecentTransactions(requirePlainObject(options, 'recent options'));
    },

    statistics(filters = {}) {
      return detailStatistics.getDetailStatistics(requirePlainObject(filters, 'statistics filters'));
    },

    ingestCandidate(candidate) {
      if (!isPlainObject(candidate)) {
        throw adapterError('INVALID_CORE_COMMAND', 'candidate must be a plain object');
      }
      return ingestion.ingestExpenseCandidate(candidate);
    },

    importLegacy(jsonText, importOptions = {}) {
      if (typeof jsonText !== 'string') {
        throw adapterError('INVALID_CORE_COMMAND', 'legacy import requires explicit JSON text');
      }
      return importer.importLegacyJson(
        jsonText,
        requirePlainObject(importOptions, 'legacy import options'),
      );
    },

    exportLegacy(request = {}) {
      const input = requirePlainObject(request, 'legacy export request');
      const mode = input.mode ?? 'all';
      const exportOptions = requirePlainObject(input.options, 'legacy export options');
      if (mode === 'all') return exporter.exportAll(exportOptions);
      if (mode === 'filtered') {
        return exporter.exportFiltered(
          requirePlainObject(input.query, 'legacy export query'),
          exportOptions,
        );
      }
      throw adapterError('INVALID_EXPORT_MODE', 'legacy export mode must be all or filtered');
    },

    listMobileDrafts(options = {}) {
      return requireMobileDraftWorkflow().listDrafts(requirePlainObject(options, 'mobile draft list options'));
    },

    createMobileDraft(draft) {
      return requireMobileDraftWorkflow().createDraft(requirePlainObject(draft, 'mobile draft'));
    },

    autoImportMobileDraft(draft) {
      return requireMobileDraftWorkflow().autoImportDraft(requirePlainObject(draft, 'mobile draft'));
    },

    autoImportPendingMobileDrafts() {
      return requireMobileDraftWorkflow().autoImportPendingDrafts();
    },

    updateMobileDraft(draftId, changes) {
      if (typeof draftId !== 'string') throw adapterError('INVALID_CORE_COMMAND', 'draftId must be a string');
      return requireMobileDraftWorkflow().updateDraft(draftId, requirePlainObject(changes, 'mobile draft changes'));
    },

    confirmMobileDraft(draftId) {
      if (typeof draftId !== 'string') throw adapterError('INVALID_CORE_COMMAND', 'draftId must be a string');
      return requireMobileDraftWorkflow().confirmDraft(draftId);
    },

    ignoreMobileDraft(draftId) {
      if (typeof draftId !== 'string') throw adapterError('INVALID_CORE_COMMAND', 'draftId must be a string');
      return requireMobileDraftWorkflow().ignoreDraft(draftId);
    },

    mergeMobileDrafts(canonicalDraftId, evidenceDraftId) {
      if (typeof canonicalDraftId !== 'string' || typeof evidenceDraftId !== 'string') {
        throw adapterError('INVALID_CORE_COMMAND', 'canonicalDraftId and evidenceDraftId must be strings');
      }
      return requireMobileDraftWorkflow().mergeDrafts(canonicalDraftId, evidenceDraftId);
    },

    undoMobileDraft(draftId) {
      if (typeof draftId !== 'string') throw adapterError('INVALID_CORE_COMMAND', 'draftId must be a string');
      return requireMobileDraftWorkflow().undoDraft(draftId);
    },

    removeRecord(recordId) {
      if (typeof recordId !== 'string') throw adapterError('INVALID_CORE_COMMAND', 'recordId must be a string');
      return requireMobileDraftWorkflow().removeRecord(recordId);
    },

    reclassifyRecord(recordId, category) {
      return reclassification.reclassify(recordId, category);
    },
  });
}
