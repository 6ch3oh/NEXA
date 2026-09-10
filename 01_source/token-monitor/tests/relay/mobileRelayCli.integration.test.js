'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const test = require('node:test');

const {
  RELAY_CONTRACT_VERSION,
  encodeRelayRegistration
} = require('../../src/shared/mobileRelayProtocol');
const { loadMobileTlsIdentity } = require('../../src/shared/mobileTlsIdentity');
const { parseArguments } = require('../../tools/run-mobile-relay');

const RENDEZVOUS_ID = 'e'.repeat(64);

function waitForListening(child, output, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Relay CLI did not report its listening address'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    }
    function onData(chunk) {
      output.push(chunk.toString('utf8'));
      const match = output.join('').match(/LISTENING host=\S+ port=(\d+)/);
      if (!match) return;
      cleanup();
      resolve(Number(match[1]));
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`Relay CLI exited before listening (code ${code})`));
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
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

function registration(role, nonceByte) {
  return encodeRelayRegistration({
    contract_version: RELAY_CONTRACT_VERSION,
    role,
    rendezvous_id: RENDEZVOUS_ID,
    issued_at_epoch_ms: Date.now(),
    nonce: Buffer.alloc(24, nonceByte).toString('base64url')
  });
}

function readBytes(socket, length, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Relay CLI byte bridge timed out'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('close', onClose);
    }
    function onData(chunk) {
      chunks.push(chunk);
      received += chunk.length;
      if (received < length) return;
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    function onClose() {
      cleanup();
      reject(new Error('Relay CLI socket closed early'));
    }
    socket.on('data', onData);
    socket.once('close', onClose);
  });
}

function waitForExit(child, timeoutMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Relay CLI process did not stop'));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      child.off('exit', onExit);
    }
    function onExit() { cleanup(); resolve(); }
    child.once('exit', onExit);
  });
}

test('Relay CLI parser requires explicit bounded host, port, key and certificate options', () => {
  assert.deepEqual(parseArguments([
    '--host', '127.0.0.1',
    '--port', '17443',
    '--key', 'relay-key.pem',
    '--cert', 'relay-cert.pem'
  ]), {
    host: '127.0.0.1',
    port: 17443,
    keyPath: 'relay-key.pem',
    certPath: 'relay-cert.pem'
  });
  assert.throws(() => parseArguments(['--host', '127.0.0.1']), /Missing required Relay option/);
  assert.throws(() => parseArguments([
    '--host', '127.0.0.1', '--port', '1', '--key', 'key', '--cert', 'cert', '--token', 'secret'
  ]), /Invalid Relay argument/);
});

test('standalone Relay process accepts real outer TLS peers and remains an opaque byte pipe', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-mobile-relay-cli-'));
  const identity = loadMobileTlsIdentity(path.join(directory, 'tls'));
  const keyPath = path.join(directory, 'relay-key.pem');
  const certPath = path.join(directory, 'relay-cert.pem');
  fs.writeFileSync(keyPath, identity.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(certPath, identity.certificatePem, { mode: 0o600 });
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, [
    path.resolve(__dirname, '../../tools/run-mobile-relay.js'),
    '--host', '127.0.0.1',
    '--port', '0',
    '--key', keyPath,
    '--cert', certPath
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
  let desktop;
  let mobile;
  try {
    const port = await waitForListening(child, stdout);
    child.stdout.on('data', (chunk) => stdout.push(chunk.toString('utf8')));
    desktop = await connectTls(port, identity.certificatePem);
    mobile = await connectTls(port, identity.certificatePem);
    const payload = Buffer.from([0x16, 0x03, 0x03, 0xde, 0xad, 0xbe, 0xef]);
    const received = readBytes(desktop, payload.length);
    desktop.write(registration('DESKTOP', 0x51));
    mobile.write(Buffer.concat([registration('MOBILE', 0x52), payload]));
    assert.deepEqual(await received, payload);
    const output = `${stdout.join('')}\n${stderr.join('')}`;
    assert.equal(output.includes(RENDEZVOUS_ID), false);
    assert.equal(output.includes(Buffer.alloc(24, 0x51).toString('base64url')), false);
    assert.equal(output.includes(keyPath), false);
  } finally {
    desktop?.destroy();
    mobile?.destroy();
    child.kill('SIGTERM');
    try {
      await waitForExit(child);
    } catch (_) {
      child.kill('SIGKILL');
      await waitForExit(child);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
