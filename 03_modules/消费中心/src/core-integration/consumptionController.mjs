import {
  createConsumptionCoreAdapter,
  getConsumptionPublicApiInfo,
} from './consumptionCoreAdapter.mjs';
import { CONSUMPTION_MODULE_ID } from './consumptionModuleDescriptor.mjs';
import { createExpenseLocalAiAdapter } from '../services/expenseLocalAiAdapter.mjs';

export const CONSUMPTION_CONTROLLER_CONTRACT_VERSION = 1;
export const CONSUMPTION_CONTROLLER_COMMANDS = Object.freeze([
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
  'ai-suggest',
  'ai-query-filter',
]);

function controllerError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function payloadObject(command) {
  const payload = command.payload ?? {};
  if (!isPlainObject(payload)) {
    throw controllerError('INVALID_COMMAND', 'command payload must be a plain object');
  }
  return payload;
}

function createStaticCommandMap(adapter, localAiAdapter) {
  return Object.freeze({
    query: (payload) => adapter.query(payload.options ?? {}),
    recent: (payload) => adapter.recent(payload.options ?? {}),
    statistics: (payload) => adapter.statistics(payload.filters ?? {}),
    'ingest-candidate': (payload) => adapter.ingestCandidate(payload.candidate),
    'import-legacy': (payload) => adapter.importLegacy(payload.jsonText, payload.options ?? {}),
    'export-legacy': (payload) => adapter.exportLegacy(payload),
    'list-mobile-drafts': (payload) => adapter.listMobileDrafts(payload.options ?? {}),
    'create-mobile-draft': (payload) => adapter.createMobileDraft(payload.draft),
    'auto-import-mobile-draft': (payload) => adapter.autoImportMobileDraft(payload.draft),
    'auto-import-pending-mobile-drafts': () => adapter.autoImportPendingMobileDrafts(),
    'update-mobile-draft': (payload) => adapter.updateMobileDraft(payload.draftId, payload.changes),
    'confirm-mobile-draft': (payload) => adapter.confirmMobileDraft(payload.draftId),
    'ignore-mobile-draft': (payload) => adapter.ignoreMobileDraft(payload.draftId),
    'merge-mobile-drafts': (payload) => adapter.mergeMobileDrafts(payload.canonicalDraftId, payload.evidenceDraftId),
    'undo-mobile-draft': (payload) => adapter.undoMobileDraft(payload.draftId),
    'remove-record': (payload) => adapter.removeRecord(payload.recordId),
    'reclassify-record': (payload) => adapter.reclassifyRecord(payload.recordId, payload.category),
    'ai-suggest': (payload) => {
      if (!localAiAdapter) throw controllerError('AI_UNCONFIGURED', 'shared local AI provider is not configured');
      return localAiAdapter.suggest(payload.record, { manualCategory: payload.manualCategory });
    },
    'ai-query-filter': async (payload) => {
      if (!localAiAdapter) throw controllerError('AI_UNCONFIGURED', 'shared local AI provider is not configured');
      const filters = await localAiAdapter.queryToFilter(payload.request);
      const records = adapter.query(filters);
      const statistics = adapter.statistics(filters);
      return Object.freeze({
        filters,
        records,
        totals: statistics.totals,
        result_source: 'deterministic',
      });
    },
  });
}

function snapshot(lifecycle, adapter) {
  const publicApi = getConsumptionPublicApiInfo();
  return Object.freeze({
    moduleId: CONSUMPTION_MODULE_ID,
    lifecycle,
    publicApiVersion: publicApi.version,
    availability: Object.freeze({ ready: lifecycle === 'running' }),
    capabilityIdentifiers: Object.freeze(adapter.listCapabilities()),
  });
}

export function createConsumptionController(options = {}) {
  if (!isPlainObject(options)) {
    throw controllerError('INVALID_CONTROLLER_OPTIONS', 'controller options must be a plain object');
  }
  const adapter = options.adapter ?? createConsumptionCoreAdapter({
    repository: options.repository,
    mobileDraftFilePath: options.mobileDraftFilePath,
    now: options.now,
  });
  if (!adapter || typeof adapter !== 'object' || typeof adapter.listCapabilities !== 'function') {
    throw controllerError('INVALID_CORE_ADAPTER', 'controller requires a Consumption Core Adapter');
  }
  const localAiAdapter = options.localAiProvider
    ? createExpenseLocalAiAdapter({ provider: options.localAiProvider, clock: options.now, timezone: options.timezone })
    : null;
  const commands = createStaticCommandMap(adapter, localAiAdapter);
  let lifecycle = 'created';

  async function start() {
    lifecycle = 'running';
    return snapshot(lifecycle, adapter);
  }

  async function stop() {
    lifecycle = 'stopped';
  }

  function getSnapshot() {
    return structuredClone(snapshot(lifecycle, adapter));
  }

  async function execute(command) {
    if (lifecycle !== 'running') {
      throw controllerError('CONTROLLER_NOT_RUNNING', 'Consumption Controller is not running');
    }
    if (!isPlainObject(command) || typeof command.type !== 'string') {
      throw controllerError('INVALID_COMMAND', 'command requires a string type');
    }
    const handler = Object.hasOwn(commands, command.type) ? commands[command.type] : undefined;
    if (typeof handler !== 'function') {
      throw controllerError('UNKNOWN_COMMAND', `unsupported Consumption command: ${command.type}`);
    }
    return handler(payloadObject(command));
  }

  return Object.freeze({ start, stop, getSnapshot, execute });
}
