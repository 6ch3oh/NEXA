'use strict';

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { URL } = require('node:url');
const { aggregateDevices, mergeDeviceRecord, aggregateHistory } = require('../shared/usage');
const { historyPreview, historyRevision } = require('../shared/history');
const { isAuthorized, readJsonBody, sendJson, sendText } = require('../shared/http');
const { loadDotEnv, parseArgs, projectRoot, readJson, writeJsonAtomic } = require('../shared/config');
const { BUSINESS_ENDPOINT, STATUS_ENDPOINT } = require('../shared/mobileSyncProtocol');
const { CONTROL_EXCHANGE_ENDPOINT } = require('../shared/mobileDeviceControlProtocol');
const { ENDPOINT_RENDEZVOUS_ENDPOINT } = require('../shared/mobileEndpointRendezvous');
const { DESKTOP_SELF_STATUS_ENDPOINT } = require('../shared/deviceAwarenessProtocol');
const { RUNTIME_BUNDLE_ENDPOINT } = require('../shared/mobileRuntimeBundleProtocol');
const { MOBILE_PRODUCT_ENDPOINT } = require('../shared/mobileProductProtocol');
const { handleMobileStatusRequest, handleMobileSyncRequest } = require('../electron/mobileSyncReceiver');
const { handleMobilePairingRequest } = require('../electron/mobilePairingHttp');
const { handleMobileEndpointRendezvous } = require('../electron/mobileEndpointRendezvousHttp');
const { handleDesktopSelfStatusRequest } = require('../electron/desktopSelfStatusHttp');
const { handleMobileRuntimeBundleRequest } = require('../electron/mobileRuntimeBundleHttp');
const { handleMobileProductRequest } = require('../electron/mobileProductHttp');
const {
  desktopControlAudit,
  handleDesktopControlRequest,
  handleMobileControlExchange,
  isLoopbackAddress
} = require('../electron/mobileDeviceControlHttp');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

// Without a secret the hub cannot tell its own widget from any other caller, so it
// must not expose account identity (email/plan/key) to the network. Binding to
// loopback keeps an unauthenticated hub usable locally while refusing LAN/remote
// reach; set a secret to bind a non-loopback address and accept other devices.
function resolveBindHost(host, secret) {
  const requested = String(host || '').trim() || '0.0.0.0';
  if (secret) return requested;
  return LOOPBACK_HOSTS.has(requested.toLowerCase()) ? requested : '127.0.0.1';
}

