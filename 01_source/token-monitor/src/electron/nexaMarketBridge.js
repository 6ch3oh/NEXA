'use strict';

const { createNexaModuleController } = require('../shared/nexaModuleController');
const { projectNexaModuleReadiness } = require('../shared/nexaModuleReadiness');
const { createNexaMarketStdioClient } = require('./nexaMarketStdioClient');

const MARKET_DESKTOP_BRIDGE_VERSION = 'nexa.market.desktop-bridge.v0.1';
const MARKET_RENDERER_METHODS = Object.freeze({
  getModuleStatus: 'get_module_status',
  getDesktopSnapshot: 'get_desktop_snapshot',
  getRouteManifest: 'get_route_manifest',
  setNavigationState: 'set_navigation_state',
  getMarketHome: 'get_market_home',
  getWatchlist: 'get_watchlist',
  getPortfolio: 'get_portfolio',
  getInstrumentDetail: 'get_instrument_detail',
  getResearchCenter: 'get_research_center',
  getDecisionJournal: 'get_decision_journal',
  listEvidence: 'list_evidence',
  explainTerm: 'explain_term',
  refreshLocalProjection: 'refresh_local_projection',
  executeAction: 'execute_action'
});
const MARKET_CHANNELS = Object.freeze({
  getModuleStatus: 'nexa:market:get-module-status',
  getDesktopSnapshot: 'nexa:market:get-desktop-snapshot',
  getRouteManifest: 'nexa:market:get-route-manifest',
  setNavigationState: 'nexa:market:set-navigation-state',
  getMarketHome: 'nexa:market:get-market-home',
  getWatchlist: 'nexa:market:get-watchlist',
  getPortfolio: 'nexa:market:get-portfolio',
  getInstrumentDetail: 'nexa:market:get-instrument-detail',
  getResearchCenter: 'nexa:market:get-research-center',
  getDecisionJournal: 'nexa:market:get-decision-journal',
  listEvidence: 'nexa:market:list-evidence',
  explainTerm: 'nexa:market:explain-term',
  refreshLocalProjection: 'nexa:market:refresh-local-projection',
  executeAction: 'nexa:market:execute-action'
});
const NEXA_MARKET_DESCRIPTOR = Object.freeze({
  moduleId: 'market',
  contractVersion: 1,
  invokeChannels: Object.freeze(Object.values(MARKET_CHANNELS)),
  pushChannels: Object.freeze([])
});

class NexaMarketBridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaMarketBridgeError';
    this.code = code;
  }
}

function bridgeError(code, message) {
  return new NexaMarketBridgeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); }
  catch { throw bridgeError('INVALID_MARKET_DTO', 'Market returned a non-JSON DTO'); }
}

function stableCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : fallback;
}

function warningCode(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return 'MARKET_LIMITED';
  const first = warnings[0];
  return stableCode(typeof first === 'string' ? first : first?.code, 'MARKET_LIMITED');
}

function publicStatusReadiness(status) {
  const lifecycle = typeof status?.lifecycle === 'string' ? status.lifecycle.toUpperCase() : '';
  if (lifecycle === 'READY') {
    return Array.isArray(status.warnings) && status.warnings.length > 0
      ? Object.freeze({ state: 'LIMITED', code: warningCode(status.warnings) })
      : Object.freeze({ state: 'READY' });
  }
  if (['CREATED', 'STARTING'].includes(lifecycle)) {
    return Object.freeze({ state: 'LIMITED', code: 'MARKET_STARTING' });
  }
  if (['STOPPING'].includes(lifecycle)) {
    return Object.freeze({ state: 'LIMITED', code: 'MARKET_STOPPING' });
  }
  if (['STOPPED', 'DISPOSED'].includes(lifecycle)) {
    return Object.freeze({ state: 'OFFLINE', code: 'MARKET_STOPPED' });
  }
  if (lifecycle === 'ERROR') return Object.freeze({ state: 'ERROR', code: 'MARKET_RUNTIME_ERROR' });
  return Object.freeze({ state: 'UNAVAILABLE', code: 'MARKET_STATUS_UNAVAILABLE' });
}

function projectMarketReadiness(status, transportState) {
  const runtimeStatus = ['inactive', 'starting', 'running', 'stopping', 'error'].includes(transportState)
    ? transportState
    : 'error';
  return projectNexaModuleReadiness({
    enabled: true,
    runtimeStatus,
    readiness: status === null || status === undefined ? undefined : publicStatusReadiness(status),
    errorCode: runtimeStatus === 'error' ? 'MARKET_TRANSPORT_ERROR' : undefined
  });
}

