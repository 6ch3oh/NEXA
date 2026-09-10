'use strict';

const net = require('node:net');
const { isPrivateLanIpv4, sameIpv4Subnet } = require('./mobileLanPeerCandidates');

const REVERSE_LAN_MAGIC = 'NEXA_REVERSE_LAN_V1\n';
const REVERSE_LAN_PORT = 17324;
const MAX_REVERSE_PREFACE_BYTES = 256;
const CONNECT_TIMEOUT_MS = 450;
const ACTIVE_SCAN_INTERVAL_MS = 750;
const IDLE_SCAN_INTERVAL_MS = 5000;
const MAX_CONCURRENCY = 8;
const MAX_CANDIDATES = 32;
const DIAGNOSTIC_LOG_INTERVAL_MS = 10000;
const MAX_RETRY_BACKOFF_MS = 30000;
const REVERSE_AUTHENTICATION_TIMEOUT_MS = 5000;
const TRANSPORT_MODE = Object.freeze({
  AUTO: 'AUTO',
  DIRECT_MOBILE_TO_PC: 'DIRECT_MOBILE_TO_PC',
  REVERSE_PC_TO_MOBILE: 'REVERSE_PC_TO_MOBILE'
});

function ipv4Octets(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isLoopbackPair(host, localAddress) {
  return String(host).startsWith('127.') && String(localAddress).startsWith('127.');
}

function retryDelayMillis(failures, active) {
  const base = active ? 500 : 2000;
  return Math.min(MAX_RETRY_BACKOFF_MS, base * (2 ** Math.min(Math.max(0, failures - 1), 5)));
}

function subnetCandidates(interfaces, { hints = [] } = {}) {
  const candidates = [];
  const seen = new Set();
  function add(hint, entry) {
    const host = typeof hint === 'string' ? hint : hint?.host;
    if (!ipv4Octets(host) || host === entry.address) return;
    if (!sameIpv4Subnet(host, entry) && !isLoopbackPair(host, entry.address)) return;
    const key = `${entry.address}|${host}`;
    if (seen.has(key) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(key);
    candidates.push({
      host,
      localAddress: entry.address,
      source: typeof hint === 'object' && hint?.source ? String(hint.source) : 'HINT'
    });
  }
  for (const hint of hints || []) {
    const requestedLocalAddress = typeof hint === 'object' ? hint?.localAddress : null;
    for (const entry of interfaces || []) {
      if (requestedLocalAddress && requestedLocalAddress !== entry.address) continue;
      add(hint, entry);
    }
  }
  return candidates;
}

function waitForConnect(socket) {
  if (!socket.connecting) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}

function handshakeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function acceptReverseMagic(socket, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => finish(handshakeError('reverse LAN handshake timeout', 'HANDSHAKE_TIMEOUT')), timeoutMs);
    timer.unref?.();
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    function finish(error, remainder = null) {
      cleanup();
      if (error) reject(error);
      else resolve(remainder || Buffer.alloc(0));
    }
    function onError(error) { finish(error); }
    function onClose() { finish(handshakeError('reverse LAN peer closed during handshake', 'HANDSHAKE_CLOSED')); }
    function onData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(10);
      if (newline < 0) {
        if (buffered.length > MAX_REVERSE_PREFACE_BYTES) {
          return finish(handshakeError('reverse LAN handshake is too large', 'HANDSHAKE_TOO_LARGE'));
        }
        return;
      }
      if (newline + 1 > MAX_REVERSE_PREFACE_BYTES) {
        return finish(handshakeError('reverse LAN handshake is too large', 'HANDSHAKE_TOO_LARGE'));
      }
      const line = buffered.subarray(0, newline + 1).toString('ascii');
      if (line !== REVERSE_LAN_MAGIC) return finish(handshakeError('reverse LAN handshake is invalid', 'HANDSHAKE_INVALID'));
      socket.pause();
      finish(null, buffered.subarray(newline + 1));
    }
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function createMobileReverseLanTransport({
  httpsPort,
  interfacesProvider,
  candidateProvider = async () => [],
  pairingActive = () => false,
  pairedDeviceCount = () => 0,
  connectionNeeded = () => true,
  onStateChange = () => {},
  logger = console,
  transportMode = TRANSPORT_MODE.AUTO,
  reversePort = REVERSE_LAN_PORT,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  authenticationTimeoutMs = REVERSE_AUTHENTICATION_TIMEOUT_MS,
  activeScanIntervalMs = ACTIVE_SCAN_INTERVAL_MS,
  idleScanIntervalMs = IDLE_SCAN_INTERVAL_MS
} = {}) {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535) throw new Error('mobile HTTPS port is required');
  if (typeof interfacesProvider !== 'function') throw new Error('physical LAN interface provider is required');
  if (typeof candidateProvider !== 'function') throw new Error('bounded peer candidate provider is required');
  if (!Object.values(TRANSPORT_MODE).includes(transportMode)) throw new Error('mobile transport mode is invalid');
  let stopped = true;
  let timer = null;
  let scanning = false;
  let lastFailureLogAt = 0;
  let interfaceSignature = null;
  const lastSuccessfulCandidates = [];
  const retryByCandidate = new Map();
  const bridges = new Set();
  const pendingSockets = new Set();
  const peerByHttpsRemotePort = new Map();

  function state(value, detail = {}) {
    try { onStateChange(value, detail); } catch (_) {}
  }

  function candidateKey(candidate) {
    return `${candidate.localAddress}|${candidate.host}`;
  }

  function rememberCandidate(candidate) {
    const key = candidateKey(candidate);
    const index = lastSuccessfulCandidates.findIndex((entry) => candidateKey(entry) === key);
    if (index >= 0) lastSuccessfulCandidates.splice(index, 1);
    lastSuccessfulCandidates.unshift({ ...candidate, source: 'RECENT_SUCCESS' });
    if (lastSuccessfulCandidates.length > 8) lastSuccessfulCandidates.length = 8;
    retryByCandidate.delete(key);
  }

  function closeBridge(bridge, { reconnect = true } = {}) {
    if (!bridges.delete(bridge)) return;
    peerByHttpsRemotePort.delete(bridge.localSourcePort);
    clearTimeout(bridge.authenticationTimer);
    bridge.remote.destroy();
    bridge.local.destroy();
    if (!stopped && reconnect && bridges.size === 0) {
      state('RECONNECTING');
      schedule(0);
    }
  }

  async function connectCandidate(candidate) {
    let stage = 'TCP_CONNECT';
    let local = null;
    state('CONNECTING', { source: candidate.source });
    const remote = net.createConnection({
      host: candidate.host,
      port: reversePort,
      localAddress: candidate.localAddress,
      family: 4
    });
    pendingSockets.add(remote);
    remote.setTimeout(connectTimeoutMs, () => {
      remote.destroy(handshakeError('reverse LAN connect timeout', 'CONNECT_TIMEOUT'));
    });
    try {
      await waitForConnect(remote);
      stage = 'REVERSE_PREFACE';
      const remainder = await acceptReverseMagic(remote, connectTimeoutMs);
      stage = 'LOCAL_HTTPS_CONNECT';
      local = net.createConnection({ host: '127.0.0.1', port: httpsPort, family: 4 });
      pendingSockets.add(local);
      try {
        await waitForConnect(local);
      } finally {
        pendingSockets.delete(local);
      }
      if (stopped || bridges.size) {
        remote.destroy();
        local.destroy();
        return { connected: bridges.size > 0, candidate, errorCode: stopped ? 'CANCELLED' : null, reused: true };
      }
      remote.setTimeout(0);
      if (remainder.length) remote.unshift(remainder);
      const localSourcePort = local.localPort;
      const bridge = { remote, local, localSourcePort, candidate, authenticated: false, authenticationTimer: null };
      bridges.add(bridge);
      bridge.authenticationTimer = setTimeout(() => closeBridge(bridge), authenticationTimeoutMs);
      bridge.authenticationTimer.unref?.();
      peerByHttpsRemotePort.set(localSourcePort, bridge);
      bridge.peer = {
        host: candidate.host,
        port: reversePort,
        localAddress: candidate.localAddress,
        source: 'REVERSE_AUTHENTICATED'
      };
      const close = () => closeBridge(bridge);
      remote.once('error', close);
      local.once('error', close);
      remote.once('close', close);
      local.once('close', close);
      remote.pipe(local);
      local.pipe(remote);
      remote.resume();
      rememberCandidate(candidate);
      state('AUTHENTICATING', { source: candidate.source });
      logger.log?.(`[mobile-reverse-lan] physical ${candidate.localAddress} -> ${candidate.host}:${reversePort} -> HTTPS 127.0.0.1:${httpsPort}`);
      return { connected: true, candidate, errorCode: null };
    } catch (error) {
      remote.destroy();
      local?.destroy();
      return {
        connected: false,
        candidate,
        errorCode: `${stage}:${error?.code || error?.name || 'UNKNOWN'}`
      };
    } finally {
      pendingSockets.delete(remote);
    }
  }

  async function runCandidates(candidates) {
    let cursor = 0;
    let connected = false;
    const failures = new Map();
    const outcomes = [];
    async function worker() {
      while (!connected && !stopped) {
        const index = cursor;
        cursor += 1;
        if (index >= candidates.length) return;
        const result = await connectCandidate(candidates[index]);
        outcomes.push(result);
        if (result.connected) connected = true;
        else failures.set(result.errorCode, (failures.get(result.errorCode) || 0) + 1);
      }
    }
    const count = Math.min(MAX_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: count }, worker));
    return { connected, failures, outcomes };
  }

  function updateRetryBackoff(outcomes, now, active) {
    for (const outcome of outcomes) {
      if (outcome.connected) continue;
      const key = candidateKey(outcome.candidate);
      const previous = retryByCandidate.get(key) || { failures: 0 };
      const failures = previous.failures + 1;
      retryByCandidate.set(key, {
        failures,
        nextAttemptAt: now + retryDelayMillis(failures, active)
      });
    }
  }

  async function scanOnce(now = Date.now()) {
    if (stopped || scanning) return false;
    scanning = true;
    try {
      const active = Boolean(pairingActive());
      const paired = Number(pairedDeviceCount()) > 0;
      if (!active && !paired) return false;
      const interfaces = interfacesProvider();
      const signature = interfaces.map((entry) => `${entry.interface || ''}|${entry.address}|${entry.netmask || ''}`).sort().join(',');
      let networkChanged = false;
      if (interfaceSignature === null) interfaceSignature = signature;
      else if (signature !== interfaceSignature) {
        interfaceSignature = signature;
        retryByCandidate.clear();
        for (const bridge of [...bridges]) closeBridge(bridge, { reconnect: false });
        networkChanged = true;
        state('RECONNECTING', { reason: 'NETWORK_CHANGED' });
      }
      if (transportMode === TRANSPORT_MODE.DIRECT_MOBILE_TO_PC) return false;
      if (!active && !networkChanged && !connectionNeeded()) return false;
      if (bridges.size) return true;
      state('DISCOVERING');
      let provided = [];
      try {
        provided = await candidateProvider({ interfaces, active, paired });
      } catch (_) {
        provided = [];
      }
      const candidates = subnetCandidates(interfaces, {
        hints: [...lastSuccessfulCandidates, ...(provided || [])]
      });
      const eligible = candidates.filter((candidate) => now >= (retryByCandidate.get(candidateKey(candidate))?.nextAttemptAt || 0));
      if (!eligible.length) {
        if (!networkChanged) state('OFFLINE', { candidates: candidates.length });
        return false;
      }
      const result = await runCandidates(eligible);
      updateRetryBackoff(result.outcomes, now, active);
      if (!result.connected) {
        if (!networkChanged) state('OFFLINE', { candidates: eligible.length });
        if (now - lastFailureLogAt >= DIAGNOSTIC_LOG_INTERVAL_MS) {
          lastFailureLogAt = now;
          const failureSummary = [...result.failures.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([code, count]) => `${code}:${count}`)
            .join(',') || 'NONE';
          const sources = interfaces.map((entry) => `${entry.interface || 'unknown'}=${entry.address}`).join(',') || 'NONE';
          logger.log?.(`[mobile-reverse-lan] bounded result=no_peer sources=${sources} candidates=${eligible.length} failures=${failureSummary}`);
        }
      }
      return result.connected;
    } finally {
      scanning = false;
    }
  }

  function authenticatedPeerCandidate(socket) {
    const remoteAddress = String(socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (remoteAddress === '127.0.0.1' || remoteAddress === '::1') {
      const bridge = peerByHttpsRemotePort.get(Number(socket?.remotePort));
      if (!bridge) return null;
      bridge.authenticated = true;
      clearTimeout(bridge.authenticationTimer);
      bridge.authenticationTimer = null;
      return { ...bridge.peer };
    }
    if (isPrivateLanIpv4(remoteAddress)) {
      return { host: remoteAddress, port: reversePort, source: 'DIRECT_AUTHENTICATED' };
    }
    const unscoped = remoteAddress.split('%')[0];
    const family = net.isIP(unscoped);
    if (family === 4) {
      const first = Number(unscoped.split('.')[0]);
      if (first > 0 && first < 224 && first !== 127) {
        return { host: unscoped, port: reversePort, source: 'CAMPUS_ROUTED_AUTHENTICATED' };
      }
    }
    if (family === 6 && unscoped !== '::' && unscoped !== '::1' && !unscoped.toLowerCase().startsWith('ff')) {
      return { host: unscoped.toLowerCase(), port: reversePort, source: 'CAMPUS_ROUTED_AUTHENTICATED' };
    }
    return null;
  }

  function schedule(delay) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await scanOnce(); } catch (_) {}
      schedule(pairingActive() ? activeScanIntervalMs : idleScanIntervalMs);
    }, delay);
    timer.unref?.();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    state('DISCOVERING');
    schedule(0);
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    timer = null;
    for (const socket of pendingSockets) socket.destroy();
    pendingSockets.clear();
    for (const bridge of [...bridges]) closeBridge(bridge);
    peerByHttpsRemotePort.clear();
  }

  return { authenticatedPeerCandidate, scanOnce, start, stop };
}

module.exports = {
  ACTIVE_SCAN_INTERVAL_MS,
  IDLE_SCAN_INTERVAL_MS,
  MAX_CANDIDATES,
  MAX_REVERSE_PREFACE_BYTES,
  REVERSE_AUTHENTICATION_TIMEOUT_MS,
  REVERSE_LAN_MAGIC,
  REVERSE_LAN_PORT,
  TRANSPORT_MODE,
  acceptReverseMagic,
  createMobileReverseLanTransport,
  retryDelayMillis,
  subnetCandidates
};
