'use strict';

const crypto = require('node:crypto');
const tls = require('node:tls');
const {
  RELAY_REGISTRATION_TIMEOUT_MS,
  readRelayRegistration
} = require('../shared/mobileRelayProtocol');

const DEFAULT_RELAY_HOST = '127.0.0.1';
const DEFAULT_RELAY_PORT = 17443;
const DEFAULT_MAX_CLIENTS = 128;
const DEFAULT_WAIT_TTL_MS = 30_000;
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_SESSION_BYTE_LIMIT = 16 * 1024 * 1024;
const DEFAULT_NONCE_TTL_MS = 2 * 60 * 1_000;
const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_RATE_WINDOW_MS = 60_000;

function relayError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizedRemoteAddress(socket) {
  return String(socket?.remoteAddress || '').replace(/^::ffff:/, '').toLowerCase() || 'unknown';
}

function opaqueMapKey(domain, value) {
  return crypto.createHash('sha256')
    .update(`nexa-relay-${domain}-v0.1\0${String(value)}`, 'utf8')
    .digest('hex');
}

function createMobileRelayServer({
  key,
  cert,
  host = DEFAULT_RELAY_HOST,
  port = DEFAULT_RELAY_PORT,
  maxClients = DEFAULT_MAX_CLIENTS,
  waitTtlMs = DEFAULT_WAIT_TTL_MS,
  sessionTimeoutMs = DEFAULT_SESSION_TIMEOUT_MS,
  sessionIdleTimeoutMs = DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionByteLimit = DEFAULT_SESSION_BYTE_LIMIT,
  registrationTimeoutMs = RELAY_REGISTRATION_TIMEOUT_MS,
  nonceTtlMs = DEFAULT_NONCE_TTL_MS,
  rateLimit = DEFAULT_RATE_LIMIT,
  rateWindowMs = DEFAULT_RATE_WINDOW_MS,
  now = () => Date.now(),
  logger = console
} = {}) {
  if (!key || !cert) throw new Error('Relay TLS key and certificate are required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Relay port is invalid');
  if (!Number.isInteger(maxClients) || maxClients < 2) throw new Error('Relay maxClients must be at least two');
  if (!Number.isInteger(sessionByteLimit) || sessionByteLimit < 1) throw new Error('Relay sessionByteLimit must be positive');

  const waitingByRendezvous = new Map();
  const sessions = new Set();
  const secureSockets = new Set();
  const seenNonces = new Map();
  const consumedRendezvous = new Map();
  const rateByAddress = new Map();
  let stopped = true;

  function log(code) {
    try { logger.log?.(`[mobile-relay] ${code}`); } catch (_) {}
  }

  function cleanExpiringState(current = now()) {
    for (const [nonce, expiresAt] of seenNonces) {
      if (expiresAt <= current) seenNonces.delete(nonce);
    }
    for (const [rendezvousId, expiresAt] of consumedRendezvous) {
      if (expiresAt <= current) consumedRendezvous.delete(rendezvousId);
    }
    for (const [address, state] of rateByAddress) {
      if (state.windowStartedAt + rateWindowMs <= current) rateByAddress.delete(address);
    }
  }

  function acceptRate(socket) {
    const current = now();
    cleanExpiringState(current);
    const address = normalizedRemoteAddress(socket);
    let state = rateByAddress.get(address);
    if (!state || current - state.windowStartedAt >= rateWindowMs) {
      state = { windowStartedAt: current, count: 0 };
      rateByAddress.set(address, state);
    }
    state.count += 1;
    return state.count <= rateLimit;
  }

  function removeWaitingPeer(peer) {
    if (!peer?.waiting) return;
    peer.waiting = false;
    clearTimeout(peer.waitTimer);
    const entry = waitingByRendezvous.get(peer.rendezvousKey);
    if (!entry || entry[peer.role] !== peer) return;
    delete entry[peer.role];
    if (!entry.DESKTOP && !entry.MOBILE) waitingByRendezvous.delete(peer.rendezvousKey);
  }

  function rejectPeer(peer, code) {
    removeWaitingPeer(peer);
    log(code);
    peer.socket.destroy(relayError(code));
  }

  function closeSession(session, code = 'SESSION_CLOSED') {
    if (!sessions.delete(session)) return;
    clearTimeout(session.timer);
    clearTimeout(session.idleTimer);
    consumedRendezvous.delete(session.rendezvousKey);
    session.desktop.socket.off('data', session.onActivity);
    session.mobile.socket.off('data', session.onActivity);
    session.desktop.socket.unpipe(session.mobile.socket);
    session.mobile.socket.unpipe(session.desktop.socket);
    session.desktop.socket.destroy();
    session.mobile.socket.destroy();
    log(code);
  }

  function pairIfReady(entry) {
    if (!entry?.DESKTOP || !entry?.MOBILE) return false;
    const desktop = entry.DESKTOP;
    const mobile = entry.MOBILE;
    waitingByRendezvous.delete(desktop.rendezvousKey);
    consumedRendezvous.set(
      desktop.rendezvousKey,
      now() + Math.max(1, Number(nonceTtlMs) || DEFAULT_NONCE_TTL_MS)
    );
    for (const peer of [desktop, mobile]) {
      peer.waiting = false;
      clearTimeout(peer.waitTimer);
    }
    const session = {
      desktop,
      mobile,
      rendezvousKey: desktop.rendezvousKey,
      timer: null,
      idleTimer: null,
      bytesForwarded: 0,
      onActivity: null
    };
    sessions.add(session);
    session.timer = setTimeout(
      () => closeSession(session, 'SESSION_TIMEOUT'),
      Math.max(1, Number(sessionTimeoutMs) || DEFAULT_SESSION_TIMEOUT_MS)
    );
    session.timer.unref?.();
    const refreshIdleTimeout = () => {
      clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(
        () => closeSession(session, 'SESSION_IDLE_TIMEOUT'),
        Math.max(1, Number(sessionIdleTimeoutMs) || DEFAULT_SESSION_IDLE_TIMEOUT_MS)
      );
      session.idleTimer.unref?.();
    };
    session.onActivity = (chunk) => {
      session.bytesForwarded += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (session.bytesForwarded > sessionByteLimit) {
        closeSession(session, 'SESSION_BYTE_LIMIT');
        return;
      }
      refreshIdleTimeout();
    };
    desktop.socket.on('data', session.onActivity);
    mobile.socket.on('data', session.onActivity);
    refreshIdleTimeout();
    const close = () => closeSession(session);
    desktop.socket.once('close', close);
    mobile.socket.once('close', close);
    desktop.socket.on('error', () => {});
    mobile.socket.on('error', () => {});
    if (desktop.remainder.length) desktop.socket.unshift(desktop.remainder);
    if (mobile.remainder.length) mobile.socket.unshift(mobile.remainder);
    desktop.remainder = Buffer.alloc(0);
    mobile.remainder = Buffer.alloc(0);
    desktop.socket.pipe(mobile.socket);
    mobile.socket.pipe(desktop.socket);
    desktop.socket.resume();
    mobile.socket.resume();
    log('SESSION_PAIRED');
    return true;
  }

  function rememberNonce(registration) {
    cleanExpiringState();
    const nonceKey = opaqueMapKey('nonce', registration.nonce);
    if (seenNonces.has(nonceKey)) return false;
    seenNonces.set(nonceKey, now() + Math.max(1, Number(nonceTtlMs) || DEFAULT_NONCE_TTL_MS));
    return true;
  }

  async function handleSecureSocket(socket) {
    secureSockets.add(socket);
    socket.once('close', () => secureSockets.delete(socket));
    socket.on('error', () => {});
    socket.setNoDelay?.(true);
    if (secureSockets.size > maxClients) {
      log('CLIENT_LIMIT');
      socket.destroy(relayError('CLIENT_LIMIT'));
      return;
    }
    if (!acceptRate(socket)) {
      log('RATE_LIMITED');
      socket.destroy(relayError('RATE_LIMITED'));
      return;
    }
    try {
      const parsed = await readRelayRegistration(socket, {
        now,
        timeoutMs: registrationTimeoutMs
      });
      if (stopped) throw relayError('RELAY_STOPPED');
      if (!rememberNonce(parsed.registration)) throw relayError('NONCE_REPLAY');
      const rendezvousKey = opaqueMapKey('rendezvous', parsed.registration.rendezvous_id);
      const role = parsed.registration.role;
      if (consumedRendezvous.has(rendezvousKey)) throw relayError('RENDEZVOUS_CONSUMED');
      const entry = waitingByRendezvous.get(rendezvousKey) || {};
      if (entry[role]) throw relayError('ROLE_CONFLICT');
      const peer = {
        socket,
        role,
        rendezvousKey,
        remainder: parsed.remainder,
        waiting: true,
        waitTimer: null
      };
      entry[role] = peer;
      waitingByRendezvous.set(rendezvousKey, entry);
      peer.waitTimer = setTimeout(
        () => rejectPeer(peer, 'WAIT_TIMEOUT'),
        Math.max(1, Number(waitTtlMs) || DEFAULT_WAIT_TTL_MS)
      );
      peer.waitTimer.unref?.();
      socket.once('close', () => removeWaitingPeer(peer));
      pairIfReady(entry);
    } catch (error) {
      const code = String(error?.code || 'REGISTRATION_REJECTED');
      log(code);
      socket.destroy(relayError(code));
    }
  }

  const server = tls.createServer({
    key,
    cert,
    minVersion: 'TLSv1.2',
    handshakeTimeout: Math.max(1, Number(registrationTimeoutMs) || RELAY_REGISTRATION_TIMEOUT_MS)
  }, (socket) => {
    handleSecureSocket(socket).catch(() => socket.destroy());
  });
  server.maxConnections = maxClients;
  server.on('tlsClientError', () => log('TLS_CLIENT_REJECTED'));
  server.on('error', () => {});

  function start() {
    if (!stopped) return Promise.resolve();
    stopped = false;
    return new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); stopped = true; reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  function stop() {
    if (stopped) return Promise.resolve();
    stopped = true;
    for (const entry of waitingByRendezvous.values()) {
      if (entry.DESKTOP) rejectPeer(entry.DESKTOP, 'RELAY_STOPPED');
      if (entry.MOBILE) rejectPeer(entry.MOBILE, 'RELAY_STOPPED');
    }
    waitingByRendezvous.clear();
    for (const session of [...sessions]) closeSession(session, 'RELAY_STOPPED');
    for (const socket of secureSockets) socket.destroy();
    secureSockets.clear();
    seenNonces.clear();
    consumedRendezvous.clear();
    rateByAddress.clear();
    return new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
  }

  function getStats() {
    let waitingClients = 0;
    for (const entry of waitingByRendezvous.values()) {
      if (entry.DESKTOP) waitingClients += 1;
      if (entry.MOBILE) waitingClients += 1;
    }
    return Object.freeze({
      listening: server.listening,
      connected_clients: secureSockets.size,
      waiting_clients: waitingClients,
      active_sessions: sessions.size,
      replay_nonce_count: seenNonces.size
    });
  }

  return {
    address: () => server.address(),
    getStats,
    server,
    start,
    stop
  };
}

module.exports = {
  DEFAULT_MAX_CLIENTS,
  DEFAULT_NONCE_TTL_MS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
  DEFAULT_RELAY_HOST,
  DEFAULT_RELAY_PORT,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_BYTE_LIMIT,
  DEFAULT_WAIT_TTL_MS,
  createMobileRelayServer
};
