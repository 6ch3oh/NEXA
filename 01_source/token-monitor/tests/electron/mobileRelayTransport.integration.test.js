'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const test = require('node:test');

const {
  LOCAL_MOBILE_HTTPS_HOST,
  RELAY_TRANSPORT_STATES,
  createMobileRelayTransport
} = require('../../src/electron/mobileRelayTransport');
const { createMobileRelayServer } = require('../../src/relay/server');
const {
  RELAY_CONTRACT_VERSION,
  encodeRelayRegistration
} = require('../../src/shared/mobileRelayProtocol');
const { loadMobileTlsIdentity } = require('../../src/shared/mobileTlsIdentity');

const RENDEZVOUS_ID = 'c'.repeat(64);

function waitForEvent(emitter, eventName, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${eventName} timed out`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      emitter.off(eventName, onEvent);
      emitter.off('error', onError);
    }
    function onEvent(...args) { cleanup(); resolve(args); }
    function onError(error) { cleanup(); reject(error); }
    emitter.once(eventName, onEvent);
    emitter.once('error', onError);
  });
}

function readBytes(socket, expectedLength, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('inner TLS payload timed out'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onClose);
    }
    function onClose() {
      cleanup();
      reject(new Error('inner TLS socket closed early'));
    }
    function onData(chunk) {
      chunks.push(chunk);
      length += chunk.length;
      if (length < expectedLength) return;
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    socket.on('data', onData);
    socket.once('close', onClose);
  });
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('transport state timed out');
}

test('Desktop outbound relay transport carries a real nested TLS session to fixed local HTTPS', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-mobile-relay-transport-'));
  const relayIdentity = loadMobileTlsIdentity(path.join(directory, 'relay-tls'));
  const localIdentity = loadMobileTlsIdentity(path.join(directory, 'local-tls'));
  const relay = createMobileRelayServer({
    key: relayIdentity.privateKeyPem,
    cert: relayIdentity.certificatePem,
    host: '127.0.0.1',
    port: 0,
    waitTtlMs: 3_000,
    sessionTimeoutMs: 5_000,
    logger: { log() {} }
  });
  const localSockets = new Set();
  let authenticatedCandidate = null;
  let transport;
  const localHttps = tls.createServer({
    key: localIdentity.privateKeyPem,
    cert: localIdentity.certificatePem,
    minVersion: 'TLSv1.2'
  }, (socket) => {
    localSockets.add(socket);
    authenticatedCandidate = transport?.authenticatedPeerCandidate(socket) || null;
    socket.once('close', () => localSockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => socket.write(chunk));
  });
  let mobileOuter;
  let mobileInner;
  try {
    await relay.start();
    await new Promise((resolve, reject) => {
      localHttps.once('error', reject);
      localHttps.listen(0, LOCAL_MOBILE_HTTPS_HOST, resolve);
    });
    const states = [];
    const rendezvousIds = [RENDEZVOUS_ID, 'd'.repeat(64)];
    transport = createMobileRelayTransport({
      relayHost: '127.0.0.1',
      relayPort: relay.address().port,
      relayServername: 'localhost',
      relayCa: relayIdentity.certificatePem,
      rendezvousIdProvider: () => rendezvousIds.shift(),
      localHttpsPort: localHttps.address().port,
      onStateChange: (state) => states.push(state),
      logger: { log() {} }
    });
    const started = await transport.start();
    assert.equal(started.state, RELAY_TRANSPORT_STATES.WAITING_FOR_MOBILE);
    assert.equal(started.local_target, `127.0.0.1:${localHttps.address().port}`);

    mobileOuter = tls.connect({
      host: '127.0.0.1',
      port: relay.address().port,
      servername: 'localhost',
      ca: relayIdentity.certificatePem,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    });
    mobileOuter.on('error', () => {});
    await waitForEvent(mobileOuter, 'secureConnect');
    const mobileRegistration = {
      contract_version: RELAY_CONTRACT_VERSION,
      role: 'MOBILE',
      rendezvous_id: RENDEZVOUS_ID,
      issued_at_epoch_ms: Date.now(),
      nonce: Buffer.alloc(24, 0x44).toString('base64url')
    };
    await new Promise((resolve) => mobileOuter.write(encodeRelayRegistration(mobileRegistration), resolve));

    mobileInner = tls.connect({
      socket: mobileOuter,
      servername: 'localhost',
      ca: localIdentity.certificatePem,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    });
    mobileInner.on('error', () => {});
    await waitForEvent(mobileInner, 'secureConnect');
    const payload = Buffer.from('pinned-inner-tls-through-opaque-relay', 'utf8');
    const echoed = readBytes(mobileInner, payload.length);
    mobileInner.write(payload);
    assert.deepEqual(await echoed, payload);
    await waitFor(() => transport.getState().state === RELAY_TRANSPORT_STATES.CONNECTED);
    assert.equal(states.includes(RELAY_TRANSPORT_STATES.CONNECTED), true);
    assert.equal(relay.getStats().active_sessions, 1);
    assert.deepEqual(authenticatedCandidate, {
      source: 'RELAY_AUTHENTICATED',
      transport: 'SECURE_RELAY'
    });
    assert.equal(transport.authenticatedPeerCandidate({
      remoteAddress: '127.0.0.1',
      remotePort: 1
    }), null);

    mobileInner.destroy();
    mobileOuter.destroy();
    mobileInner = null;
    mobileOuter = null;
    await waitFor(() => transport.getState().state === RELAY_TRANSPORT_STATES.DISCONNECTED);
    const restarted = await transport.restart();
    assert.equal(restarted.state, RELAY_TRANSPORT_STATES.WAITING_FOR_MOBILE);
    assert.equal(transport.authenticatedPeerCandidate({
      remoteAddress: '127.0.0.1',
      remotePort: 1
    }), null);
  } finally {
    transport?.stop();
    mobileInner?.destroy();
    mobileOuter?.destroy();
    for (const socket of localSockets) socket.destroy();
    await new Promise((resolve) => {
      if (!localHttps.listening) return resolve();
      localHttps.close(() => resolve());
      localHttps.closeAllConnections?.();
    });
    await relay.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Desktop transport refuses an untrusted Relay certificate before opening the local bridge', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-mobile-relay-untrusted-'));
  const relayIdentity = loadMobileTlsIdentity(path.join(directory, 'relay-tls'));
  const unrelatedIdentity = loadMobileTlsIdentity(path.join(directory, 'unrelated-tls'));
  const relay = createMobileRelayServer({
    key: relayIdentity.privateKeyPem,
    cert: relayIdentity.certificatePem,
    host: '127.0.0.1',
    port: 0,
    logger: { log() {} }
  });
  let transport;
  try {
    await relay.start();
    transport = createMobileRelayTransport({
      relayHost: '127.0.0.1',
      relayPort: relay.address().port,
      relayServername: 'localhost',
      relayCa: unrelatedIdentity.certificatePem,
      rendezvousIdProvider: () => RENDEZVOUS_ID,
      localHttpsPort: 17322,
      connectTimeoutMs: 1_000,
      logger: { log() {} }
    });
    await assert.rejects(transport.start(), (error) => (
      error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      error.code === 'SELF_SIGNED_CERT_IN_CHAIN'
    ));
    assert.equal(transport.getState().state, RELAY_TRANSPORT_STATES.FAILED);
    assert.equal(relay.getStats().active_sessions, 0);
  } finally {
    transport?.stop();
    await relay.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
