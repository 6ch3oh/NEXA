'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const BLOCKED_HUB_CREDENTIAL_FIELDS = new Set([
  'hubHostSecret',
  'secret',
  'fingerprint_sha256',
  'fingerprint_display',
  'certificate_fingerprint_sha256',
  'certificate_fingerprint_summary',
  'server_certificate_fingerprint_sha256'
]);

function stripHubCredentialFields(value) {
  if (Array.isArray(value)) return value.map(stripHubCredentialFields);
  if (!value || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_HUB_CREDENTIAL_FIELDS.has(key)) continue;
    safe[key] = stripHubCredentialFields(entry);
  }
  return safe;
}

function selectLocalResource(request_kind) {
  return ipcRenderer.invoke('nexa:local-resource-path:select', { request_kind });
}

function resolveDroppedResources(files) {
  let absolutePaths = null;
  if (Array.isArray(files)) {
    absolutePaths = files.map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    });
  }
  return ipcRenderer.invoke('nexa:local-resource-path:resolve-drop', absolutePaths);
}

contextBridge.exposeInMainWorld('tokenMonitor', {
  nexa: Object.freeze({
    globalCommand: Object.freeze({
      getState: () => ipcRenderer.invoke('nexa:global-command:get-state'),
      getCapabilities: () => ipcRenderer.invoke('nexa:global-command:get-capabilities'),
      submit: (input) => ipcRenderer.invoke('nexa:global-command:submit', input),
      confirm: (proposalId, options) => ipcRenderer.invoke('nexa:global-command:confirm', proposalId, options),
      cancel: (proposalId) => ipcRenderer.invoke('nexa:global-command:cancel', proposalId),
      listHistory: () => ipcRenderer.invoke('nexa:global-command:list-history'),
      clearHistory: () => ipcRenderer.invoke('nexa:global-command:clear-history'),
      reportFeedback: (diagnosticId, status) => ipcRenderer.invoke('nexa:global-command:report-feedback', diagnosticId, status),
      listModels: () => ipcRenderer.invoke('nexa:global-command:list-models'),
      selectModel: (modelId) => ipcRenderer.invoke('nexa:global-command:select-model', modelId),
      getSpeechState: () => ipcRenderer.invoke('nexa:global-command:speech-state'),
      transcribeAudio: (input) => ipcRenderer.invoke('nexa:global-command:transcribe', input)
    }),
    control: Object.freeze({
      getSnapshot: () => ipcRenderer.invoke('nexa:core-control:get-snapshot'),
      setEnabled: (moduleId, enabled) => ipcRenderer.invoke('nexa:core-control:set-enabled', moduleId, enabled),
      setAutoStart: (moduleId, autoStart) => ipcRenderer.invoke('nexa:core-control:set-auto-start', moduleId, autoStart),
      setAllEnabled: (enabled) => ipcRenderer.invoke('nexa:core-control:set-all-enabled', enabled),
      setAllAutoStart: (autoStart) => ipcRenderer.invoke('nexa:core-control:set-all-auto-start', autoStart),
      toggleMaximize: () => ipcRenderer.invoke('nexa:core-control:toggle-window-maximize')
    }),
    'automation-center': Object.freeze({
      capabilities: () => ipcRenderer.invoke('nexa:automation-center:capabilities'),
      availableAiRoutes: () => ipcRenderer.invoke('nexa:automation-center:available-ai-routes'),
      listAutomations: (options = {}) => ipcRenderer.invoke('nexa:automation-center:list-automations', options),
      getAutomation: (automationId) => ipcRenderer.invoke('nexa:automation-center:get-automation', automationId),
      getAutomationStatus: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:get-automation-status', automationId
      ),
      getNextScheduledRun: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:get-next-scheduled-run', automationId
      ),
      getLatestRun: (automationId) => ipcRenderer.invoke('nexa:automation-center:get-latest-run', automationId),
      listRecentRuns: (automationId, options = {}) => ipcRenderer.invoke(
        'nexa:automation-center:list-recent-runs', automationId, options
      ),
      createAutomation: (draft) => ipcRenderer.invoke('nexa:automation-center:create-automation', draft),
      updateAutomation: (automationId, patch) => ipcRenderer.invoke(
        'nexa:automation-center:update-automation', automationId, patch
      ),
      enableAutomation: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:enable-automation', automationId
      ),
      disableAutomation: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:disable-automation', automationId
      ),
      archiveAutomation: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:archive-automation', automationId
      ),
      manualRun: (automationId, options = {}) => ipcRenderer.invoke(
        'nexa:automation-center:manual-run', automationId, options
      ),
      evaluateSchedules: (at) => ipcRenderer.invoke('nexa:automation-center:evaluate-schedules', at),
      runDueSchedules: (at) => ipcRenderer.invoke('nexa:automation-center:run-due-schedules', at),
      retryFailedOccurrence: (automationId) => ipcRenderer.invoke(
        'nexa:automation-center:retry-failed-occurrence', automationId
      )
    }),
    'legacy-device': Object.freeze({
      getSnapshot: () => ipcRenderer.invoke('nexa:legacy-device:getSnapshot')
    }),
    'local-resource-path': Object.freeze({
      selectFiles: (options = {}) => selectLocalResource(options?.multiple === true ? 'files' : 'file'),
      selectDirectory: () => selectLocalResource('directory'),
      relocateFile: () => selectLocalResource('relocate_file'),
      relocateDirectory: () => selectLocalResource('relocate_directory'),
      resolveDroppedResources
    }),
    consumption: Object.freeze({
      getSnapshot: () => ipcRenderer.invoke('nexa:consumption:get-snapshot'),
      getHomeSummary: (options) => options === undefined
        ? ipcRenderer.invoke('nexa:consumption:get-home-summary')
        : ipcRenderer.invoke('nexa:consumption:get-home-summary', options),
      execute: (command) => ipcRenderer.invoke('nexa:consumption:execute', command)
    }),
    dashi: Object.freeze({
      getSourceHealth: () => ipcRenderer.invoke('nexa:dashi:get-source-health'),
      getBoardOverview: () => ipcRenderer.invoke('nexa:dashi:get-board-overview'),
      listProjects: () => ipcRenderer.invoke('nexa:dashi:list-projects'),
      getProjectDetail: (projectId) => ipcRenderer.invoke('nexa:dashi:get-project-detail', projectId),
      listTasks: (options) => ipcRenderer.invoke('nexa:dashi:list-tasks', options),
      getTaskDetail: (taskId) => ipcRenderer.invoke('nexa:dashi:get-task-detail', taskId),
      getTaskExecutionContext: (taskId) => ipcRenderer.invoke('nexa:dashi:get-task-execution-context', taskId)
    }),
    'device-center': Object.freeze({
      getDashboard: () => ipcRenderer.invoke('nexa:device-center:get-dashboard'),
      getOverview: () => ipcRenderer.invoke('nexa:device-center:get-overview'),
      getPerformance: (options) => ipcRenderer.invoke('nexa:device-center:get-performance', options),
      getNetwork: () => ipcRenderer.invoke('nexa:device-center:get-network'),
      runNetworkProbe: (request) => ipcRenderer.invoke('nexa:device-center:run-network-probe', request),
      getHomeSummary: () => ipcRenderer.invoke('nexa:device-center:get-home-summary'),
      getApplications: () => ipcRenderer.invoke('nexa:device-center:get-applications'),
      getApplicationDetail: (applicationId) => ipcRenderer.invoke(
        'nexa:device-center:get-application-detail', applicationId
      ),
      getHistory: (options) => ipcRenderer.invoke('nexa:device-center:get-history', options),
      getAnomalies: () => ipcRenderer.invoke('nexa:device-center:get-anomalies'),
      getAlerts: (options) => ipcRenderer.invoke('nexa:device-center:get-alerts', options),
      getDiagnostics: () => ipcRenderer.invoke('nexa:device-center:get-diagnostics'),
      getRecovery: () => ipcRenderer.invoke('nexa:device-center:get-recovery'),
      ackAlertDelivered: (alertId) => ipcRenderer.invoke(
        'nexa:device-center:ack-alert-delivered', alertId
      ),
      ackAlertDismissed: (alertId) => ipcRenderer.invoke(
        'nexa:device-center:ack-alert-dismissed', alertId
      )
    }),
    'creator-ops': Object.freeze({
      start: () => ipcRenderer.invoke('nexa:creator-ops:start'),
      getReadiness: () => ipcRenderer.invoke('nexa:creator-ops:get-readiness'),
      getHomeSummary: (request) => request === undefined
        ? ipcRenderer.invoke('nexa:creator-ops:get-home-summary')
        : ipcRenderer.invoke('nexa:creator-ops:get-home-summary', request),
      queryWorks: (request) => ipcRenderer.invoke('nexa:creator-ops:works-query', request),
      executeWorksCommand: (command) => ipcRenderer.invoke('nexa:creator-ops:works-command', command),
      stop: () => ipcRenderer.invoke('nexa:creator-ops:stop'),
      open: () => ipcRenderer.invoke('nexa:creator-ops:open')
    }),
    market: Object.freeze({
      getModuleStatus: () => ipcRenderer.invoke('nexa:market:get-module-status', {}),
      getDesktopSnapshot: () => ipcRenderer.invoke('nexa:market:get-desktop-snapshot', {}),
      getRouteManifest: () => ipcRenderer.invoke('nexa:market:get-route-manifest', {}),
      setNavigationState: (params) => ipcRenderer.invoke('nexa:market:set-navigation-state', params),
      getMarketHome: () => ipcRenderer.invoke('nexa:market:get-market-home', {}),
      getWatchlist: (params = {}) => ipcRenderer.invoke('nexa:market:get-watchlist', params),
      getPortfolio: () => ipcRenderer.invoke('nexa:market:get-portfolio', {}),
      getInstrumentDetail: (instrumentId) => ipcRenderer.invoke(
        'nexa:market:get-instrument-detail', { instrument_id: instrumentId }
      ),
      getResearchCenter: () => ipcRenderer.invoke('nexa:market:get-research-center', {}),
      getDecisionJournal: () => ipcRenderer.invoke('nexa:market:get-decision-journal', {}),
      listEvidence: (params = {}) => ipcRenderer.invoke('nexa:market:list-evidence', params),
      explainTerm: (term, instrumentId) => ipcRenderer.invoke('nexa:market:explain-term', {
        term,
        ...(instrumentId === undefined ? {} : { instrument_id: instrumentId })
      }),
      refreshLocalProjection: () => ipcRenderer.invoke('nexa:market:refresh-local-projection', {}),
      executeAction: (action, payload) => ipcRenderer.invoke('nexa:market:execute-action', {
        action,
        ...(payload === undefined ? {} : { payload })
      })
    }),
    starbench: Object.freeze({
      start: () => ipcRenderer.invoke('nexa:starbench:start'),
      stop: () => ipcRenderer.invoke('nexa:starbench:stop'),
      getReadiness: () => ipcRenderer.invoke('nexa:starbench:get-readiness'),
      read: (capability, query = {}) => ipcRenderer.invoke('nexa:starbench:read', capability, query)
    }),
    'study-center': Object.freeze({
      start: () => ipcRenderer.invoke('nexa:study-center:start'),
      stop: () => ipcRenderer.invoke('nexa:study-center:stop'),
      getReadiness: () => ipcRenderer.invoke('nexa:study-center:get-readiness'),
      getHomeSummary: (options) => ipcRenderer.invoke(
        'nexa:study-center:get-home-summary',
        ...(options === undefined ? [] : [options])
      ),
      pronounce: (word, accent) => ipcRenderer.invoke('nexa:study-center:pronounce', word, accent)
    }),
    'today-tomorrow': Object.freeze({
      getHomeSummary: (date) => ipcRenderer.invoke('nexa:today-tomorrow:get-home-summary', date),
      getDateSummary: (date) => ipcRenderer.invoke('nexa:today-tomorrow:get-date-summary', date),
      getMonthSummary: (startDate, endDate) => ipcRenderer.invoke(
        'nexa:today-tomorrow:get-month-summary', startDate, endDate
      ),
      getView: (view, date) => ipcRenderer.invoke('nexa:today-tomorrow:get-view', view, date),
      parseHomeInput: (input) => ipcRenderer.invoke('nexa:today-tomorrow:parse-home-input', input),
      getLocalAiState: () => ipcRenderer.invoke('nexa:today-tomorrow:get-local-ai-state'),
      checkLocalAiHealth: () => ipcRenderer.invoke('nexa:today-tomorrow:check-local-ai-health'),
      proposeLocalAi: (input) => ipcRenderer.invoke('nexa:today-tomorrow:propose-local-ai', input),
      confirmLocalAi: (proposalId, options) => ipcRenderer.invoke(
        'nexa:today-tomorrow:confirm-local-ai', proposalId, options
      ),
      cancelLocalAi: (proposalId) => ipcRenderer.invoke('nexa:today-tomorrow:cancel-local-ai', proposalId),
      undoLocalAi: (proposalId, options) => ipcRenderer.invoke('nexa:today-tomorrow:undo-local-ai', proposalId, options),
      execute: (command) => ipcRenderer.invoke('nexa:today-tomorrow:execute', command)
    }),
    'mobile-pairing': Object.freeze({
      start: () => ipcRenderer.invoke('nexa:mobile-pairing:start').then(stripHubCredentialFields),
      status: (pairingId) => ipcRenderer.invoke('nexa:mobile-pairing:status', pairingId)
        .then(stripHubCredentialFields),
      cancel: (pairingId) => ipcRenderer.invoke('nexa:mobile-pairing:cancel', pairingId)
        .then(stripHubCredentialFields),
      desktopConfirm: (pairingId, confirmed) => ipcRenderer.invoke(
        'nexa:mobile-pairing:desktop-confirm', pairingId, confirmed === true
      ).then(stripHubCredentialFields),
      listDevices: () => ipcRenderer.invoke('nexa:mobile-pairing:list-devices')
        .then(stripHubCredentialFields),
      revoke: (deviceReference) => ipcRenderer.invoke('nexa:mobile-pairing:revoke', deviceReference),
      certificate: () => ipcRenderer.invoke('nexa:mobile-pairing:certificate')
        .then(stripHubCredentialFields),
      rotateCertificate: (confirmed) => ipcRenderer.invoke(
        'nexa:mobile-pairing:rotate-certificate', confirmed === true
      ).then(stripHubCredentialFields),
      awareness: (options) => ipcRenderer.invoke('nexa:mobile-pairing:awareness', options),
      awarenessAction: (request) => ipcRenderer.invoke('nexa:mobile-pairing:awareness-action', request)
    })
  }),
  getSettings: () => ipcRenderer.invoke('settings:get').then(stripHubCredentialFields),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch).then(stripHubCredentialFields),
  clearSessionUsageArchive: () => ipcRenderer.invoke('sessionUsageArchive:clear'),
  lookupModelPricing: (modelId) => ipcRenderer.invoke('pricing:lookup', modelId),
  previewAppearance: (patch) => ipcRenderer.invoke('appearance:preview', patch),
  getStats: (options) => ipcRenderer.invoke('stats:get', options),
  getSessionDetail: (args) => ipcRenderer.invoke('session:getDetail', args),
  getStreamStatus: () => ipcRenderer.invoke('stream:status'),
  getServiceStatus: (options) => ipcRenderer.invoke('serviceStatus:get', options),
  openDashboard: () => ipcRenderer.invoke('dashboard:open'),
  getDashboardHistory: () => ipcRenderer.invoke('dashboard:getHistory'),
  onDashboardHistoryChanged: (callback) => {
    const listener = () => { try { callback(); } catch (_) {} };
    ipcRenderer.on('dashboard:historyChanged', listener);
    return () => ipcRenderer.removeListener('dashboard:historyChanged', listener);
  },
  dashboard: {
    ready: () => ipcRenderer.send('dashboard:ready'),
    minimize: () => ipcRenderer.send('dashboard:minimize'),
    close: () => ipcRenderer.send('dashboard:close')
  },
  getHubInfo: () => ipcRenderer.invoke('hub:getInfo').then(stripHubCredentialFields),
  regenerateHubSecret: () => ipcRenderer.invoke('hub:regenerateSecret').then(stripHubCredentialFields),
  onHubPush: (callback) => {
    const listener = (_event, payload) => { try { callback(stripHubCredentialFields(payload)); } catch (_) {} };
    ipcRenderer.on('hub:push', listener);
    return () => ipcRenderer.removeListener('hub:push', listener);
  },
  onStatsPush: (callback) => {
    const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
    ipcRenderer.on('stats:push', listener);
    return () => ipcRenderer.removeListener('stats:push', listener);
  },
  onSettingsPush: (callback) => {
    const listener = (_event, payload) => { try { callback(stripHubCredentialFields(payload)); } catch (_) {} };
    ipcRenderer.on('settings:push', listener);
    return () => ipcRenderer.removeListener('settings:push', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => { try { callback(); } catch (_) {} };
    ipcRenderer.on('settings:open', listener);
    return () => ipcRenderer.removeListener('settings:open', listener);
  },
  onOpenView: (callback) => {
    const listener = (_event, viewId) => { try { callback(viewId); } catch (_) {} };
    ipcRenderer.on('view:open', listener);
    return () => ipcRenderer.removeListener('view:open', listener);
  },
  onTokscalePush: (callback) => {
    const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
    ipcRenderer.on('tokscale:push', listener);
    return () => ipcRenderer.removeListener('tokscale:push', listener);
  },
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  notionTodo: {
    get: () => ipcRenderer.invoke('notionTodo:get'),
    refresh: () => ipcRenderer.invoke('notionTodo:refresh'),
    test: () => ipcRenderer.invoke('notionTodo:test'),
    open: (url) => ipcRenderer.invoke('notionTodo:open', url),
    onPush: (callback) => {
      const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('notionTodo:push', listener);
      return () => ipcRenderer.removeListener('notionTodo:push', listener);
    }
  },
  openUserData: () => ipcRenderer.invoke('app:openUserData'),
  expense: {
    get: () => ipcRenderer.invoke('expense:get'),
    records: () => ipcRenderer.invoke('expense:records'),
    refresh: () => ipcRenderer.invoke('expense:refresh'),
    openInbox: () => ipcRenderer.invoke('expense:openInbox'),
    openExpenseRoot: () => ipcRenderer.invoke('expense:openExpenseRoot'),
    importCsvPreview: (text) => ipcRenderer.invoke('expense:importCsvPreview', text),
    importCsvConfirm: (drafts) => ipcRenderer.invoke('expense:importCsvConfirm', drafts),
    clear: () => ipcRenderer.invoke('expense:clear'),
    onPush: (callback) => {
      const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
      ipcRenderer.on('expense:push', listener);
      return () => ipcRenderer.removeListener('expense:push', listener);
    }
  },
  mimo: {
    accounts: () => ipcRenderer.invoke('mimo:accounts'),
    addAccount: (cookieHeader) => ipcRenderer.invoke('mimo:addAccount', cookieHeader),
    openConsole: () => ipcRenderer.invoke('mimo:openConsole'),
    removeAccount: (id) => ipcRenderer.invoke('mimo:removeAccount', id),
    setAccountEnabled: (id, enabled) => ipcRenderer.invoke('mimo:setAccountEnabled', id, enabled),
    onAccounts: (callback) => {
      const handler = (_event, accounts) => callback(accounts);
      ipcRenderer.on('mimo:accounts', handler);
      return () => ipcRenderer.removeListener('mimo:accounts', handler);
    }
  },
  exportNow: () => ipcRenderer.invoke('export:now'),
  pickExportDir: () => ipcRenderer.invoke('export:pickAutoDir'),
  getTokscaleStatus: () => ipcRenderer.invoke('tokscale:getStatus'),
  checkTokscaleNpm: () => ipcRenderer.invoke('tokscale:checkNpm'),
  downloadTokscaleFromNpm: () => ipcRenderer.invoke('tokscale:downloadFromNpm'),
  resetTokscaleToBundled: () => ipcRenderer.invoke('tokscale:resetToBundled'),
  getAppUpdateState: () => ipcRenderer.invoke('appUpdate:getState'),
  checkAppUpdateNow: () => ipcRenderer.invoke('appUpdate:checkNow'),
  downloadAppUpdate: () => ipcRenderer.invoke('appUpdate:download'),
  installAppUpdate: () => ipcRenderer.invoke('appUpdate:install'),
  dismissAppUpdate: (version) => ipcRenderer.invoke('appUpdate:dismiss', version),
  expandFloatingBubble: () => ipcRenderer.invoke('floatingBubble:expand'),
  moveFloatingBubble: (delta) => ipcRenderer.invoke('floatingBubble:move', delta),
  signalContentReady: () => ipcRenderer.send('window:contentReady'),
  setViewState: (patch) => ipcRenderer.send('window:viewState', patch),
  peekFloatingBubble: () => ipcRenderer.invoke('floatingBubble:peek'),
  collapseFloatingBubbleIfIdle: () => ipcRenderer.invoke('floatingBubble:collapseIfIdle'),
  setFloatingBubbleCollapsedSize: (size) => ipcRenderer.invoke('floatingBubble:setCollapsedSize', size),
  onFloatingBubbleState: (callback) => {
    const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
    ipcRenderer.on('floatingBubble:state', listener);
    return () => ipcRenderer.removeListener('floatingBubble:state', listener);
  },
  onAppUpdatePush: (callback) => {
    const listener = (_event, payload) => { try { callback(payload); } catch (_) {} };
    ipcRenderer.on('appUpdate:push', listener);
    return () => ipcRenderer.removeListener('appUpdate:push', listener);
  },
  setTrayIcons: (icons) => ipcRenderer.invoke('tray:setIcons', icons),
  cursor: {
    loginManual: (token) => ipcRenderer.invoke('cursor:loginManual', token),
    logout: () => ipcRenderer.invoke('cursor:logout'),
    status: () => ipcRenderer.invoke('cursor:status')
  },
  claude: {
    saveCookie: (cookie) => ipcRenderer.invoke('claude:saveCookie', cookie)
  },
  ollama: {
    validateCookie: (cookie) => ipcRenderer.invoke('ollama:validateCookie', cookie)
  },
  opencode: {
    saveCookie: (cookie) => ipcRenderer.invoke('opencode:saveCookie', cookie),
    logout: () => ipcRenderer.invoke('opencode:logout'),
    status: () => ipcRenderer.invoke('opencode:status'),
    getProfiles: () => ipcRenderer.invoke('opencode:getProfiles'),
    saveProfile: (name, cookie) => ipcRenderer.invoke('opencode:saveProfile', name, cookie),
    deleteProfile: (name) => ipcRenderer.invoke('opencode:deleteProfile', name),
    renameProfile: (oldName, newName) => ipcRenderer.invoke('opencode:renameProfile', oldName, newName),
    setProfileEnabled: (name, enabled) => ipcRenderer.invoke('opencode:setProfileEnabled', name, enabled)
  },
  openrouter: {
    getProfiles: () => ipcRenderer.invoke('openrouter:getProfiles'),
    saveProfile: (name, apiKey) => ipcRenderer.invoke('openrouter:saveProfile', name, apiKey),
    deleteProfile: (name) => ipcRenderer.invoke('openrouter:deleteProfile', name),
    renameProfile: (oldName, newName) => ipcRenderer.invoke('openrouter:renameProfile', oldName, newName),
    setProfileEnabled: (name, enabled) => ipcRenderer.invoke('openrouter:setProfileEnabled', name, enabled)
  },
  thirdparty: {
    getProfiles: () => ipcRenderer.invoke('thirdparty:getProfiles'),
    saveProfile: (profile) => ipcRenderer.invoke('thirdparty:saveProfile', profile),
    deleteProfile: (name) => ipcRenderer.invoke('thirdparty:deleteProfile', name),
    renameProfile: (oldName, newName) => ipcRenderer.invoke('thirdparty:renameProfile', oldName, newName),
    setProfileEnabled: (name, enabled) => ipcRenderer.invoke('thirdparty:setProfileEnabled', name, enabled)
  },
  codex: {
    accounts: () => ipcRenderer.invoke('codex:accounts'),
    addAccount: (options = {}) => ipcRenderer.invoke('codex:addAccount', options),
    selectWorkspace: (options = {}) => ipcRenderer.invoke('codex:selectWorkspace', options),
    cancelLogin: (options = {}) => ipcRenderer.invoke('codex:cancelLogin', options),
    removeAccount: (id) => ipcRenderer.invoke('codex:removeAccount', id),
    setAccountEnabled: (id, enabled) => ipcRenderer.invoke('codex:setAccountEnabled', id, enabled),
    switchSystemAccount: (id) => ipcRenderer.invoke('codex:switchSystemAccount', id),
    refreshAccountLimits: (id) => ipcRenderer.invoke('codex:refreshAccountLimits', id),
    onLoginStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('codex:loginStatus', handler);
      return () => ipcRenderer.removeListener('codex:loginStatus', handler);
    }
  },
  copilot: {
    signIn: (options = {}) => ipcRenderer.invoke('copilot:signIn', options),
    cancelSignIn: (options = {}) => ipcRenderer.invoke('copilot:cancelSignIn', options),
    onLoginStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('copilot:loginStatus', handler);
      return () => ipcRenderer.removeListener('copilot:loginStatus', handler);
    }
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close')
});
