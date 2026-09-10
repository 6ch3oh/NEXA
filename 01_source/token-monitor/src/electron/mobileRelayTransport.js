'use strict';

const net = require('node:net');
const tls = require('node:tls');
const {
  createRelayRegistration,
  encodeRelayRegistration
} = require('../shared/mobileRelayProtocol');

const LOCAL_MOBILE_HTTPS_HOST = '127.0.0.1';
const DEFAULT_LOCAL_MOBILE_HTTPS_PORT = 17322;
const DEFAULT_RELAY_CONNECT_TIMEOUT_MS = 10_000;
const RELAY_TRANSPORT_STATES = Object.freeze({
  STOPPED: 'STOPPED',
  CONNECTING: 'CONNECTING',
  WAITING_FOR_MOBILE: 'WAITING_FOR_MOBILE',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  FAILED: 'FAILED'
});

function transportError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function waitForSocket(socket, eventName, timeoutMs, timeoutCode) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(transportError(timeoutCode));
    }, Math.max(1, Number(timeoutMs) || DEFAULT_RELAY_CONNECT_TIMEOUT_MS));
    timer.unref?.();
    function cleanup() {
      clearTimeout(timer);
      socket.off(eventName, onReady);
      socket.off('error', onError);
      socket.off('close', onClose);
    }
    function onReady() { cleanup(); resolve(); }
    function onError(error) { cleanup(); reject(error); }
    function onClose() { cleanup(); reject(transportError('RELAY_CONNECTION_CLOSED')); }
    socket.once(eventName, onReady);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function createMobileRelayTransport({
  relayHost,
  relayPort,
  relayServername = relayHost,
  relayCa = undefined,
  rendezvousIdProvider,
  localHttpsPort = DEFAULT_LOCAL_MOBILE_HTTPS_PORT,
  connectTimeoutMs = DEFAULT_RELAY_CONNECT_TIMEOUT_MS,
  now = () => Date.now(),
  randomBytes = undefined,
  onStateChange = () => {},
  logger = console,
  tlsModule = tls,
  netModule = net
} = {}) {
  if (typeof relayHost !== 'string' || !relayHost.trim()) throw new Error('Relay host is required');
  if (!Number.isInteger(relayPort) || relayPort < 1 || relayPort > 65535) throw new Error('Relay port is invalid');
  if (typeof rendezvousIdProvider !== 'function') throw new Error('Opaque rendezvous id provider is required');
  if (!Number.isInteger(localHttpsPort) || localHttpsPort < 1 || localHttpsPort > 65535) {
    throw new Error('Existing local Mobile HTTPS port is invalid');
  }

  let state = RELAY_TRANSPORT_STATES.STOPPED;
  let relaySocket = null;
  let localSocket = null;
  let localBridgeSourcePort = null;
  let generation = 0;
  let stopped = true;

  function log(code) {
    try { logger.log?.(`[mobile-relay-transport] ${code}`); } catch (_) {}
  }

  function transition(next) {
    state = next;
    try { onStateChange(next); } catch (_) {}
  }

  function closeSockets() {
    const relay = relaySocket;
    const local = localSocket;
    relaySocket = null;
    localSocket = null;
    localBridgeSourcePort = null;
    relay?.unpipe(local);
    local?.unpipe(relay);
    relay?.destroy();
    local?.destroy();
  }

  async function start() {
    if (!stopped) return getState();
    stopped = false;
    generation += 1;
    const currentGeneration = generation;
    transition(RELAY_TRANSPORT_STATES.CONNECTING);
    try {
      const rendezvousId = rendezvousIdProvider();
      const issuedAt = now();
      const registration = createRelayRegistration({
        role: 'DESKTOP',
        rendezvousId,
        now: issuedAt,
        ...(randomBytes ? { randomBytes } : {})
      });
      const registrationFrame = encodeRelayRegistration(registration, { now: issuedAt });
      const relay = tlsModule.connect({
        host: relayHost,
        port: relayPort,
        servername: relayServername,
        ...(relayCa === undefined ? {} : { ca: relayCa }),
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      });
      relaySocket = relay;
      relay.on('error', () => {});
      await waitForSocket(relay, 'secureConnect', connectTimeoutMs, 'RELAY_TLS_TIMEOUT');
      if (!relay.authorized) throw transportError('RELAY_TLS_UNTRUSTED');
      await new Promise((resolve, reject) => {
        relay.write(registrationFrame, (error) => error ? reject(error) : resolve());
      });
      const local = netModule.createConnection({
        host: LOCAL_MOBILE_HTTPS_HOST,
        port: localHttpsPort,
        family: 4
      });
      localSocket = local;
      local.on('error', () => {});
      await waitForSocket(local, 'connect', connectTimeoutMs, 'LOCAL_HTTPS_CONNECT_TIMEOUT');
      if (stopped || currentGeneration !== generation) throw transportError('RELAY_TRANSPORT_CANCELLED');
      if (relay.destroyed) throw transportError('RELAY_CONNECTION_CLOSED');
      localBridgeSourcePort = Number(local.localPort) || null;
      let connected = false;
      let bridgeClosed = false;
      relay.once('data', () => {
        if (stopped || currentGeneration !== generation) return;
        connected = true;
        transition(RELAY_TRANSPORT_STATES.CONNECTED);
      });
      const closed = () => {
        if (bridgeClosed || stopped || currentGeneration !== generation) return;
        bridgeClosed = true;
        closeSockets();
        transition(connected ? RELAY_TRANSPORT_STATES.DISCONNECTED : RELAY_TRANSPORT_STATES.FAILED);
      };
      relay.once('close', closed);
      local.once('close', closed);
      relay.pipe(local);
      local.pipe(relay);
      transition(RELAY_TRANSPORT_STATES.WAITING_FOR_MOBILE);
      log('REGISTERED');
      return getState();
    } catch (error) {
      closeSockets();
      if (!stopped && currentGeneration === generation) transition(RELAY_TRANSPORT_STATES.FAILED);
      log(String(error?.code || 'CONNECT_FAILED'));
      throw error;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    generation += 1;
    closeSockets();
    transition(RELAY_TRANSPORT_STATES.STOPPED);
  }

  async function restart() {
    stop();
    return start();
  }

  function authenticatedPeerCandidate(socket) {
    const remoteAddress = String(socket?.remoteAddress || '').replace(/^::ffff:/, '').toLowerCase();
    const loopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1';
    if (stopped || state !== RELAY_TRANSPORT_STATES.CONNECTED || !loopback ||
      !localBridgeSourcePort || Number(socket?.remotePort) !== localBridgeSourcePort) return null;
    return Object.freeze({
      source: 'RELAY_AUTHENTICATED',
      transport: 'SECURE_RELAY'
    });
  }

  function getState() {
    return Object.freeze({
      state,
      role: 'DESKTOP',
      relay_tls_required: true,
      local_target: `${LOCAL_MOBILE_HTTPS_HOST}:${localHttpsPort}`
    });
  }

  return { authenticatedPeerCandidate, getState, restart, start, stop };
}

module.exports = {
  DEFAULT_LOCAL_MOBILE_HTTPS_PORT,
  DEFAULT_RELAY_CONNECT_TIMEOUT_MS,
  LOCAL_MOBILE_HTTPS_HOST,
  RELAY_TRANSPORT_STATES,
  createMobileRelayTransport
};
