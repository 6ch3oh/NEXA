'use strict';

const { existsSync } = require('node:fs');
const path = require('node:path');

const { createNexaControllerBinding } = require('../shared/nexaControllerBinding');
const { createNexaModuleControl } = require('../shared/nexaModuleControl');
const { createNexaModuleController } = require('../shared/nexaModuleController');
const { createNexaModuleRegistry } = require('../shared/nexaModuleRegistry');
const { createNexaShellHost } = require('../shared/nexaShellHost');
const {
  LEGACY_DEVICE_MODULE_DESCRIPTOR,
  LegacyDeviceSnapshotBridgeError,
  createLegacyDeviceSnapshotReader
} = require('./legacyDeviceSnapshotBridge');
const { createNexaEsmPublicApiLoader } = require('./nexaEsmPublicApiLoader');
const {
  NEXA_CREATOR_OPS_DESCRIPTOR,
  createNexaCreatorOpsController,
  createNexaCreatorOpsIpcHandlers,
  createUnavailableNexaCreatorOpsApplication,
  validateCreatorOpsApplication,
  validateCreatorOpsPublicApi
} = require('./nexaCreatorOpsBridge');
const {
  NEXA_MARKET_DESCRIPTOR,
  createNexaMarketController,
  createNexaMarketIpcHandlers
} = require('./nexaMarketBridge');
const {
  NEXA_STARBENCH_DESCRIPTOR,
  createNexaStarBenchController,
  createNexaStarBenchIpcHandlers,
  validateStarBenchPublicApi
} = require('./nexaStarBenchBridge');
const {
  NEXA_STUDY_CENTER_DESCRIPTOR,
  createNexaStudyCenterController,
  createNexaStudyCenterIpcHandlers,
  createUnavailableNexaStudyCenterPublicApi,
  validateStudyCenterPublicApi
} = require('./nexaStudyCenterBridge');
const {
  NEXA_AUTOMATION_CENTER_DESCRIPTOR,
  createNexaAutomationCenterController,
  createNexaAutomationCenterIpcHandlers,
  createUnavailableNexaAutomationCenterPublicApi,
  validateAutomationCenterPublicApi
} = require('./nexaAutomationCenterBridge');
const {
  DEVICE_CENTER_APPLICATION_METHODS,
  NEXA_DEVICE_CENTER_DESCRIPTOR,
  createNexaDeviceCenterController,
  createNexaDeviceCenterIpcHandlers,
  createUnavailableNexaDeviceCenterApplication
} = require('./nexaDeviceCenterBridge');
const {
  NEXA_DASHI_DESCRIPTOR,
  createNexaDashiReadController,
  createNexaDashiReadIpcHandlers,
  createUnavailableNexaDashiPublicApi
} = require('./nexaDashiReadBridge');
const {
  NEXA_CORE_CONTROL_DESCRIPTOR,
  createNexaCoreControlController,
  createNexaCoreControlIpcHandlers
} = require('./nexaCoreControlBridge');
const {
  NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR,
  createNexaLocalResourcePathController,
  createNexaLocalResourcePathIpcHandlers
} = require('./nexaLocalResourcePathBridge');
const {
  createNexaConsumptionHomeWidgetIpcHandlers
} = require('./nexaConsumptionHomeWidgetBridge');
const {
  NEXA_GLOBAL_COMMAND_DESCRIPTOR,
  createNexaGlobalCommandController,
  createNexaGlobalCommandIpcHandlers,
  createProductionNexaGlobalCommandRuntime
} = require('./nexaGlobalCommandBridge');
const {
  NEXA_TODAY_TOMORROW_DESCRIPTOR,
  createNexaTodayTomorrowController,
  createNexaTodayTomorrowIpcHandlers
} = require('./nexaTodayTomorrowBridge');
const {
  MOBILE_PAIRING_DESCRIPTOR,
  createMobilePairingController,
  createMobilePairingIpcHandlers,
  createUnavailableMobilePairingApplication
} = require('./mobilePairingRuntime');
const { createNexaIpcRegistrationPlan } = require('./nexaIpcRegistration');

