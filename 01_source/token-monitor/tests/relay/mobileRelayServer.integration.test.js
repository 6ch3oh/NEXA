'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const test = require('node:test');

const { createMobileRelayServer } = require('../../src/relay/server');
const {
  MAX_RELAY_REGISTRATION_BYTES,
  RELAY_CONTRACT_VERSION,
  encodeRelayRegistration
} = require('../../src/shared/mobileRelayProtocol');
const { loadMobileTlsIdentity } = require('../../src/shared/mobileTlsIdentity');

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

function registration(role, rendezvousId, nonce) {
  const value = {
    contract_version: RELAY_CONTRACT_VERSION,
    role,
    rendezvous_id: rendezvousId,
    issued_at_epoch_ms: Date.now(),
    nonce
  };
  return encodeRelayRegistration(value);
}

function nonce(byte) {
  return Buffer.alloc(24, byte).toString('base64url');
}

function connectTls(port, certificatePem) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: '127.0.0.1',
      port,
      servername: 'localhost',
      ca: certificatePem,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    });
    socket.on('error', () => {});
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readBytes(socket, expectedLength, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('relay payload timed out'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onClose);
    }
    function onClose() {
      cleanup();
      reject(new Error('relay socket closed before payload completed'));
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

function waitForClose(socket, timeoutMs = 2_000) {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('relay socket did not close'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off('close', onClose);
    }
    function onClose() { cleanup(); resolve(); }
    socket.once('close', onClose);
  });
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('relay state timed out');
}

async function startFixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-mobile-relay-server-'));
  const identity = loadMobileTlsIdentity(path.join(directory, 'tls'));
  const logs = [];
  const relay = createMobileRelayServer({
    key: identity.privateKeyPem,
    cert: identity.certificatePem,
    port: 0,
    host: '127.0.0.1',
    waitTtlMs: options.waitTtlMs || 1_000,
    sessionTimeoutMs: options.sessionTimeoutMs || 5_000,
    sessionIdleTimeoutMs: options.sessionIdleTimeoutMs || 2_000,
    sessionByteLimit: options.sessionByteLimit || 1024 * 1024,
    registrationTimeoutMs: 1_000,
    rateLimit: options.rateLimit || 100,
    logger: { log(value) { logs.push(String(value)); } }
  });
  await relay.start();
  return {
    directory,
    identity,
    logs,
    port: relay.address().port,
    relay
  };
}

async function stopFixture(fixture, sockets = []) {
  for (const socket of sockets) socket?.destroy();
  await fixture.relay.stop();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
}

