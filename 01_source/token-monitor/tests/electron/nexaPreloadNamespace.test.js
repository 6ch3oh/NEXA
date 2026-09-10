'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const MAIN_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'main.js');
const PRELOAD_PATH = path.join(PROJECT_ROOT, 'src', 'electron', 'preload.js');

const mainSource = fs.readFileSync(MAIN_PATH, 'utf8');
const preloadSource = fs.readFileSync(PRELOAD_PATH, 'utf8');

const EXPECTED_LEGACY_ROOT_MEMBERS = [
  'checkAppUpdateNow',
  'checkTokscaleNpm',
  'claude',
  'clearSessionUsageArchive',
  'close',
  'codex',
  'collapseFloatingBubbleIfIdle',
  'copilot',
  'copyText',
  'cursor',
  'dashboard',
  'dismissAppUpdate',
  'downloadAppUpdate',
  'downloadTokscaleFromNpm',
  'expandFloatingBubble',
  'expense',
  'exportNow',
  'getAppInfo',
  'getAppUpdateState',
  'getDashboardHistory',
  'getHubInfo',
  'getServiceStatus',
  'getSessionDetail',
  'getSettings',
  'getStats',
  'getStreamStatus',
  'getTokscaleStatus',
  'installAppUpdate',
  'lookupModelPricing',
  'mimo',
  'minimize',
  'moveFloatingBubble',
  'notionTodo',
  'ollama',
  'onAppUpdatePush',
  'onDashboardHistoryChanged',
  'onFloatingBubbleState',
  'onHubPush',
  'onOpenSettings',
  'onOpenView',
  'onSettingsPush',
  'onStatsPush',
  'onTokscalePush',
  'opencode',
  'openDashboard',
  'openExternal',
  'openrouter',
  'openUserData',
  'peekFloatingBubble',
  'pickExportDir',
  'previewAppearance',
  'regenerateHubSecret',
  'resetTokscaleToBundled',
  'setFloatingBubbleCollapsedSize',
  'setTrayIcons',
  'setViewState',
  'signalContentReady',
  'thirdparty',
  'updateSettings'
].sort();

function exposePreloadApi() {
  let exposedName;
  let exposedApi;
  const ipcCalls = [];
  const ipcRenderer = {
    invoke(channel, ...args) {
      ipcCalls.push(['invoke', channel, ...args]);
      return Promise.resolve();
    },
    send(channel) {
      ipcCalls.push(['send', channel]);
    },
    on(channel) {
      ipcCalls.push(['on', channel]);
    },
    removeListener(channel) {
      ipcCalls.push(['removeListener', channel]);
    }
  };
  const sandbox = {
    require(id) {
      assert.equal(id, 'electron', 'preload gained an unexpected top-level dependency');
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposedName = name;
            exposedApi = api;
          }
        },
        ipcRenderer,
        webUtils: {
          getPathForFile(file) {
            if (!file?.diskBacked) return '';
            return file.absolutePath;
          }
        }
      };
    }
  };

  vm.runInNewContext(preloadSource, sandbox, { filename: PRELOAD_PATH });
  assert.equal(exposedName, 'tokenMonitor');
  assert.ok(exposedApi && typeof exposedApi === 'object');
  assert.deepEqual(ipcCalls, [], 'constructing the NEXA namespace triggered IPC');
  return { api: exposedApi, ipcCalls };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function extractStaticChannels(source, receiver, method) {
  const calls = [...source.matchAll(new RegExp(`\\b${receiver}\\.${method}\\s*\\(`, 'g'))];
  const staticCalls = [
    ...source.matchAll(new RegExp(`\\b${receiver}\\.${method}\\s*\\(\\s*(['"])([^'"]+)\\1`, 'g'))
  ];

  assert.equal(staticCalls.length, calls.length, `${receiver}.${method} contains a dynamic channel`);
  return sortedUnique(staticCalls.map((match) => match[2]));
}

function legacyRootMembers(rootMembers) {
  return sortedUnique(rootMembers.filter((member) => member !== 'nexa'));
}