function resolveNexaRoot(options = {}) {
  const moduleDir = path.resolve(options.moduleDir || __dirname);
  const packaged = moduleDir.split(path.sep).some((segment) => segment.toLowerCase() === 'app.asar');
  if (!packaged) return path.resolve(moduleDir, '..', '..', '..', '..');

  const resourcesPath = options.resourcesPath || process.resourcesPath;
  if (typeof resourcesPath !== 'string' || !path.isAbsolute(resourcesPath)) {
    throw new Error('Packaged NEXA composition requires an absolute Electron resources path');
  }

  // Packaged verification outputs may add one or more staging/final folders
  // below Core. Locate the canonical Core anchor instead of assuming a fixed
  // number of parent directories, then resolve the existing shared workspace.
  let cursor = path.resolve(resourcesPath);
  while (true) {
    if (
      path.basename(cursor).toLowerCase() === 'token-monitor'
      && path.basename(path.dirname(cursor)).toLowerCase() === '01_source'
    ) {
      return path.dirname(path.dirname(cursor));
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error('Packaged NEXA composition could not locate the canonical 01_source/token-monitor anchor');
}

const NEXA_ROOT = resolveNexaRoot();
const CONSUMPTION_MODULE_ROOT = path.join(NEXA_ROOT, '03_modules', '消费中心');
const CONSUMPTION_PUBLIC_API_ENTRYPOINT = path.join(CONSUMPTION_MODULE_ROOT, 'src', 'index.mjs');
const CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT = path.join(
  CONSUMPTION_MODULE_ROOT,
  'src',
  'core-integration',
  'consumptionIntegrationManifest.mjs'
);
const TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '日历与星枢管家',
  'src',
  'index.mjs'
);
const DASHI_DESKTOP_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  'Dashi任务板',
  'dashi-desktop-entry.mjs'
);
const DASHI_PUBLIC_API_ENTRYPOINT = DASHI_DESKTOP_ENTRYPOINT;
const DEVICE_CENTER_PUBLIC_API_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '设备与网络',
  'src',
  'public-api.mjs'
);
const DEVICE_CENTER_HOME_SUMMARY_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '设备与网络',
  'src',
  'home-device-network-summary.mjs'
);
const CREATOR_OPS_PUBLIC_API_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '自媒体运营',
  'src',
  'index.mjs'
);
const MARKET_MODULE_ROOT = path.join(NEXA_ROOT, '03_modules', '股票市场');
const STARBENCH_DESKTOP_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  'StarBench',
  'src',
  'public',
  'starbench-desktop-entry.mjs'
);
const STUDY_CENTER_PUBLIC_API_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '03_modules',
  '六级词汇',
  'src',
  'index.mjs'
);
const AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT = path.join(
  NEXA_ROOT,
  '04_automation',
  'ExecutionHub',
  'runner',
  'daily-ops-production-composition-v0.1.mjs'
);
const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });
const CANONICAL_RECORD_FIELDS = Object.freeze([
  'id',
  'platform',
  'sourceId',
  'occurredAt',
  'amountCents',
  'currency',
  'merchant',
  'direction',
  'category',
  'note',
  'createdAt',
  'dedupeKey'
]);

class NexaAppCompositionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaAppCompositionError';
    this.code = code;
  }
}