test('real TLS relay pairs opposite roles and forwards coalesced opaque bytes in both directions', async () => {
  const fixture = await startFixture();
  const sockets = [];
  try {
    const desktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(desktop, mobile);
    const mobileOpaque = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x05, 0xde, 0xad, 0xbe, 0xef, 0x00]);
    const desktopRead = readBytes(desktop, mobileOpaque.length);
    desktop.write(registration('DESKTOP', TOKEN_A, nonce(1)));
    mobile.write(Buffer.concat([
      registration('MOBILE', TOKEN_A, nonce(2)),
      mobileOpaque
    ]));
    assert.deepEqual(await desktopRead, mobileOpaque);

    const desktopOpaque = Buffer.from('{"looks_like_business_json":true}\n\u0000opaque', 'utf8');
    const mobileRead = readBytes(mobile, desktopOpaque.length);
    desktop.write(desktopOpaque);
    assert.deepEqual(await mobileRead, desktopOpaque);
    assert.equal(fixture.relay.getStats().active_sessions, 1);
    assert.equal(fixture.logs.some((line) => line.includes('SESSION_PAIRED')), true);
    const serializedLogs = fixture.logs.join('\n');
    assert.equal(serializedLogs.includes(TOKEN_A), false);
    assert.equal(serializedLogs.includes(nonce(1)), false);
    assert.equal(serializedLogs.includes(nonce(2)), false);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('same-role peer is rejected while the original role can still pair with the correct peer', async () => {
  const fixture = await startFixture();
  const sockets = [];
  try {
    const firstDesktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const wrongDesktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(firstDesktop, wrongDesktop);
    firstDesktop.write(registration('DESKTOP', TOKEN_A, nonce(3)));
    await waitFor(() => fixture.relay.getStats().waiting_clients === 1);
    const rejected = waitForClose(wrongDesktop);
    wrongDesktop.write(registration('DESKTOP', TOKEN_A, nonce(4)));
    await rejected;
    assert.equal(fixture.logs.some((line) => line.includes('ROLE_CONFLICT')), true);

    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(mobile);
    const payload = Buffer.from('correct-opposite-role', 'utf8');
    const received = readBytes(firstDesktop, payload.length);
    mobile.write(Buffer.concat([registration('MOBILE', TOKEN_A, nonce(5)), payload]));
    assert.deepEqual(await received, payload);
    assert.equal(fixture.relay.getStats().active_sessions, 1);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('nonce replay is rejected across new TLS connections', async () => {
  const fixture = await startFixture();
  const sockets = [];
  try {
    const first = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(first);
    const replayedFrame = registration('DESKTOP', TOKEN_A, nonce(6));
    first.write(replayedFrame);
    await waitFor(() => fixture.relay.getStats().waiting_clients === 1);
    first.destroy();
    await waitFor(() => fixture.relay.getStats().waiting_clients === 0);

    const replay = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(replay);
    const rejected = waitForClose(replay);
    replay.write(replayedFrame);
    await rejected;
    assert.equal(fixture.logs.some((line) => line.includes('NONCE_REPLAY')), true);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('an active rendezvous cannot be hijacked and can reconnect after both peers close', async () => {
  const fixture = await startFixture();
  const sockets = [];
  try {
    const desktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(desktop, mobile);
    desktop.write(registration('DESKTOP', TOKEN_A, nonce(9)));
    mobile.write(registration('MOBILE', TOKEN_A, nonce(10)));
    await waitFor(() => fixture.relay.getStats().active_sessions === 1);

    const reuse = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(reuse);
    const rejected = waitForClose(reuse);
    reuse.write(registration('DESKTOP', TOKEN_A, nonce(11)));
    await rejected;
    assert.equal(fixture.logs.some((line) => line.includes('RENDEZVOUS_CONSUMED')), true);
    assert.equal(fixture.relay.getStats().active_sessions, 1);

    desktop.destroy();
    mobile.destroy();
    await waitFor(() => fixture.relay.getStats().active_sessions === 0);
    const reconnectedDesktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const reconnectedMobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(reconnectedDesktop, reconnectedMobile);
    reconnectedDesktop.write(registration('DESKTOP', TOKEN_A, nonce(12)));
    reconnectedMobile.write(registration('MOBILE', TOKEN_A, nonce(13)));
    await waitFor(() => fixture.relay.getStats().active_sessions === 1);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('different rendezvous tokens never cross-connect and expire under the bounded wait TTL', async () => {
  const fixture = await startFixture({ waitTtlMs: 120 });
  const sockets = [];
  try {
    const desktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(desktop, mobile);
    const desktopClosed = waitForClose(desktop);
    const mobileClosed = waitForClose(mobile);
    desktop.write(registration('DESKTOP', TOKEN_A, nonce(7)));
    mobile.write(registration('MOBILE', TOKEN_B, nonce(8)));
    await Promise.all([desktopClosed, mobileClosed]);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
    assert.equal(fixture.relay.getStats().waiting_clients, 0);
    assert.equal(fixture.logs.filter((line) => line.includes('WAIT_TIMEOUT')).length, 2);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('session lifetime is bounded and closes both opaque pipe endpoints', async () => {
  const fixture = await startFixture({ sessionTimeoutMs: 120 });
  const sockets = [];
  try {
    const desktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(desktop, mobile);
    desktop.write(registration('DESKTOP', TOKEN_A, nonce(12)));
    mobile.write(registration('MOBILE', TOKEN_A, nonce(13)));
    await waitFor(() => fixture.relay.getStats().active_sessions === 1);
    await Promise.all([waitForClose(desktop), waitForClose(mobile)]);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
    assert.equal(fixture.logs.some((line) => line.includes('SESSION_TIMEOUT')), true);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('session byte budget is enforced before an oversized opaque stream can remain active', async () => {
  const fixture = await startFixture({ sessionByteLimit: 8 });
  const sockets = [];
  try {
    const desktop = await connectTls(fixture.port, fixture.identity.certificatePem);
    const mobile = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(desktop, mobile);
    desktop.write(registration('DESKTOP', TOKEN_A, nonce(21)));
    mobile.write(registration('MOBILE', TOKEN_A, nonce(22)));
    await waitFor(() => fixture.relay.getStats().active_sessions === 1);
    const desktopClosed = waitForClose(desktop);
    const mobileClosed = waitForClose(mobile);
    mobile.write(Buffer.alloc(9, 0x41));
    await Promise.all([desktopClosed, mobileClosed]);
    assert.equal(fixture.logs.some((line) => line.includes('SESSION_BYTE_LIMIT')), true);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('per-address registration rate limit rejects excess TLS clients', async () => {
  const fixture = await startFixture({ rateLimit: 1 });
  const sockets = [];
  try {
    const first = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(first);
    first.write(registration('DESKTOP', TOKEN_A, nonce(14)));
    await waitFor(() => fixture.relay.getStats().waiting_clients === 1);

    let excess = null;
    try {
      excess = await connectTls(fixture.port, fixture.identity.certificatePem);
      sockets.push(excess);
      await waitForClose(excess);
    } catch (_) {
      // A rate-limited connection may close immediately before secureConnect reaches the client.
    }
    assert.equal(fixture.logs.some((line) => line.includes('RATE_LIMITED')), true);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
  } finally {
    await stopFixture(fixture, sockets);
  }
});

test('oversized registration frame is rejected on a real TLS socket', async () => {
  const fixture = await startFixture();
  const sockets = [];
  try {
    const socket = await connectTls(fixture.port, fixture.identity.certificatePem);
    sockets.push(socket);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(MAX_RELAY_REGISTRATION_BYTES + 1, 0);
    const rejected = waitForClose(socket);
    socket.write(prefix);
    await rejected;
    assert.equal(fixture.logs.some((line) => line.includes('REGISTRATION_TOO_LARGE')), true);
    assert.equal(fixture.relay.getStats().active_sessions, 0);
  } finally {
    await stopFixture(fixture, sockets);
  }
});