function projectMarketStatus(status, transportState, diagnostics = {}) {
  const dto = status === null || status === undefined ? null : cloneJson(status);
  if (dto !== null && (!isPlainObject(dto) || dto.bridge_version !== MARKET_DESKTOP_BRIDGE_VERSION)) {
    throw bridgeError('INVALID_MARKET_STATUS', 'Market module status is invalid');
  }
  return Object.freeze({
    bridgeVersion: MARKET_DESKTOP_BRIDGE_VERSION,
    status: dto === null ? null : Object.freeze(dto),
    readiness: projectMarketReadiness(dto, transportState),
    transport: Object.freeze({
      state: transportState,
      pid: Number.isSafeInteger(diagnostics.pid) ? diagnostics.pid : null,
      pendingCount: Number.isSafeInteger(diagnostics.pendingCount) ? diagnostics.pendingCount : 0
    })
  });
}

function validateControllerOptions(options) {
  if (!isPlainObject(options) || typeof options.pythonExecutable !== 'string' ||
      typeof options.moduleRoot !== 'string' || typeof options.dataRoot !== 'string' ||
      typeof options.timezone !== 'string' || typeof options.runtimeMode !== 'string' ||
      (options.clientFactory !== undefined && typeof options.clientFactory !== 'function')) {
    throw bridgeError('INVALID_MARKET_CONTROLLER_OPTIONS', 'Market controller options are invalid');
  }
}

function createNexaMarketController(options = {}) {
  validateControllerOptions(options);
  const clientFactory = options.clientFactory || createNexaMarketStdioClient;
  let client = null;
  let snapshot = projectMarketStatus(null, 'inactive');

  function clientOptions() {
    return {
      pythonExecutable: options.pythonExecutable,
      moduleRoot: options.moduleRoot,
      ...(isPlainObject(options.clientOptions) ? options.clientOptions : {})
    };
  }

  function initialization() {
    return Object.freeze({
      data_root: options.dataRoot,
      timezone: options.timezone,
      runtime_mode: options.runtimeMode,
      network_refresh_enabled: false
    });
  }

  async function request(method, params = {}) {
    if (!client) throw bridgeError('MARKET_NOT_STARTED', 'Market process is not started');
    try {
      const result = await client.request(method, params);
      if (method === 'get_module_status') {
        snapshot = projectMarketStatus(result, 'running', client.getDiagnostics?.());
      }
      return cloneJson(result);
    } catch (error) {
      const diagnostics = client.getDiagnostics?.() || {};
      if (diagnostics.state === 'failed') snapshot = projectMarketStatus(null, 'error', diagnostics);
      throw error;
    }
  }

  return createNexaModuleController({
    async start() {
      const next = clientFactory(clientOptions());
      client = next;
      snapshot = projectMarketStatus(null, 'starting', next.getDiagnostics?.());
      try {
        await next.open(initialization());
        const status = await next.request('start', {});
        snapshot = projectMarketStatus(status, 'running', next.getDiagnostics?.());
        if (snapshot.readiness.state === 'ERROR' || snapshot.readiness.state === 'UNAVAILABLE') {
          throw bridgeError('MARKET_NOT_READY', 'Market process did not become available');
        }
        return snapshot;
      } catch (error) {
        snapshot = projectMarketStatus(null, 'error', next.getDiagnostics?.());
        try { await next.shutdown(); } catch (_) {}
        if (client === next) client = null;
        throw error;
      }
    },
    async stop() {
      const current = client;
      if (!current) {
        snapshot = projectMarketStatus(null, 'inactive');
        return snapshot;
      }
      snapshot = projectMarketStatus(snapshot.status, 'stopping', current.getDiagnostics?.());
      await current.shutdown();
      if (client === current) client = null;
      snapshot = projectMarketStatus(null, 'inactive');
      return snapshot;
    },
    getSnapshot() {
      return snapshot;
    },
    execute(command) {
      if (!isPlainObject(command) || !Object.values(MARKET_RENDERER_METHODS).includes(command.method) ||
          !isPlainObject(command.params || {})) {
        throw bridgeError('INVALID_MARKET_COMMAND', 'Market command is invalid');
      }
      return request(command.method, command.params || {});
    }
  });
}

function safeError(error) {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      code: stableCode(error?.code, 'MARKET_REQUEST_FAILED'),
      message: 'Market request failed'
    })
  });
}

function createNexaMarketIpcHandlers(control) {
  if (!control || typeof control.startModule !== 'function' || typeof control.executeModule !== 'function') {
    throw bridgeError('INVALID_CONTROL', 'NEXA module control is required');
  }
  async function respond(method, params) {
    try {
      await control.startModule('market');
      const value = await control.executeModule('market', { method, params: params || {} });
      return Object.freeze({ ok: true, value });
    } catch (error) {
      return safeError(error);
    }
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(MARKET_RENDERER_METHODS).map(([facadeMethod, transportMethod]) => [
      MARKET_CHANNELS[facadeMethod],
      (_event, params) => respond(transportMethod, params)
    ])
  ));
}

module.exports = {
  MARKET_CHANNELS,
  MARKET_DESKTOP_BRIDGE_VERSION,
  MARKET_RENDERER_METHODS,
  NEXA_MARKET_DESCRIPTOR,
  NexaMarketBridgeError,
  createNexaMarketController,
  createNexaMarketIpcHandlers,
  projectMarketReadiness,
  projectMarketStatus
};