function compositionError(code, message) {
  return new NexaAppCompositionError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateOptions(options) {
  if (!isPlainObject(options)) {
    throw compositionError('INVALID_OPTIONS', 'NEXA app composition options must be a plain object');
  }
  if (typeof options.consumptionRepositoryPath !== 'string' ||
      !path.isAbsolute(options.consumptionRepositoryPath)) {
    throw compositionError(
      'INVALID_CONSUMPTION_REPOSITORY_PATH',
      'Consumption repository path must be an absolute filesystem path'
    );
  }
  if (typeof options.todayTomorrowDataRoot !== 'string' ||
      !path.isAbsolute(options.todayTomorrowDataRoot)) {
    throw compositionError(
      'INVALID_TODAY_TOMORROW_DATA_ROOT',
      'Today/Tomorrow data root must be an absolute filesystem path'
    );
  }
  if (typeof options.deviceCenterDataRoot !== 'string' ||
      !path.isAbsolute(options.deviceCenterDataRoot) ||
      path.resolve(options.deviceCenterDataRoot) === path.parse(path.resolve(options.deviceCenterDataRoot)).root) {
    throw compositionError(
      'INVALID_DEVICE_CENTER_DATA_ROOT',
      'Device Center data root must be an absolute non-root filesystem path'
    );
  }
  if (typeof options.timezone !== 'string' || options.timezone.trim() === '' ||
      typeof options.clock !== 'function') {
    throw compositionError(
      'INVALID_TODAY_TOMORROW_PLATFORM_CONFIG',
      'Today/Tomorrow requires an explicit timezone and clock'
    );
  }
  const marketDataRoot = options.marketDataRoot || path.join(
    path.dirname(options.deviceCenterDataRoot),
    'market'
  );
  if (typeof marketDataRoot !== 'string' || !path.isAbsolute(marketDataRoot) ||
      path.resolve(marketDataRoot) === path.parse(path.resolve(marketDataRoot)).root) {
    throw compositionError(
      'INVALID_MARKET_DATA_ROOT',
      'Market data root must be an absolute non-root filesystem path'
    );
  }
  const starBenchDataRoot = options.starBenchDataRoot || path.join(
    path.dirname(options.deviceCenterDataRoot),
    'starbench'
  );
  if (typeof starBenchDataRoot !== 'string' || !path.isAbsolute(starBenchDataRoot) ||
      path.resolve(starBenchDataRoot) === path.parse(path.resolve(starBenchDataRoot)).root) {
    throw compositionError(
      'INVALID_STARBENCH_DATA_ROOT',
      'StarBench data root must be an absolute non-root filesystem path'
    );
  }
  if (options.marketPythonExecutable !== undefined &&
      (typeof options.marketPythonExecutable !== 'string' || options.marketPythonExecutable.trim() === '')) {
    throw compositionError(
      'INVALID_MARKET_PYTHON_EXECUTABLE',
      'Market Python executable must be a non-empty explicit command'
    );
  }
  if (options.studyCenterDataRoot !== undefined &&
      (typeof options.studyCenterDataRoot !== 'string' || !path.isAbsolute(options.studyCenterDataRoot) ||
       path.resolve(options.studyCenterDataRoot) === path.parse(path.resolve(options.studyCenterDataRoot)).root)) {
    throw compositionError(
      'INVALID_STUDY_CENTER_DATA_ROOT',
      'Study Center data root must be an absolute non-root filesystem path'
    );
  }
  const automationCenterDataRoot = options.automationCenterDataRoot || path.join(
    path.dirname(options.deviceCenterDataRoot),
    'automation-center'
  );
  if (typeof automationCenterDataRoot !== 'string' ||
      !path.isAbsolute(automationCenterDataRoot) ||
      path.resolve(automationCenterDataRoot) === path.parse(path.resolve(automationCenterDataRoot)).root) {
    throw compositionError(
      'INVALID_AUTOMATION_CENTER_DATA_ROOT',
      'Automation Center data root must be an absolute non-root filesystem path'
    );
  }
  if (options.marketClientFactory !== undefined && typeof options.marketClientFactory !== 'function') {
    throw compositionError('INVALID_MARKET_CLIENT_FACTORY', 'Market client factory must be a function');
  }
  if (options.studyCenterApplication !== undefined &&
      (typeof options.studyCenterApplication?.start !== 'function' ||
       typeof options.studyCenterApplication?.stop !== 'function' ||
       typeof options.studyCenterApplication?.getReadiness !== 'function' ||
       typeof options.studyCenterApplication?.getHomeSummary !== 'function')) {
    throw compositionError('INVALID_STUDY_CENTER_APPLICATION', 'Study Center application must expose its lifecycle contract');
  }
  if (options.persistModuleControlPreferences !== undefined &&
      typeof options.persistModuleControlPreferences !== 'function') {
    throw compositionError(
      'INVALID_MODULE_CONTROL_PERSISTENCE',
      'Module control persistence must be a function when provided'
    );
  }
}

function validateTodayTomorrowPublicApi(publicApi) {
  if (publicApi?.TODAY_TOMORROW_PUBLIC_API_VERSION !== '0.1.0' ||
      typeof publicApi.createTodayTomorrowApplication !== 'function' ||
      publicApi.CALENDAR_HOME_WIDGET_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi.createCalendarHomeWidgetAdapter !== 'function' ||
      publicApi.CALENDAR_HOME_SUMMARY_CONTRACT_VERSION !== '0.2.0' ||
      typeof publicApi.createCalendarHomeSummaryAdapter !== 'function' ||
      publicApi.CALENDAR_LOCAL_AI_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi.createCalendarLocalAiAdapter !== 'function') {
    throw compositionError(
      'INVALID_TODAY_TOMORROW_PUBLIC_API',
      'Today/Tomorrow Public API V0.1.0 is required'
    );
  }
}

function validateDashiPublicApi(publicApi) {
  const contract = publicApi?.DASHI_DESKTOP_ENTRY_CONTRACT;
  const methods = [
    'getSourceHealth', 'getBoardOverview', 'listProjects', 'getProjectDetail', 'listTasks',
    'getTaskDetail', 'getTaskExecutionContext'
  ];
  if (publicApi?.DASHI_APPLICATION_API_VERSION !== '0.1' ||
      typeof publicApi.createDashiReadApplication !== 'function' ||
      contract?.moduleId !== 'dashi' || contract?.handoffVersion !== '0.1' ||
      contract?.applicationApiVersion !== '0.1' || contract?.access !== 'READ_ONLY' ||
      contract?.facade !== 'STABLE_NEXA_READ_FACADE' || contract?.homepageWidgetRequired !== false ||
      !Array.isArray(contract?.pushChannels) || contract.pushChannels.length !== 0 ||
      !Array.isArray(contract?.methods) || contract.methods.length !== methods.length ||
      !methods.every((method, index) => contract.methods[index] === method)) {
    throw compositionError('INVALID_DASHI_PUBLIC_API', 'Dashi Desktop Entry Handoff V0.1 is required');
  }
}

function validateDeviceCenterPublicApi(publicApi) {
  if (publicApi?.DEVICE_CENTER_PUBLIC_API_VERSION !== '0.1' ||
      typeof publicApi.createDeviceCenterApplication !== 'function') {
    throw compositionError(
      'INVALID_DEVICE_CENTER_PUBLIC_API',
      'Device Center Public API V0.1 is required'
    );
  }
}

function validateDeviceCenterHomeSummaryPublicApi(publicApi) {
  if (publicApi?.HOME_DEVICE_NETWORK_SUMMARY_CONTRACT_VERSION !== '0.1.0' ||
      typeof publicApi.createHomeDeviceNetworkSummaryAdapter !== 'function' ||
      typeof publicApi.validateHomeDeviceNetworkSummary !== 'function') {
    throw compositionError(
      'INVALID_DEVICE_HOME_SUMMARY_PUBLIC_API',
      'Home Device/Network Summary Public Contract V0.1.0 is required'
    );
  }
  return publicApi;
}

function validateDeviceCenterApplication(application) {
  for (const method of DEVICE_CENTER_APPLICATION_METHODS) {
    if (typeof application?.[method] !== 'function') {
      throw compositionError(
        'INVALID_DEVICE_CENTER_APPLICATION',
        `Device Center application is missing method: ${method}`
      );
    }
  }
}

async function loadDeviceCenterApplication(loader, dataRoot) {
  try {
    const publicApi = await loader.load(DEVICE_CENTER_PUBLIC_API_ENTRYPOINT);
    validateDeviceCenterPublicApi(publicApi);
    const application = publicApi.createDeviceCenterApplication({ dataRoot });
    validateDeviceCenterApplication(application);
    return Object.freeze({
      application,
      status: Object.freeze({ ready: true, code: 'READY', publicApiVersion: '0.1' })
    });
  } catch (error) {
    const code = [
      'INVALID_DEVICE_CENTER_PUBLIC_API',
      'INVALID_DEVICE_CENTER_APPLICATION'
    ].includes(error?.code) ? error.code : 'DEVICE_CENTER_PUBLIC_API_UNAVAILABLE';
    return Object.freeze({
      application: createUnavailableNexaDeviceCenterApplication(code),
      status: Object.freeze({
        ready: false,
        code,
        publicApiVersion: '0.1'
      })
    });
  }
}

async function loadDeviceCenterHomeSummaryAdapter(loader, options = {}) {
  try {
    const publicApi = validateDeviceCenterHomeSummaryPublicApi(
      await loader.load(DEVICE_CENTER_HOME_SUMMARY_ENTRYPOINT)
    );
    const adapter = publicApi.createHomeDeviceNetworkSummaryAdapter({
      deviceApi: options.deviceApi,
      connectedDeviceReader: options.connectedDeviceReader,
      clock: options.clock
    });
    if (!adapter || typeof adapter.getHomeSummary !== 'function' || Object.keys(adapter).length !== 1) {
      throw compositionError('INVALID_DEVICE_HOME_SUMMARY_ADAPTER', 'Home Device/Network adapter is invalid');
    }
    return Object.freeze({ adapter, status: Object.freeze({ ready: true, code: 'READY' }) });
  } catch (error) {
    const code = ['INVALID_DEVICE_HOME_SUMMARY_PUBLIC_API', 'INVALID_DEVICE_HOME_SUMMARY_ADAPTER'].includes(error?.code)
      ? error.code
      : 'DEVICE_HOME_SUMMARY_PUBLIC_API_UNAVAILABLE';
    return Object.freeze({ adapter: null, status: Object.freeze({ ready: false, code }) });
  }
}

async function loadCreatorOpsApplication(loader, injectedApplication, clock) {
  try {
    const publicApi = validateCreatorOpsPublicApi(await loader.load(CREATOR_OPS_PUBLIC_API_ENTRYPOINT));
    const application = validateCreatorOpsApplication(
      injectedApplication === undefined ? publicApi.createCreatorOpsUIHost() : injectedApplication
    );
    const homeWidgetAdapter = publicApi.createCreatorOpsHomeWidgetAdapter({
      creatorOpsHost: application,
      clock
    });
    return Object.freeze({
      publicApi,
      application,
      homeWidgetAdapter,
      status: Object.freeze({ ready: true, code: 'READY', publicApiVersion: '0.2' })
    });
  } catch (error) {
    const code = ['INVALID_CREATOR_OPS_PUBLIC_API', 'INVALID_CREATOR_OPS_APPLICATION'].includes(error?.code)
      ? error.code
      : 'CREATOR_OPS_PUBLIC_API_UNAVAILABLE';
    return Object.freeze({
      application: createUnavailableNexaCreatorOpsApplication(code),
      homeWidgetAdapter: null,
      status: Object.freeze({ ready: false, code, publicApiVersion: '0.2' })
    });
  }
}

function validateConsumptionPackage(publicApi, integrationPackage) {
  if (publicApi?.CONSUMPTION_PUBLIC_API_VERSION !== '0.3') {
    throw compositionError('UNSUPPORTED_CONSUMPTION_PUBLIC_API', 'Consumption Public API V0.3 is required');
  }
  for (const exportName of [
    'assertRepositoryContract',
    'createExpenseQueryService',
    'createConsumptionHomeWidgetAdapter',
    'createExpenseCandidateIngestionService',
    'createExpenseImportService',
    'createExpenseExportService',
    'createJsonFileExpenseRepository'
  ]) {
    if (typeof publicApi[exportName] !== 'function') {
      throw compositionError('INVALID_CONSUMPTION_PUBLIC_API', `missing Consumption export: ${exportName}`);
    }
  }

  const manifest = integrationPackage?.CONSUMPTION_INTEGRATION_MANIFEST;
  const descriptor = integrationPackage?.CONSUMPTION_MODULE_DESCRIPTOR;
  if (
    !Object.isFrozen(manifest)
    || manifest.moduleId !== 'consumption'
    || manifest.publicApi?.entry !== CONSUMPTION_PUBLIC_API_ENTRYPOINT
    || manifest.publicApi?.version !== '0.3'
    || manifest.packageEntry !== CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT
    || descriptor?.moduleId !== 'consumption'
    || manifest.descriptor !== descriptor
    || typeof integrationPackage.createConsumptionController !== 'function'
    || typeof integrationPackage.createConsumptionIpcHandlers !== 'function'
  ) {
    throw compositionError(
      'INVALID_CONSUMPTION_INTEGRATION_PACKAGE',
      'Consumption Integration Package does not match its frozen Core contract'
    );
  }
}

function createLegacyDeviceControllerFactory(reader) {
  return () => createNexaModuleController({
    start() {},
    stop() {},
    getSnapshot() {
      return reader.getSnapshot();
    },
    execute() {
      throw new LegacyDeviceSnapshotBridgeError(
        'UNSUPPORTED_COMMAND',
        'legacy device snapshot bridge exposes no commands'
      );
    }
  });
}

function safeCode(value, fallback = 'CONSUMPTION_REQUEST_FAILED') {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
}

function safePrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
}