test('Preload exposes only the frozen Core control and registered NEXA module surfaces', async () => {
  const { api, ipcCalls } = exposePreloadApi();
  const inheritedEnumerableMembers = [];

  for (const member in api.nexa) {
    inheritedEnumerableMembers.push(member);
  }

  assert.equal(typeof api.nexa, 'object');
  assert.equal(api.nexa, Object(api.nexa));
  assert.equal(Object.isFrozen(api.nexa), true);
  const nexaMembers = [
    'globalCommand', 'control', 'automation-center', 'legacy-device', 'local-resource-path', 'consumption', 'dashi', 'device-center', 'creator-ops', 'market',
    'starbench', 'study-center', 'today-tomorrow', 'mobile-pairing'
  ];
  assert.deepEqual(Object.keys(api.nexa), nexaMembers);
  assert.deepEqual(Object.getOwnPropertyNames(api.nexa), nexaMembers);
  assert.deepEqual(Object.getOwnPropertySymbols(api.nexa), []);
  assert.deepEqual(inheritedEnumerableMembers, nexaMembers);
  assert.equal(Object.isFrozen(api.nexa.control), true);
  assert.deepEqual(Object.keys(api.nexa.control), [
    'getSnapshot', 'setEnabled', 'setAutoStart', 'setAllEnabled', 'setAllAutoStart', 'toggleMaximize'
  ]);
  assert.equal(Object.isFrozen(api.nexa.globalCommand), true);
  assert.deepEqual(Object.keys(api.nexa.globalCommand), [
    'getState', 'getCapabilities', 'submit', 'confirm', 'cancel', 'listHistory', 'clearHistory',
    'reportFeedback', 'listModels', 'selectModel', 'getSpeechState', 'transcribeAudio'
  ]);
  assert.equal(Object.isFrozen(api.nexa['automation-center']), true);
  assert.deepEqual(Object.keys(api.nexa['automation-center']), [
    'capabilities', 'availableAiRoutes', 'listAutomations', 'getAutomation',
    'getAutomationStatus', 'getNextScheduledRun', 'getLatestRun', 'listRecentRuns',
    'createAutomation', 'updateAutomation', 'enableAutomation', 'disableAutomation',
    'archiveAutomation', 'manualRun', 'evaluateSchedules', 'runDueSchedules',
    'retryFailedOccurrence'
  ]);
  assert.equal(Object.isFrozen(api.nexa['legacy-device']), true);
  assert.deepEqual(Object.keys(api.nexa['legacy-device']), ['getSnapshot']);
  assert.equal(typeof api.nexa['legacy-device'].getSnapshot, 'function');
  assert.equal(Object.isFrozen(api.nexa['local-resource-path']), true);
  assert.deepEqual(Object.keys(api.nexa['local-resource-path']), [
    'selectFiles', 'selectDirectory', 'relocateFile', 'relocateDirectory', 'resolveDroppedResources'
  ]);
  assert.equal(Object.isFrozen(api.nexa.consumption), true);
  assert.deepEqual(Object.keys(api.nexa.consumption), ['getSnapshot', 'getHomeSummary', 'execute']);
  assert.equal(typeof api.nexa.consumption.getSnapshot, 'function');
  assert.equal(typeof api.nexa.consumption.getHomeSummary, 'function');
  assert.equal(typeof api.nexa.consumption.execute, 'function');
  assert.equal(Object.isFrozen(api.nexa.dashi), true);
  assert.deepEqual(Object.keys(api.nexa.dashi), [
    'getSourceHealth', 'getBoardOverview', 'listProjects', 'getProjectDetail',
    'listTasks', 'getTaskDetail', 'getTaskExecutionContext'
  ]);
  assert.equal(Object.isFrozen(api.nexa['today-tomorrow']), true);
  assert.equal(Object.isFrozen(api.nexa['device-center']), true);
  assert.deepEqual(Object.keys(api.nexa['device-center']), [
    'getDashboard', 'getOverview', 'getPerformance', 'getNetwork', 'runNetworkProbe', 'getHomeSummary', 'getApplications',
    'getApplicationDetail', 'getHistory', 'getAnomalies', 'getAlerts', 'getDiagnostics',
    'getRecovery', 'ackAlertDelivered', 'ackAlertDismissed'
  ]);
  assert.equal(Object.isFrozen(api.nexa['creator-ops']), true);
  assert.deepEqual(Object.keys(api.nexa['creator-ops']), [
    'start', 'getReadiness', 'getHomeSummary', 'queryWorks', 'executeWorksCommand', 'stop', 'open'
  ]);
  assert.equal(Object.isFrozen(api.nexa.market), true);
  assert.deepEqual(Object.keys(api.nexa.market), [
    'getModuleStatus', 'getDesktopSnapshot', 'getRouteManifest', 'setNavigationState',
    'getMarketHome', 'getWatchlist', 'getPortfolio', 'getInstrumentDetail', 'getResearchCenter',
    'getDecisionJournal', 'listEvidence', 'explainTerm', 'refreshLocalProjection', 'executeAction'
  ]);
  assert.equal(Object.isFrozen(api.nexa.starbench), true);
  assert.deepEqual(Object.keys(api.nexa.starbench), ['start', 'stop', 'getReadiness', 'read']);
  assert.equal(Object.isFrozen(api.nexa['study-center']), true);
  assert.deepEqual(Object.keys(api.nexa['study-center']), ['start', 'stop', 'getReadiness', 'getHomeSummary', 'pronounce']);
  assert.deepEqual(Object.keys(api.nexa['today-tomorrow']), [
    'getHomeSummary', 'getDateSummary', 'getMonthSummary', 'getView', 'parseHomeInput',
    'getLocalAiState', 'checkLocalAiHealth', 'proposeLocalAi', 'confirmLocalAi', 'cancelLocalAi', 'undoLocalAi', 'execute'
  ]);
  assert.equal(Object.isFrozen(api.nexa['mobile-pairing']), true);
  assert.deepEqual(Object.keys(api.nexa['mobile-pairing']), [
    'start', 'status', 'cancel', 'desktopConfirm', 'listDevices', 'revoke', 'certificate',
    'rotateCertificate', 'awareness', 'awarenessAction'
  ]);
  assert.throws(() => {
    api.nexa.example = () => {};
  }, TypeError);
  assert.throws(() => {
    api.nexa['legacy-device'].refresh = () => {};
  }, TypeError);
  await api.nexa.control.getSnapshot();
  await api.nexa.control.setEnabled('consumption', false);
  await api.nexa.control.setAutoStart('consumption', true);
  await api.nexa.control.setAllEnabled(true);
  await api.nexa.control.setAllAutoStart(false);
  await api.nexa.globalCommand.getState();
  await api.nexa.globalCommand.getCapabilities();
  await api.nexa.globalCommand.submit({ request: '打开设备与网络' });
  await api.nexa.globalCommand.confirm('proposal-1', { confirmed: true });
  await api.nexa.globalCommand.cancel('proposal-1');
  await api.nexa.globalCommand.listHistory();
  await api.nexa.globalCommand.clearHistory();
  await api.nexa.globalCommand.reportFeedback('proposal-1', 'rendered');
  await api.nexa.globalCommand.listModels();
  await api.nexa.globalCommand.selectModel('fixture-model');
  await api.nexa.globalCommand.getSpeechState();
  await api.nexa.globalCommand.transcribeAudio({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' });
  await api.nexa['automation-center'].capabilities();
  await api.nexa['automation-center'].availableAiRoutes();
  await api.nexa['automation-center'].listAutomations({ lifecycle: 'ACTIVE' });
  await api.nexa['automation-center'].getAutomation('automation-1');
  await api.nexa['automation-center'].getAutomationStatus('automation-1');
  await api.nexa['automation-center'].getNextScheduledRun('automation-1');
  await api.nexa['automation-center'].getLatestRun('automation-1');
  await api.nexa['automation-center'].listRecentRuns('automation-1', { limit: 10 });
  await api.nexa['automation-center'].createAutomation({ name: 'Daily review' });
  await api.nexa['automation-center'].updateAutomation('automation-1', { name: 'Updated' });
  await api.nexa['automation-center'].enableAutomation('automation-1');
  await api.nexa['automation-center'].disableAutomation('automation-1');
  await api.nexa['automation-center'].archiveAutomation('automation-1');
  await api.nexa['automation-center'].manualRun('automation-1', { requested_by: 'desktop' });
  await api.nexa['automation-center'].evaluateSchedules('2026-09-01T00:00:00.000Z');
  await api.nexa['automation-center'].runDueSchedules('2026-09-01T00:00:00.000Z');
  await api.nexa['automation-center'].retryFailedOccurrence('automation-1');
  await api.nexa['legacy-device'].getSnapshot();
  await api.nexa['local-resource-path'].selectFiles();
  await api.nexa['local-resource-path'].selectFiles({ multiple: true });
  await api.nexa['local-resource-path'].selectDirectory();
  await api.nexa['local-resource-path'].relocateFile();
  await api.nexa['local-resource-path'].relocateDirectory();
  const droppedPath = path.resolve('drop-fixture.txt');
  await api.nexa['local-resource-path'].resolveDroppedResources([
    { diskBacked: true, absolutePath: droppedPath },
    { diskBacked: false }
  ]);
  await api.nexa.consumption.getSnapshot();
  await api.nexa.consumption.getHomeSummary();
  await api.nexa.consumption.execute({ type: 'query', payload: {} });
  await api.nexa.dashi.getSourceHealth();
  await api.nexa.dashi.getBoardOverview();
  await api.nexa.dashi.listProjects();
  await api.nexa.dashi.getProjectDetail('project-1');
  await api.nexa.dashi.listTasks({ filter: 'all' });
  await api.nexa.dashi.getTaskDetail('task-1');
  await api.nexa.dashi.getTaskExecutionContext('task-1');
  await api.nexa['device-center'].getDashboard();
  await api.nexa['device-center'].getOverview();
  await api.nexa['device-center'].getPerformance({ window: 'one_hour' });
  await api.nexa['device-center'].getNetwork();
  await api.nexa['device-center'].runNetworkProbe({ tier: 'light', target_id: 'approved', user_initiated: true });
  await api.nexa['device-center'].getHomeSummary();
  await api.nexa['device-center'].getApplications();
  await api.nexa['device-center'].getApplicationDetail('app-1');
  await api.nexa['device-center'].getHistory({ window: 'one_day' });
  await api.nexa['device-center'].getAnomalies();
  await api.nexa['device-center'].getAlerts({ status: 'pending' });
  await api.nexa['device-center'].getDiagnostics();
  await api.nexa['device-center'].getRecovery();
  await api.nexa['device-center'].ackAlertDelivered('alert-1');
  await api.nexa['device-center'].ackAlertDismissed('alert-2');
  await api.nexa['creator-ops'].getHomeSummary();
  await api.nexa['creator-ops'].queryWorks({ operation: 'list', view: 'recent' });
  await api.nexa['creator-ops'].executeWorksCommand({ operation: 'portfolio', work_id: 'work-1', included: true });
  await api.nexa.market.getModuleStatus();
  await api.nexa.market.getDesktopSnapshot();
  await api.nexa.market.getRouteManifest();
  await api.nexa.market.setNavigationState({ route_id: 'market/watchlist' });
  await api.nexa.market.getMarketHome();
  await api.nexa.market.getWatchlist({ search: 'NEXA' });
  await api.nexa.market.getPortfolio();
  await api.nexa.market.getInstrumentDetail('600519.SH');
  await api.nexa.market.getResearchCenter();
  await api.nexa.market.getDecisionJournal();
  await api.nexa.market.listEvidence({ instrument_id: '600519.SH' });
  await api.nexa.market.explainTerm('PE', '600519.SH');
  await api.nexa.market.refreshLocalProjection();
  await api.nexa.market.executeAction('ADD_WATCHLIST', { instrument_id: '600519.SH' });
  await api.nexa.starbench.start();
  await api.nexa.starbench.stop();
  await api.nexa.starbench.getReadiness();
  await api.nexa.starbench.read('evidence', { limit: 20 });
  await api.nexa['study-center'].start();
  await api.nexa['study-center'].stop();
  await api.nexa['study-center'].getReadiness();
  await api.nexa['study-center'].getHomeSummary();
  await api.nexa['study-center'].pronounce('abandon', 'us');
  await api.nexa['today-tomorrow'].getHomeSummary('2026-08-13');
  await api.nexa['today-tomorrow'].getDateSummary('2026-08-13');
  await api.nexa['today-tomorrow'].getMonthSummary('2026-08-01', '2026-08-31');
  await api.nexa['today-tomorrow'].getView('today', '2026-08-13');
  await api.nexa['today-tomorrow'].parseHomeInput('2026年8月13日下午2:30');
  await api.nexa['today-tomorrow'].checkLocalAiHealth();
  await api.nexa['today-tomorrow'].execute({ type: 'get-task', taskId: 'task-1' });
  await api.nexa['mobile-pairing'].start();
  await api.nexa['mobile-pairing'].status('pairing-1');
  await api.nexa['mobile-pairing'].cancel('pairing-1');
  await api.nexa['mobile-pairing'].desktopConfirm('pairing-1', true);
  await api.nexa['mobile-pairing'].listDevices();
  await api.nexa['mobile-pairing'].revoke('device-ref-1');
  await api.nexa['mobile-pairing'].certificate();
  await api.nexa['mobile-pairing'].rotateCertificate(true);
  assert.deepEqual(JSON.parse(JSON.stringify(ipcCalls)), [
    ['invoke', 'nexa:core-control:get-snapshot'],
    ['invoke', 'nexa:core-control:set-enabled', 'consumption', false],
    ['invoke', 'nexa:core-control:set-auto-start', 'consumption', true],
    ['invoke', 'nexa:core-control:set-all-enabled', true],
    ['invoke', 'nexa:core-control:set-all-auto-start', false],
    ['invoke', 'nexa:global-command:get-state'],
    ['invoke', 'nexa:global-command:get-capabilities'],
    ['invoke', 'nexa:global-command:submit', { request: '打开设备与网络' }],
    ['invoke', 'nexa:global-command:confirm', 'proposal-1', { confirmed: true }],
    ['invoke', 'nexa:global-command:cancel', 'proposal-1'],
    ['invoke', 'nexa:global-command:list-history'],
    ['invoke', 'nexa:global-command:clear-history'],
    ['invoke', 'nexa:global-command:report-feedback', 'proposal-1', 'rendered'],
    ['invoke', 'nexa:global-command:list-models'],
    ['invoke', 'nexa:global-command:select-model', 'fixture-model'],
    ['invoke', 'nexa:global-command:speech-state'],
    ['invoke', 'nexa:global-command:transcribe', { bytes: { 0: 1 }, mimeType: 'audio/webm' }],
    ['invoke', 'nexa:automation-center:capabilities'],
    ['invoke', 'nexa:automation-center:available-ai-routes'],
    ['invoke', 'nexa:automation-center:list-automations', { lifecycle: 'ACTIVE' }],
    ['invoke', 'nexa:automation-center:get-automation', 'automation-1'],
    ['invoke', 'nexa:automation-center:get-automation-status', 'automation-1'],
    ['invoke', 'nexa:automation-center:get-next-scheduled-run', 'automation-1'],
    ['invoke', 'nexa:automation-center:get-latest-run', 'automation-1'],
    ['invoke', 'nexa:automation-center:list-recent-runs', 'automation-1', { limit: 10 }],
    ['invoke', 'nexa:automation-center:create-automation', { name: 'Daily review' }],
    ['invoke', 'nexa:automation-center:update-automation', 'automation-1', { name: 'Updated' }],
    ['invoke', 'nexa:automation-center:enable-automation', 'automation-1'],
    ['invoke', 'nexa:automation-center:disable-automation', 'automation-1'],
    ['invoke', 'nexa:automation-center:archive-automation', 'automation-1'],
    ['invoke', 'nexa:automation-center:manual-run', 'automation-1', { requested_by: 'desktop' }],
    ['invoke', 'nexa:automation-center:evaluate-schedules', '2026-09-01T00:00:00.000Z'],
    ['invoke', 'nexa:automation-center:run-due-schedules', '2026-09-01T00:00:00.000Z'],
    ['invoke', 'nexa:automation-center:retry-failed-occurrence', 'automation-1'],
    ['invoke', 'nexa:legacy-device:getSnapshot'],
    ['invoke', 'nexa:local-resource-path:select', { request_kind: 'file' }],
    ['invoke', 'nexa:local-resource-path:select', { request_kind: 'files' }],
    ['invoke', 'nexa:local-resource-path:select', { request_kind: 'directory' }],
    ['invoke', 'nexa:local-resource-path:select', { request_kind: 'relocate_file' }],
    ['invoke', 'nexa:local-resource-path:select', { request_kind: 'relocate_directory' }],
    ['invoke', 'nexa:local-resource-path:resolve-drop', [droppedPath, '']],
    ['invoke', 'nexa:consumption:get-snapshot'],
    ['invoke', 'nexa:consumption:get-home-summary'],
    ['invoke', 'nexa:consumption:execute', { type: 'query', payload: {} }],
    ['invoke', 'nexa:dashi:get-source-health'],
    ['invoke', 'nexa:dashi:get-board-overview'],
    ['invoke', 'nexa:dashi:list-projects'],
    ['invoke', 'nexa:dashi:get-project-detail', 'project-1'],
    ['invoke', 'nexa:dashi:list-tasks', { filter: 'all' }],
    ['invoke', 'nexa:dashi:get-task-detail', 'task-1'],
    ['invoke', 'nexa:dashi:get-task-execution-context', 'task-1'],
    ['invoke', 'nexa:device-center:get-dashboard'],
    ['invoke', 'nexa:device-center:get-overview'],
    ['invoke', 'nexa:device-center:get-performance', { window: 'one_hour' }],
    ['invoke', 'nexa:device-center:get-network'],
    ['invoke', 'nexa:device-center:run-network-probe', { tier: 'light', target_id: 'approved', user_initiated: true }],
    ['invoke', 'nexa:device-center:get-home-summary'],
    ['invoke', 'nexa:device-center:get-applications'],
    ['invoke', 'nexa:device-center:get-application-detail', 'app-1'],
    ['invoke', 'nexa:device-center:get-history', { window: 'one_day' }],
    ['invoke', 'nexa:device-center:get-anomalies'],
    ['invoke', 'nexa:device-center:get-alerts', { status: 'pending' }],
    ['invoke', 'nexa:device-center:get-diagnostics'],
    ['invoke', 'nexa:device-center:get-recovery'],
    ['invoke', 'nexa:device-center:ack-alert-delivered', 'alert-1'],
    ['invoke', 'nexa:device-center:ack-alert-dismissed', 'alert-2'],
    ['invoke', 'nexa:creator-ops:get-home-summary'],
    ['invoke', 'nexa:creator-ops:works-query', { operation: 'list', view: 'recent' }],
    ['invoke', 'nexa:creator-ops:works-command', { operation: 'portfolio', work_id: 'work-1', included: true }],
    ['invoke', 'nexa:market:get-module-status', {}],
    ['invoke', 'nexa:market:get-desktop-snapshot', {}],
    ['invoke', 'nexa:market:get-route-manifest', {}],
    ['invoke', 'nexa:market:set-navigation-state', { route_id: 'market/watchlist' }],
    ['invoke', 'nexa:market:get-market-home', {}],
    ['invoke', 'nexa:market:get-watchlist', { search: 'NEXA' }],
    ['invoke', 'nexa:market:get-portfolio', {}],
    ['invoke', 'nexa:market:get-instrument-detail', { instrument_id: '600519.SH' }],
    ['invoke', 'nexa:market:get-research-center', {}],
    ['invoke', 'nexa:market:get-decision-journal', {}],
    ['invoke', 'nexa:market:list-evidence', { instrument_id: '600519.SH' }],
    ['invoke', 'nexa:market:explain-term', { term: 'PE', instrument_id: '600519.SH' }],
    ['invoke', 'nexa:market:refresh-local-projection', {}],
    ['invoke', 'nexa:market:execute-action', { action: 'ADD_WATCHLIST', payload: { instrument_id: '600519.SH' } }],
    ['invoke', 'nexa:starbench:start'],
    ['invoke', 'nexa:starbench:stop'],
    ['invoke', 'nexa:starbench:get-readiness'],
    ['invoke', 'nexa:starbench:read', 'evidence', { limit: 20 }],
    ['invoke', 'nexa:study-center:start'],
    ['invoke', 'nexa:study-center:stop'],
    ['invoke', 'nexa:study-center:get-readiness'],
    ['invoke', 'nexa:study-center:get-home-summary'],
    ['invoke', 'nexa:study-center:pronounce', 'abandon', 'us'],
    ['invoke', 'nexa:today-tomorrow:get-home-summary', '2026-08-13'],
    ['invoke', 'nexa:today-tomorrow:get-date-summary', '2026-08-13'],
    ['invoke', 'nexa:today-tomorrow:get-month-summary', '2026-08-01', '2026-08-31'],
    ['invoke', 'nexa:today-tomorrow:get-view', 'today', '2026-08-13'],
    ['invoke', 'nexa:today-tomorrow:parse-home-input', '2026年8月13日下午2:30'],
    ['invoke', 'nexa:today-tomorrow:check-local-ai-health'],
    ['invoke', 'nexa:today-tomorrow:execute', { type: 'get-task', taskId: 'task-1' }],
    ['invoke', 'nexa:mobile-pairing:start'],
    ['invoke', 'nexa:mobile-pairing:status', 'pairing-1'],
    ['invoke', 'nexa:mobile-pairing:cancel', 'pairing-1'],
    ['invoke', 'nexa:mobile-pairing:desktop-confirm', 'pairing-1', true],
    ['invoke', 'nexa:mobile-pairing:list-devices'],
    ['invoke', 'nexa:mobile-pairing:revoke', 'device-ref-1'],
    ['invoke', 'nexa:mobile-pairing:certificate'],
    ['invoke', 'nexa:mobile-pairing:rotate-certificate', true]
  ]);
  assert.deepEqual(Object.keys(api.nexa), nexaMembers);
});

test('Preload keeps the exact 59-member legacy root plus only nexa', () => {
  const { api } = exposePreloadApi();
  const rootMembers = sortedUnique(Object.keys(api));

  assert.equal(rootMembers.length, 60);
  assert.deepEqual(legacyRootMembers(rootMembers), EXPECTED_LEGACY_ROOT_MEMBERS);
  assert.deepEqual(
    rootMembers.filter((member) => !EXPECTED_LEGACY_ROOT_MEMBERS.includes(member)),
    ['nexa'],
    'a non-nexa business root was exposed'
  );
});

test('NEXA namespace adds only static production IPC channels without changing legacy channels', () => {
  const preloadInvokeChannels = extractStaticChannels(preloadSource, 'ipcRenderer', 'invoke');
  const preloadSendChannels = extractStaticChannels(preloadSource, 'ipcRenderer', 'send');
  const preloadPushChannels = extractStaticChannels(preloadSource, 'ipcRenderer', 'on');
  const mainHandleChannels = extractStaticChannels(mainSource, 'ipcMain', 'handle');
  const mainOnChannels = extractStaticChannels(mainSource, 'ipcMain', 'on');
  const allChannels = [
    ...preloadInvokeChannels,
    ...preloadSendChannels,
    ...preloadPushChannels,
    ...mainHandleChannels,
    ...mainOnChannels
  ];

  const legacyInvokeChannels = preloadInvokeChannels.filter((channel) => !channel.startsWith('nexa:'));
  const nexaInvokeChannels = preloadInvokeChannels.filter((channel) => channel.startsWith('nexa:'));

  assert.equal(legacyInvokeChannels.length, 84);
  assert.equal(preloadInvokeChannels.length, 199);
  assert.equal(preloadSendChannels.length, 7);
  assert.equal(preloadPushChannels.length, 14);
  assert.deepEqual(nexaInvokeChannels, [
    'nexa:automation-center:archive-automation',
    'nexa:automation-center:available-ai-routes',
    'nexa:automation-center:capabilities',
    'nexa:automation-center:create-automation',
    'nexa:automation-center:disable-automation',
    'nexa:automation-center:enable-automation',
    'nexa:automation-center:evaluate-schedules',
    'nexa:automation-center:get-automation',
    'nexa:automation-center:get-automation-status',
    'nexa:automation-center:get-latest-run',
    'nexa:automation-center:get-next-scheduled-run',
    'nexa:automation-center:list-automations',
    'nexa:automation-center:list-recent-runs',
    'nexa:automation-center:manual-run',
    'nexa:automation-center:retry-failed-occurrence',
    'nexa:automation-center:run-due-schedules',
    'nexa:automation-center:update-automation',
    'nexa:consumption:execute',
    'nexa:consumption:get-home-summary',
    'nexa:consumption:get-snapshot',
    'nexa:core-control:get-snapshot',
    'nexa:core-control:set-all-auto-start',
    'nexa:core-control:set-all-enabled',
    'nexa:core-control:set-auto-start',
    'nexa:core-control:set-enabled',
    'nexa:core-control:toggle-window-maximize',
    'nexa:creator-ops:get-home-summary',
    'nexa:creator-ops:get-readiness',
    'nexa:creator-ops:open',
    'nexa:creator-ops:start',
    'nexa:creator-ops:stop',
    'nexa:creator-ops:works-command',
    'nexa:creator-ops:works-query',
    'nexa:dashi:get-board-overview',
    'nexa:dashi:get-project-detail',
    'nexa:dashi:get-source-health',
    'nexa:dashi:get-task-detail',
    'nexa:dashi:get-task-execution-context',
    'nexa:dashi:list-projects',
    'nexa:dashi:list-tasks',
    'nexa:device-center:ack-alert-delivered',
    'nexa:device-center:ack-alert-dismissed',
    'nexa:device-center:get-alerts',
    'nexa:device-center:get-anomalies',
    'nexa:device-center:get-application-detail',
    'nexa:device-center:get-applications',
    'nexa:device-center:get-dashboard',
    'nexa:device-center:get-diagnostics',
    'nexa:device-center:get-history',
    'nexa:device-center:get-home-summary',
    'nexa:device-center:get-network',
    'nexa:device-center:get-overview',
    'nexa:device-center:get-performance',
    'nexa:device-center:get-recovery',
    'nexa:device-center:run-network-probe',
    'nexa:global-command:cancel',
    'nexa:global-command:clear-history',
    'nexa:global-command:confirm',
    'nexa:global-command:get-capabilities',
    'nexa:global-command:get-state',
    'nexa:global-command:list-history',
    'nexa:global-command:list-models',
    'nexa:global-command:report-feedback',
    'nexa:global-command:select-model',
    'nexa:global-command:speech-state',
    'nexa:global-command:submit',
    'nexa:global-command:transcribe',
    'nexa:legacy-device:getSnapshot',
    'nexa:local-resource-path:resolve-drop',
    'nexa:local-resource-path:select',
    'nexa:market:execute-action',
    'nexa:market:explain-term',
    'nexa:market:get-decision-journal',
    'nexa:market:get-desktop-snapshot',
    'nexa:market:get-instrument-detail',
    'nexa:market:get-market-home',
    'nexa:market:get-module-status',
    'nexa:market:get-portfolio',
    'nexa:market:get-research-center',
    'nexa:market:get-route-manifest',
    'nexa:market:get-watchlist',
    'nexa:market:list-evidence',
    'nexa:market:refresh-local-projection',
    'nexa:market:set-navigation-state',
    'nexa:mobile-pairing:awareness',
    'nexa:mobile-pairing:awareness-action',
    'nexa:mobile-pairing:cancel',
    'nexa:mobile-pairing:certificate',
    'nexa:mobile-pairing:desktop-confirm',
    'nexa:mobile-pairing:list-devices',
    'nexa:mobile-pairing:revoke',
    'nexa:mobile-pairing:rotate-certificate',
    'nexa:mobile-pairing:start',
    'nexa:mobile-pairing:status',
    'nexa:starbench:get-readiness',
    'nexa:starbench:read',
    'nexa:starbench:start',
    'nexa:starbench:stop',
    'nexa:study-center:get-home-summary',
    'nexa:study-center:get-readiness',
    'nexa:study-center:pronounce',
    'nexa:study-center:start',
    'nexa:study-center:stop',
    'nexa:today-tomorrow:cancel-local-ai',
    'nexa:today-tomorrow:check-local-ai-health',
    'nexa:today-tomorrow:confirm-local-ai',
    'nexa:today-tomorrow:execute',
    'nexa:today-tomorrow:get-date-summary',
    'nexa:today-tomorrow:get-home-summary',
    'nexa:today-tomorrow:get-local-ai-state',
    'nexa:today-tomorrow:get-month-summary',
    'nexa:today-tomorrow:get-view',
    'nexa:today-tomorrow:parse-home-input',
    'nexa:today-tomorrow:propose-local-ai',
    'nexa:today-tomorrow:undo-local-ai'
  ]);
  assert.deepEqual(sortedUnique(allChannels.filter((channel) => channel.startsWith('nexa:'))), [
    'nexa:automation-center:archive-automation',
    'nexa:automation-center:available-ai-routes',
    'nexa:automation-center:capabilities',
    'nexa:automation-center:create-automation',
    'nexa:automation-center:disable-automation',
    'nexa:automation-center:enable-automation',
    'nexa:automation-center:evaluate-schedules',
    'nexa:automation-center:get-automation',
    'nexa:automation-center:get-automation-status',
    'nexa:automation-center:get-latest-run',
    'nexa:automation-center:get-next-scheduled-run',
    'nexa:automation-center:list-automations',
    'nexa:automation-center:list-recent-runs',
    'nexa:automation-center:manual-run',
    'nexa:automation-center:retry-failed-occurrence',
    'nexa:automation-center:run-due-schedules',
    'nexa:automation-center:update-automation',
    'nexa:consumption:execute',
    'nexa:consumption:get-home-summary',
    'nexa:consumption:get-snapshot',
    'nexa:core-control:get-snapshot',
    'nexa:core-control:set-all-auto-start',
    'nexa:core-control:set-all-enabled',
    'nexa:core-control:set-auto-start',
    'nexa:core-control:set-enabled',
    'nexa:core-control:toggle-window-maximize',
    'nexa:creator-ops:get-home-summary',
    'nexa:creator-ops:get-readiness',
    'nexa:creator-ops:open',
    'nexa:creator-ops:start',
    'nexa:creator-ops:stop',
    'nexa:creator-ops:works-command',
    'nexa:creator-ops:works-query',
    'nexa:dashi:get-board-overview',
    'nexa:dashi:get-project-detail',
    'nexa:dashi:get-source-health',
    'nexa:dashi:get-task-detail',
    'nexa:dashi:get-task-execution-context',
    'nexa:dashi:list-projects',
    'nexa:dashi:list-tasks',
    'nexa:device-center:ack-alert-delivered',
    'nexa:device-center:ack-alert-dismissed',
    'nexa:device-center:get-alerts',
    'nexa:device-center:get-anomalies',
    'nexa:device-center:get-application-detail',
    'nexa:device-center:get-applications',
    'nexa:device-center:get-dashboard',
    'nexa:device-center:get-diagnostics',
    'nexa:device-center:get-history',
    'nexa:device-center:get-home-summary',
    'nexa:device-center:get-network',
    'nexa:device-center:get-overview',
    'nexa:device-center:get-performance',
    'nexa:device-center:get-recovery',
    'nexa:device-center:run-network-probe',
    'nexa:global-command:cancel',
    'nexa:global-command:clear-history',
    'nexa:global-command:confirm',
    'nexa:global-command:get-capabilities',
    'nexa:global-command:get-state',
    'nexa:global-command:list-history',
    'nexa:global-command:list-models',
    'nexa:global-command:report-feedback',
    'nexa:global-command:select-model',
    'nexa:global-command:speech-state',
    'nexa:global-command:submit',
    'nexa:global-command:transcribe',
    'nexa:legacy-device:getSnapshot',
    'nexa:local-resource-path:resolve-drop',
    'nexa:local-resource-path:select',
    'nexa:market:execute-action',
    'nexa:market:explain-term',
    'nexa:market:get-decision-journal',
    'nexa:market:get-desktop-snapshot',
    'nexa:market:get-instrument-detail',
    'nexa:market:get-market-home',
    'nexa:market:get-module-status',
    'nexa:market:get-portfolio',
    'nexa:market:get-research-center',
    'nexa:market:get-route-manifest',
    'nexa:market:get-watchlist',
    'nexa:market:list-evidence',
    'nexa:market:refresh-local-projection',
    'nexa:market:set-navigation-state',
    'nexa:mobile-pairing:awareness',
    'nexa:mobile-pairing:awareness-action',
    'nexa:mobile-pairing:cancel',
    'nexa:mobile-pairing:certificate',
    'nexa:mobile-pairing:desktop-confirm',
    'nexa:mobile-pairing:list-devices',
    'nexa:mobile-pairing:revoke',
    'nexa:mobile-pairing:rotate-certificate',
    'nexa:mobile-pairing:start',
    'nexa:mobile-pairing:status',
    'nexa:starbench:get-readiness',
    'nexa:starbench:read',
    'nexa:starbench:start',
    'nexa:starbench:stop',
    'nexa:study-center:get-home-summary',
    'nexa:study-center:get-readiness',
    'nexa:study-center:pronounce',
    'nexa:study-center:start',
    'nexa:study-center:stop',
    'nexa:today-tomorrow:cancel-local-ai',
    'nexa:today-tomorrow:check-local-ai-health',
    'nexa:today-tomorrow:confirm-local-ai',
    'nexa:today-tomorrow:execute',
    'nexa:today-tomorrow:get-date-summary',
    'nexa:today-tomorrow:get-home-summary',
    'nexa:today-tomorrow:get-local-ai-state',
    'nexa:today-tomorrow:get-month-summary',
    'nexa:today-tomorrow:get-view',
    'nexa:today-tomorrow:parse-home-input',
    'nexa:today-tomorrow:propose-local-ai',
    'nexa:today-tomorrow:undo-local-ai'
  ]);
  assert.doesNotMatch(preloadSource, /\b(?:Proxy|Host|Registry|Controller|Electron)\b/);
  assert.doesNotMatch(preloadSource, /require\s*\(\s*['"](?:node:)?(?:fs|path)['"]\s*\)/);
});

test('legacy filtering permits future APIs only below the NEXA namespace', () => {
  const { api } = exposePreloadApi();
  const futureApi = {
    ...api,
    nexa: Object.freeze({ ...api.nexa, example: Object.freeze({}) })
  };

  assert.deepEqual(legacyRootMembers(Object.keys(futureApi)), EXPECTED_LEGACY_ROOT_MEMBERS);
  assert.deepEqual(Object.keys(futureApi.nexa).sort(), [
    'automation-center', 'consumption', 'control', 'creator-ops', 'dashi', 'device-center', 'example', 'globalCommand', 'legacy-device', 'local-resource-path', 'market',
    'mobile-pairing', 'starbench', 'study-center', 'today-tomorrow'
  ]);
  assert.notDeepEqual(
    legacyRootMembers([...Object.keys(api), 'newBusinessRoot']),
    EXPECTED_LEGACY_ROOT_MEMBERS,
    'a future non-nexa root bypassed legacy filtering'
  );
});