function createHub({
  port = 17321,
  host = '0.0.0.0',
  secret = '',
  staleAfterMs = 10 * 60 * 1000,
  dataFile = path.join(projectRoot(), 'data', 'devices.json'),
  mobileSyncStore = null,
  mobileDeviceCredentialAuthority = null,
  mobilePairingAuthority = null,
  mobileTrustedEndpointProvider = null,
  mobileAuthenticatedPeerResolver = null,
  mobileBusinessEventConsumer = null,
  mobileNotificationEventConsumer = null,
  mobileDeviceControlPlane = null,
  mobileDeviceControlClient = null,
  desktopSelfStatusProvider = null,
  mobileRuntimeBundleApplication = null,
  mobileProductGateway = null,
  mobileHttps = null,
  requireHttpsForMobile = false,
  logger = console
} = {}) {
  const store = readJson(dataFile, { version: 1, devices: {} }) || { version: 1, devices: {} };
  if (!store.devices || typeof store.devices !== 'object') store.devices = {};
  const bindHost = resolveBindHost(host, secret);

  function persist() {
    store.version = 1;
    store.savedAt = new Date().toISOString();
    writeJsonAtomic(dataFile, store);
  }

  function getStats() {
    const stats = aggregateDevices(Object.values(store.devices), staleAfterMs);
    stats.staleAfterMs = staleAfterMs;
    const history = aggregateHistory(Object.values(store.devices));
    stats.historyPreview = historyPreview(history);
    stats.historyRevision = historyRevision(history);
    return stats;
  }

  function getHistory() {
    return aggregateHistory(Object.values(store.devices));
  }

  const sseClients = new Set();
  const statsListeners = new Set();

  function sseFormat(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function broadcastStats(reason = 'update') {
    if (sseClients.size === 0 && statsListeners.size === 0) return;
    const stats = getStats();
    const at = new Date().toISOString();
    if (sseClients.size > 0) {
      const payload = sseFormat('stats', { type: 'stats', reason, stats, at });
      for (const res of sseClients) {
        try { res.write(payload); } catch (_) { sseClients.delete(res); }
      }
    }
    for (const listener of statsListeners) {
      try { listener(stats, reason, at); } catch (_) { /* listener errors must not break ingest */ }
    }
  }

  // Transport-agnostic core: both the HTTP POST handler and the same-process
  // widget call these, so a host-mode widget never has to loopback to itself.
  function ingest(payload) {
    if (!payload || (!payload.deviceId && !payload.id)) {
      throw new Error('deviceId_required');
    }
    const record = mergeDeviceRecord(store.devices[String(payload.deviceId || payload.id)], { ...payload, receivedAt: new Date().toISOString() });
    store.devices[record.deviceId] = record;
    persist();
    broadcastStats('ingest');
    return record;
  }

  function deleteDevice(deviceId) {
    delete store.devices[deviceId];
    persist();
    broadcastStats('delete');
  }

  function onStats(listener) {
    statsListeners.add(listener);
    return () => statsListeners.delete(listener);
  }

  async function handleRequest(req, res) {
    if (req.method === 'OPTIONS') return sendText(res, 204, '');
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const secureTransport = Boolean(req.socket?.encrypted);

    if (url.pathname.startsWith('/nexa/mobile/pairing/')) {
      const handled = await handleMobilePairingRequest(req, res, {
        authority: mobilePairingAuthority,
        secureTransport
      });
      if (handled) return;
    }

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        role: 'hub',
        version: store.version || 1,
        deviceCount: Object.keys(store.devices).length,
        secretRequired: Boolean(secret),
        now: new Date().toISOString()
      });
    }

    if (req.method === 'POST' && url.pathname === BUSINESS_ENDPOINT) {
      if (requireHttpsForMobile && !secureTransport) return sendJson(res, 426, { error: 'HTTPS_REQUIRED' });
      return handleMobileSyncRequest(req, res, {
        store: mobileSyncStore,
        credentialAuthority: mobileDeviceCredentialAuthority,
        trustedEndpointProvider: mobileTrustedEndpointProvider,
        authenticatedPeerResolver: mobileAuthenticatedPeerResolver,
        businessEventConsumer: mobileBusinessEventConsumer,
        notificationEventConsumer: mobileNotificationEventConsumer
      });
    }

    if (req.method === 'PUT' && url.pathname === STATUS_ENDPOINT) {
      if (requireHttpsForMobile && !secureTransport) return sendJson(res, 426, { error: 'HTTPS_REQUIRED' });
      return handleMobileStatusRequest(req, res, {
        store: mobileSyncStore,
        credentialAuthority: mobileDeviceCredentialAuthority,
        trustedEndpointProvider: mobileTrustedEndpointProvider,
        authenticatedPeerResolver: mobileAuthenticatedPeerResolver
      });
    }

    if (req.method === 'POST' && url.pathname === CONTROL_EXCHANGE_ENDPOINT) {
      if (!secureTransport) return sendJson(res, 426, { error: 'HTTPS_REQUIRED' });
      return handleMobileControlExchange(req, res, {
        controlPlane: mobileDeviceControlPlane,
        credentialAuthority: mobileDeviceCredentialAuthority,
        trustedEndpointProvider: mobileTrustedEndpointProvider,
        authenticatedPeerResolver: mobileAuthenticatedPeerResolver
      });
    }

    if (req.method === 'POST' && url.pathname === ENDPOINT_RENDEZVOUS_ENDPOINT) {
      if (!secureTransport) return sendJson(res, 426, { error: 'HTTPS_REQUIRED' });
      return handleMobileEndpointRendezvous(req, res, {
        credentialAuthority: mobileDeviceCredentialAuthority,
        endpointProvider: mobileTrustedEndpointProvider
      });
    }

    if (req.method === 'POST' && url.pathname === DESKTOP_SELF_STATUS_ENDPOINT) {
      return handleDesktopSelfStatusRequest(req, res, {
        credentialAuthority: mobileDeviceCredentialAuthority,
        statusProvider: desktopSelfStatusProvider,
        secureTransport
      });
    }

    if (req.method === 'POST' && url.pathname === RUNTIME_BUNDLE_ENDPOINT) {
      if (!secureTransport) return sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED' } });
      return handleMobileRuntimeBundleRequest(req, res, {
        application: mobileRuntimeBundleApplication,
        credentialAuthority: mobileDeviceCredentialAuthority
      });
    }

    if (req.method === 'POST' && url.pathname === MOBILE_PRODUCT_ENDPOINT) {
      if (!secureTransport) return sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED' } });
      return handleMobileProductRequest(req, res, { gateway: mobileProductGateway, credentialAuthority: mobileDeviceCredentialAuthority });
    }

    if (!isAuthorized(req, secret)) return sendJson(res, 401, { error: 'unauthorized' });

    if (req.method === 'POST' && url.pathname === '/api/mobile/control') {
      if (!secureTransport) return sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED', message: 'Desktop control requires HTTPS' } });
      return handleDesktopControlRequest(req, res, { client: mobileDeviceControlClient });
    }
    if (req.method === 'GET' && url.pathname === '/api/mobile/control/audit') {
      if (!secureTransport) return sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED', message: 'Desktop control requires HTTPS' } });
      return desktopControlAudit(req, res, {
        client: mobileDeviceControlClient,
        deviceId: url.searchParams.get('device_id')
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/mobile/control/devices') {
      if (!secureTransport) return sendJson(res, 426, { error: { code: 'HTTPS_REQUIRED', message: 'Desktop control requires HTTPS' } });
      if (!isLoopbackAddress(req.socket?.remoteAddress)) {
        return sendJson(res, 403, { error: { code: 'LOOPBACK_REQUIRED', message: 'Desktop control entrypoint is loopback-only' } });
      }
      return sendJson(res, 200, {
        devices: mobileDeviceControlClient?.listTrustedDevices() || [],
        capabilities: mobileDeviceControlClient?.listCapabilities() || []
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') return sendJson(res, 200, getStats());
    if (req.method === 'GET' && url.pathname === '/api/devices') return sendJson(res, 200, { devices: Object.values(store.devices) });
    if (req.method === 'GET' && url.pathname === '/api/history') return sendJson(res, 200, getHistory());

    if (req.method === 'GET' && url.pathname === '/api/stats/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no'
      });
      res.write(sseFormat('snapshot', { type: 'stats', reason: 'snapshot', stats: getStats(), at: new Date().toISOString() }));
      sseClients.add(res);
      const heartbeat = setInterval(() => { try { res.write(': hb\n\n'); } catch (_) {} }, 30000);
      const cleanup = () => { clearInterval(heartbeat); sseClients.delete(res); };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      try {
        const payload = await readJsonBody(req);
        const record = ingest(payload);
        return sendJson(res, 200, { ok: true, deviceId: record.deviceId, stats: getStats() });
      } catch (error) {
        if (error.message === 'deviceId_required') return sendJson(res, 400, { error: 'deviceId_required' });
        if (error.code === 'payload_too_large') {
          res.shouldKeepAlive = false;
          return sendJson(res, 413, { error: 'payload_too_large', message: error.message }, { connection: 'close' });
        }
        return sendJson(res, 400, { error: 'bad_request', message: error.message });
      }
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      deleteDevice(deviceId);
      return sendJson(res, 200, { ok: true, deviceId });
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  function requestListener(req, res) {
    handleRequest(req, res).catch((error) => {
      (logger.error || console.error)(error);
      sendJson(res, 500, { error: 'internal_error' });
    });
  }

  const server = http.createServer(requestListener);
  const httpsServer = mobileHttps
    ? https.createServer({ key: mobileHttps.key, cert: mobileHttps.cert }, requestListener)
    : null;
  const httpsIpv6Server = mobileHttps?.ipv6Host
    ? https.createServer({ key: mobileHttps.key, cert: mobileHttps.cert }, requestListener)
    : null;

  function listen(target, listenPort, listenHost) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { target.off('listening', onListening); reject(err); };
      const onListening = () => { target.off('error', onError); resolve(); };
      target.once('error', onError);
      target.once('listening', onListening);
      target.listen(listenPort, listenHost);
    });
  }

  function listenIpv6(target, listenPort, listenHost) {
    return new Promise((resolve, reject) => {
      const onError = (err) => { target.off('listening', onListening); reject(err); };
      const onListening = () => { target.off('error', onError); resolve(); };
      target.once('error', onError);
      target.once('listening', onListening);
      target.listen({ port: listenPort, host: listenHost, ipv6Only: true });
    });
  }

  function close(target) {
    return new Promise((resolve) => {
      if (!target?.listening) return resolve();
      target.close(() => resolve());
      target.closeIdleConnections?.();
      target.closeAllConnections?.();
    });
  }

  async function start() {
    await listen(server, port, bindHost);
    try {
      if (httpsServer) await listen(httpsServer, mobileHttps.port, mobileHttps.host || bindHost);
      if (httpsIpv6Server) {
        try {
          await listenIpv6(httpsIpv6Server, mobileHttps.port, mobileHttps.ipv6Host);
        } catch (error) {
          if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EADDRINUSE'].includes(error?.code)) throw error;
          (logger.error || console.error)(new Error(`Mobile IPv6 listener unavailable: ${error.code}`));
        }
      }
    } catch (error) {
      await Promise.all([close(server), close(httpsServer), close(httpsIpv6Server)]);
      throw error;
    }
  }

  async function stop() {
    for (const res of sseClients) { try { res.end(); } catch (_) {} }
    sseClients.clear();
    await Promise.all([close(server), close(httpsServer), close(httpsIpv6Server)]);
  }

  return {
    start,
    stop,
    server,
    httpsServer,
    httpsIpv6Server,
    getStats,
    getHistory,
    ingest,
    deleteDevice,
    onStats,
    bindHost
  };
}

if (require.main === module) {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port || process.env.TOKEN_MONITOR_PORT || 17321);
  const host = String(args.host || process.env.TOKEN_MONITOR_HOST || '0.0.0.0');
  const secret = String(args.secret || process.env.TOKEN_MONITOR_SECRET || '').trim();
  const staleAfterMs = Number(args.staleAfterMs || process.env.TOKEN_MONITOR_STALE_AFTER_MS || 10 * 60 * 1000);
  const dataFile = String(args.dataFile || process.env.TOKEN_MONITOR_DATA_FILE || path.join(projectRoot(), 'data', 'devices.json'));

  const hub = createHub({ port, host, secret, staleAfterMs, dataFile });
  hub.start().then(() => {
    console.log(`Token Monitor hub listening on http://${hub.bindHost}:${port}`);
    console.log(`Data file: ${dataFile}`);
    if (!secret) {
      console.warn(`Warning: TOKEN_MONITOR_SECRET is not set, so the hub is bound to ${hub.bindHost} (localhost only) to keep account identity off the network. Set a secret to accept connections from other devices.`);
    }
  }).catch((err) => {
    console.error(`Hub failed to start: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createHub, resolveBindHost };