function projectFields(source, fields) {
  if (!isPlainObject(source)) return Object.freeze({});
  const result = {};
  for (const field of fields) {
    const value = safePrimitive(source[field]);
    if (value !== undefined) result[field] = value;
  }
  return Object.freeze(result);
}

function projectCanonicalRecord(record) {
  return projectFields(record, CANONICAL_RECORD_FIELDS);
}

function projectIssueList(issues) {
  if (!Array.isArray(issues)) return Object.freeze([]);
  return Object.freeze(issues.map((issue) => Object.freeze({
    code: safeCode(issue?.code, 'CONSUMPTION_RESULT_ISSUE')
  })));
}

function projectBreakdown(rows) {
  if (!Array.isArray(rows)) return Object.freeze([]);
  return Object.freeze(rows.map((row) => projectFields(row, [
    'key', 'period', 'count', 'expenseCents', 'incomeCents', 'netCents'
  ])));
}

function projectStatistics(value) {
  return Object.freeze({
    filters: projectFields(value?.filters, [
      'from', 'to', 'startDate', 'endDate', 'category', 'merchant', 'platform', 'direction'
    ]),
    totals: projectFields(value?.totals, [
      'count', 'totalExpenseCents', 'totalIncomeCents', 'netCents'
    ]),
    categoryBreakdown: projectBreakdown(value?.categoryBreakdown),
    merchantBreakdown: projectBreakdown(value?.merchantBreakdown),
    platformBreakdown: projectBreakdown(value?.platformBreakdown),
    dailySeries: projectBreakdown(value?.dailySeries),
    monthlySeries: projectBreakdown(value?.monthlySeries)
  });
}

function projectImportResult(value) {
  return Object.freeze({
    ok: value?.ok === true,
    importedCount: Number.isSafeInteger(value?.importedCount) ? value.importedCount : 0,
    updatedCount: Number.isSafeInteger(value?.updatedCount) ? value.updatedCount : 0,
    duplicateCount: Number.isSafeInteger(value?.duplicateCount) ? value.duplicateCount : 0,
    rejectedCount: Number.isSafeInteger(value?.rejectedCount) ? value.rejectedCount : 0,
    errors: projectIssueList(value?.errors)
  });
}

function projectExportResult(value) {
  if (value?.ok !== true || typeof value.jsonText !== 'string') {
    throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'Consumption export result was malformed');
  }
  let document;
  try {
    document = JSON.parse(value.jsonText);
  } catch {
    throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'Consumption export JSON was malformed');
  }
  if (!isPlainObject(document) || !Array.isArray(document.records)) {
    throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'Consumption export document was malformed');
  }
  const records = document.records.map(projectCanonicalRecord);
  const byDedupeKey = {};
  for (const record of records) {
    if (typeof record.dedupeKey === 'string') byDedupeKey[record.dedupeKey] = true;
  }
  const projectedDocument = {
    version: 1,
    records,
    byDedupeKey
  };
  if (typeof document.updatedAt === 'string') projectedDocument.updatedAt = document.updatedAt;
  return Object.freeze({
    ok: true,
    jsonText: JSON.stringify(projectedDocument, null, 2),
    exportedCount: records.length
  });
}

function projectCommandValue(commandType, value) {
  if (commandType === 'query') {
    if (!Array.isArray(value)) throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'query result was malformed');
    return Object.freeze(value.map(projectCanonicalRecord));
  }
  if (commandType === 'recent') {
    if (!Array.isArray(value)) throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'recent result was malformed');
    return Object.freeze(value.map((record) => projectFields(record, [
      'id', 'occurredAt', 'amountCents', 'direction', 'merchant', 'category', 'platform'
    ])));
  }
  if (commandType === 'statistics') return projectStatistics(value);
  if (commandType === 'ingest-candidate') {
    return Object.freeze({
      accepted: value?.accepted === true,
      record: projectCanonicalRecord(value?.record),
      operation: typeof value?.operation === 'string' ? value.operation : 'unknown',
      duplicate: value?.duplicate === true,
      errors: projectIssueList(value?.errors),
      issues: projectIssueList(value?.issues)
    });
  }
  if (commandType === 'import-legacy') return projectImportResult(value);
  if (commandType === 'export-legacy') return projectExportResult(value);
  const projectMobileDraft = (draft) => projectFields(draft, [
    'draftId', 'status', 'receivedAt', 'occurredAt', 'amountCents', 'currency', 'merchant',
    'direction', 'category', 'platform', 'sourceApplication', 'confidence', 'parserVersion', 'lastActionAt',
    'confirmedRecordId', 'importMode', 'resolution', 'mergedIntoDraftId', 'canEdit', 'canConfirm', 'canIgnore', 'canMerge', 'canUndo', 'canRemove',
    'occurredAtEpochMs', 'evidenceCount', 'sourceApplications', 'classificationSource', 'changeHistory'
  ]);
  if (commandType === 'list-mobile-drafts') {
    if (!Array.isArray(value)) throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'mobile draft list was malformed');
    return Object.freeze(value.map(projectMobileDraft));
  }
  if (commandType === 'create-mobile-draft') {
    return Object.freeze({
      created: value?.created === true,
      duplicate: value?.duplicate === true,
      draft: projectMobileDraft(value?.draft)
    });
  }
  if (commandType === 'auto-import-mobile-draft') {
    return Object.freeze({
      created: value?.created === true,
      imported: value?.imported === true,
      skipped: value?.skipped === true,
      duplicate: value?.duplicate === true,
      draft: projectMobileDraft(value?.draft),
      record: isPlainObject(value?.record) ? projectCanonicalRecord(value.record) : null
    });
  }
  if (commandType === 'auto-import-pending-mobile-drafts') {
    return Object.freeze({
      attempted: Number.isSafeInteger(value?.attempted) ? value.attempted : 0,
      imported: Number.isSafeInteger(value?.imported) ? value.imported : 0,
      duplicates: Number.isSafeInteger(value?.duplicates) ? value.duplicates : 0,
      failed: Number.isSafeInteger(value?.failed) ? value.failed : 0,
      remainingPending: Number.isSafeInteger(value?.remainingPending) ? value.remainingPending : 0,
      failures: projectIssueList(value?.failures)
    });
  }
  if (['update-mobile-draft', 'ignore-mobile-draft', 'undo-mobile-draft'].includes(commandType)) {
    return projectMobileDraft(value);
  }
  if (commandType === 'merge-mobile-drafts') {
    return Object.freeze({
      canonical: projectMobileDraft(value?.canonical),
      evidence: projectMobileDraft(value?.evidence)
    });
  }
  if (commandType === 'confirm-mobile-draft') {
    return Object.freeze({
      draft: projectMobileDraft(value?.draft),
      record: projectCanonicalRecord(value?.record),
      duplicate: value?.duplicate === true
    });
  }
  if (commandType === 'remove-record') {
    return Object.freeze({
      removed: value?.removed === true,
      alreadyMissing: value?.alreadyMissing === true,
      recordId: typeof value?.recordId === 'string' ? value.recordId : '',
      linkedDraftCount: Number.isSafeInteger(value?.linkedDraftCount) ? value.linkedDraftCount : 0
    });
  }
  if (commandType === 'reclassify-record') {
    return Object.freeze({
      changed: value?.changed === true,
      recordId: typeof value?.recordId === 'string' ? value.recordId : '',
      previousCategory: typeof value?.previousCategory === 'string' ? value.previousCategory : '',
      category: typeof value?.category === 'string' ? value.category : '',
      record: projectCanonicalRecord(value?.record)
    });
  }
  throw compositionError('UNSAFE_CONSUMPTION_RESULT', 'unknown Consumption command result');
}

function projectConsumptionEnvelope(envelope, commandType) {
  if (envelope?.ok !== true) {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: safeCode(envelope?.error?.code),
        message: 'Consumption request failed'
      })
    });
  }
  try {
    return Object.freeze({ ok: true, value: projectCommandValue(commandType, envelope.value) });
  } catch {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: 'UNSAFE_CONSUMPTION_RESULT',
        message: 'Consumption request failed'
      })
    });
  }
}

async function loadPublicApiOrUnavailable(
  loader,
  entrypoint,
  createUnavailable,
  { allowMissingDependency = false } = {}
) {
  if (!existsSync(entrypoint)) return createUnavailable();
  try {
    return await loader.load(entrypoint);
  } catch (error) {
    if (allowMissingDependency &&
        error?.code === 'ESM_IMPORT_FAILED' && error?.cause?.code === 'ERR_MODULE_NOT_FOUND') {
      return createUnavailable();
    }
    throw error;
  }
}

async function createNexaAppComposition(options = {}) {
  validateOptions(options);

  const loader = createNexaEsmPublicApiLoader({
    allowedEntrypoints: [
      CONSUMPTION_PUBLIC_API_ENTRYPOINT,
      CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT,
      TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT,
      DASHI_DESKTOP_ENTRYPOINT,
      DEVICE_CENTER_PUBLIC_API_ENTRYPOINT,
      DEVICE_CENTER_HOME_SUMMARY_ENTRYPOINT,
      CREATOR_OPS_PUBLIC_API_ENTRYPOINT,
      STARBENCH_DESKTOP_ENTRYPOINT,
      STUDY_CENTER_PUBLIC_API_ENTRYPOINT,
      AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT
    ]
  });
  const [publicApi, integrationPackage, todayTomorrowPublicApi, dashiPublicApi, starBenchPublicApi, studyCenterPublicApi, automationCenterPublicApi] = await Promise.all([
    loader.load(CONSUMPTION_PUBLIC_API_ENTRYPOINT),
    loader.load(CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT),
    loader.load(TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT),
    loadPublicApiOrUnavailable(loader, DASHI_DESKTOP_ENTRYPOINT, createUnavailableNexaDashiPublicApi),
    loader.load(STARBENCH_DESKTOP_ENTRYPOINT),
    loadPublicApiOrUnavailable(
      loader,
      STUDY_CENTER_PUBLIC_API_ENTRYPOINT,
      createUnavailableNexaStudyCenterPublicApi,
      { allowMissingDependency: true }
    ),
    loadPublicApiOrUnavailable(
      loader,
      AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT,
      createUnavailableNexaAutomationCenterPublicApi
    )
  ]);
  validateConsumptionPackage(publicApi, integrationPackage);
  validateTodayTomorrowPublicApi(todayTomorrowPublicApi);
  validateDashiPublicApi(dashiPublicApi);
  validateStarBenchPublicApi(starBenchPublicApi);
  validateStudyCenterPublicApi(studyCenterPublicApi);
  validateAutomationCenterPublicApi(automationCenterPublicApi);
  const deviceCenterLoad = options.deviceCenterApplication === undefined
    ? await loadDeviceCenterApplication(loader, options.deviceCenterDataRoot)
    : Object.freeze({
        application: options.deviceCenterApplication,
        status: Object.freeze({ ready: true, code: 'READY', publicApiVersion: '0.1' })
      });
  validateDeviceCenterApplication(deviceCenterLoad.application);
  const creatorOpsLoad = await loadCreatorOpsApplication(
    loader,
    options.creatorOpsApplication,
    options.clock
  );
  const mobilePairingApplication = options.mobilePairingApplication || createUnavailableMobilePairingApplication();
  const deviceCenterHomeSummaryLoad = await loadDeviceCenterHomeSummaryAdapter(loader, {
    deviceApi: deviceCenterLoad.application,
    clock: options.clock,
    connectedDeviceReader: async () => {
      const response = await mobilePairingApplication.listDevices();
      const devices = response?.ok === true && Array.isArray(response.value) ? response.value : response;
      if (!Array.isArray(devices)) return response;
      return devices.map((device) => Object.freeze({
        display_name: device?.display_name || device?.device_name || '已配对设备',
        device_type_label: device?.device_type_label || device?.device_type || '配对设备',
        device_category: device?.device_category || 'unknown',
        connection_status: device?.connection_state,
        paired: device?.paired === true,
        last_activity_at: device?.last_authenticated_at || device?.paired_at || null,
        safe_identifier: /^[a-f0-9]{24}$/i.test(String(device?.device_ref || ''))
          ? `设备-${String(device.device_ref).slice(0, 8).toUpperCase()}`
          : typeof device?.device_id_summary === 'string' && device.device_id_summary.includes('…')
            ? device.device_id_summary
            : null
      }));
    }
  });

  const repository = publicApi.createJsonFileExpenseRepository(options.consumptionRepositoryPath);
  publicApi.assertRepositoryContract(repository);
  const consumptionQueryService = publicApi.createExpenseQueryService(repository);
  const consumptionHomeWidgetAdapter = publicApi.createConsumptionHomeWidgetAdapter(
    consumptionQueryService,
    { now: options.clock }
  );
  const legacyReader = createLegacyDeviceSnapshotReader({
    getDeviceSnapshot: options.getDeviceSnapshot,
    getHubStats: options.getHubStats,
    getServiceStatusSnapshot: options.getServiceStatusSnapshot,
    now: options.now
  });
  const consumptionDescriptor = Object.freeze({
    ...integrationPackage.CONSUMPTION_MODULE_DESCRIPTOR,
    invokeChannels: Object.freeze([
      ...integrationPackage.CONSUMPTION_MODULE_DESCRIPTOR.invokeChannels,
      'nexa:consumption:get-home-summary'
    ])
  });
  const registry = createNexaModuleRegistry([
    NEXA_CORE_CONTROL_DESCRIPTOR,
    NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR,
    NEXA_AUTOMATION_CENTER_DESCRIPTOR,
    MOBILE_PAIRING_DESCRIPTOR,
    LEGACY_DEVICE_MODULE_DESCRIPTOR,
    consumptionDescriptor,
    NEXA_GLOBAL_COMMAND_DESCRIPTOR,
    NEXA_TODAY_TOMORROW_DESCRIPTOR,
    NEXA_DASHI_DESCRIPTOR,
    NEXA_DEVICE_CENTER_DESCRIPTOR,
    NEXA_CREATOR_OPS_DESCRIPTOR,
    NEXA_MARKET_DESCRIPTOR,
    NEXA_STARBENCH_DESCRIPTOR,
    NEXA_STUDY_CENTER_DESCRIPTOR
  ], EMPTY_CONTEXT);
  const sharedLocalAiProvider = options.calendarLocalAiProvider || Object.freeze({
    getState: () => Object.freeze({ status: 'unconfigured', configured: false, can_propose: false }),
    generateProposal: async () => {
      throw Object.assign(new Error('Shared Local AI Provider is not configured'), { code: 'AI_CONFIGURATION_INCOMPLETE' });
    }
  });
  let control;
  const todayTomorrowController = createNexaTodayTomorrowController({
    publicApi: todayTomorrowPublicApi,
    dataRoot: options.todayTomorrowDataRoot,
    timezone: options.timezone,
    clock: options.clock,
    localAiProvider: sharedLocalAiProvider,
    localAiUndoExecutor: options.calendarLocalAiUndoExecutor
  });
  let globalCommandRuntime;
  const controllerFactories = {
    'core-control': () => createNexaCoreControlController(() => control),
    'local-resource-path': () => createNexaLocalResourcePathController(),
    'automation-center': () => createNexaAutomationCenterController({
      publicApi: automationCenterPublicApi,
      dataRoot: options.automationCenterDataRoot || path.join(
        path.dirname(options.deviceCenterDataRoot),
        'automation-center'
      ),
      intervalMs: options.automationCenterIntervalMs,
      setIntervalFn: options.automationCenterSetInterval,
      clearIntervalFn: options.automationCenterClearInterval,
      now: options.automationCenterNow
    }),
    'legacy-device': createLegacyDeviceControllerFactory(legacyReader),
    'global-command': () => createNexaGlobalCommandController(globalCommandRuntime),
    consumption: () => integrationPackage.createConsumptionController({
      repository,
      mobileDraftFilePath: path.join(
        path.dirname(options.consumptionRepositoryPath),
        'mobile-expense-drafts.json'
      ),
      now: options.clock,
      localAiProvider: sharedLocalAiProvider,
      timezone: options.timezone
    }),
    dashi: () => createNexaDashiReadController({ publicApi: dashiPublicApi }),
    starbench: () => createNexaStarBenchController({
      publicApi: starBenchPublicApi,
      dataRoot: options.starBenchDataRoot || path.join(path.dirname(options.deviceCenterDataRoot), 'starbench'),
      readers: options.starBenchReaders
    }),
    'study-center': () => createNexaStudyCenterController({
      publicApi: studyCenterPublicApi,
      dataRoot: options.studyCenterDataRoot,
      application: options.studyCenterApplication
    }),
    'today-tomorrow': () => todayTomorrowController
  };
  controllerFactories['mobile-pairing'] = () => createMobilePairingController(mobilePairingApplication);
  controllerFactories['device-center'] = () => createNexaDeviceCenterController(deviceCenterLoad.application);
  controllerFactories['creator-ops'] = () => createNexaCreatorOpsController({
    application: creatorOpsLoad.application
  });
  controllerFactories.market = () => createNexaMarketController({
    pythonExecutable: options.marketPythonExecutable || 'python',
    moduleRoot: MARKET_MODULE_ROOT,
    dataRoot: options.marketDataRoot || path.join(path.dirname(options.deviceCenterDataRoot), 'market'),
    timezone: options.timezone,
    runtimeMode: options.marketRuntimeMode || 'EMPTY',
    clientFactory: options.marketClientFactory
  });
  const binding = createNexaControllerBinding(registry, controllerFactories);
  const host = createNexaShellHost(binding);
  control = createNexaModuleControl({
    moduleIds: [
      'automation-center', 'consumption', 'creator-ops', 'dashi', 'device-center', 'legacy-device', 'market', 'starbench',
      'study-center', 'today-tomorrow'
    ],
    host,
    readinessByModuleId: Object.freeze({
      'device-center': deviceCenterLoad.status,
      ...(creatorOpsLoad.status.ready ? {} : { 'creator-ops': creatorOpsLoad.status })
    }),
    preferences: options.moduleControlPreferences,
    persist: options.persistModuleControlPreferences
  });
  globalCommandRuntime = createProductionNexaGlobalCommandRuntime({
    composition: { control, todayTomorrow: todayTomorrowController },
    provider: sharedLocalAiProvider,
    clock: options.clock,
    timezone: options.timezone,
    auditLog: options.commandAuditLog,
    runtimeCoordinator: options.localAiRuntimeCoordinator
  });
  const coreControlHandlers = createNexaCoreControlIpcHandlers(host, {
    toggleWindowMaximize: options.toggleWindowMaximize
  });
  const localResourcePathHandlers = createNexaLocalResourcePathIpcHandlers({
    showOpenDialog: options.showLocalResourceDialog,
    lstat: options.lstatLocalResourcePath
  });
  const mobilePairingHandlers = createMobilePairingIpcHandlers(mobilePairingApplication, host);
  const consumptionHandlers = integrationPackage.createConsumptionIpcHandlers(host);
  const consumptionHomeWidgetHandlers = createNexaConsumptionHomeWidgetIpcHandlers({
    control,
    adapter: consumptionHomeWidgetAdapter
  });
  const dashiHandlers = createNexaDashiReadIpcHandlers(control);
  const todayTomorrowHandlers = createNexaTodayTomorrowIpcHandlers(control, todayTomorrowController);
  const deviceCenterHandlers = createNexaDeviceCenterIpcHandlers(control, {
    homeSummaryAdapter: deviceCenterHomeSummaryLoad.adapter
  });
  const creatorOpsHandlers = createNexaCreatorOpsIpcHandlers(control, {
    openEndpoint: options.openCreatorOpsEndpoint,
    homeWidgetAdapter: creatorOpsLoad.homeWidgetAdapter
  });
  const marketHandlers = createNexaMarketIpcHandlers(control);
  const starBenchHandlers = createNexaStarBenchIpcHandlers(control);
  const studyCenterHandlers = createNexaStudyCenterIpcHandlers(control);
  const automationCenterHandlers = createNexaAutomationCenterIpcHandlers(control);
  const globalCommandHandlers = createNexaGlobalCommandIpcHandlers(globalCommandRuntime, options.localSpeechToTextProvider);
  const registrationPlan = createNexaIpcRegistrationPlan(registry, {
    ...coreControlHandlers,
    ...localResourcePathHandlers,
    ...mobilePairingHandlers,
    ...consumptionHomeWidgetHandlers,
    ...dashiHandlers,
    ...todayTomorrowHandlers,
    ...deviceCenterHandlers,
    ...creatorOpsHandlers,
    ...marketHandlers,
    ...starBenchHandlers,
    ...studyCenterHandlers,
    ...automationCenterHandlers,
    ...globalCommandHandlers,
    'nexa:legacy-device:getSnapshot': async () => {
      await control.startModule('legacy-device');
      return control.getModuleSnapshot('legacy-device');
    },
    'nexa:consumption:get-snapshot': async (...args) => {
      await control.startModule('consumption');
      return consumptionHandlers['nexa:consumption:get-snapshot'](...args);
    },
    'nexa:consumption:execute': async (...args) => {
      await control.startModule('consumption');
      const envelope = await consumptionHandlers['nexa:consumption:execute'](...args);
      return projectConsumptionEnvelope(envelope, args[1]?.type);
    }
  });

  const composition = {
    control,
    host,
    todayTomorrow: todayTomorrowController,
    registrationPlan,
    deviceCenterStatus: deviceCenterLoad.status
  };
  Object.defineProperty(composition, 'globalCommand', { value: globalCommandRuntime, enumerable: false });
  Object.defineProperty(composition, 'deviceCenterApplication', {
    value: deviceCenterLoad.application,
    enumerable: false
  });
  return Object.freeze(composition);
}

module.exports = {
  AUTOMATION_CENTER_PRODUCTION_COMPOSITION_ENTRYPOINT,
  CONSUMPTION_INTEGRATION_PACKAGE_ENTRYPOINT,
  CONSUMPTION_PUBLIC_API_ENTRYPOINT,
  CREATOR_OPS_PUBLIC_API_ENTRYPOINT,
  DASHI_DESKTOP_ENTRYPOINT,
  DASHI_PUBLIC_API_ENTRYPOINT,
  DEVICE_CENTER_PUBLIC_API_ENTRYPOINT,
  DEVICE_CENTER_HOME_SUMMARY_ENTRYPOINT,
  MARKET_MODULE_ROOT,
  STARBENCH_DESKTOP_ENTRYPOINT,
  STUDY_CENTER_PUBLIC_API_ENTRYPOINT,
  TODAY_TOMORROW_PUBLIC_API_ENTRYPOINT,
  NexaAppCompositionError,
  createNexaAppComposition,
  loadCreatorOpsApplication,
  loadDeviceCenterApplication,
  loadDeviceCenterHomeSummaryAdapter,
  resolveNexaRoot,
  validateDeviceCenterHomeSummaryPublicApi,
  validateDeviceCenterPublicApi
};
