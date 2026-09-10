'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  MARKET_PROCESS_ARGS,
  MARKET_TRANSPORT_PROTOCOL,
  NexaMarketStdioClient
} = require('../../src/electron/nexaMarketStdioClient');

function fakeProcess(options = {}) {
  const child = new EventEmitter();
  child.pid = options.pid || 42001;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.writes = [];
  child.stdin = {
    write(line, _encoding, callback) {
      child.writes.push(line);
      callback?.();
      options.onWrite?.(JSON.parse(line), child);
      return true;
    }
  };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    if (options.closeOnKill !== false) queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  return child;
}

function success(id, result) {
  return JSON.stringify({
    protocol_version: MARKET_TRANSPORT_PROTOCOL,
    id,
    ok: true,
    result
  });
}

function clientWith(child, overrides = {}) {
  const spawnCalls = [];
  const client = new NexaMarketStdioClient({
    pythonExecutable: 'C:/Python/python.exe',
    moduleRoot: 'E:/market',
    spawnProcess(command, args, options) {
      spawnCalls.push({ command, args, options });
      return child;
    },
    requestTimeoutMs: 100,
    shutdownTimeoutMs: 20,
    killTimeoutMs: 20,
    ...overrides
  });
  return { client, spawnCalls };
}

test('spawns the frozen Python module entry with explicit cwd and UTF-8 stdio', () => {
  const child = fakeProcess();
  const { client, spawnCalls } = clientWith(child);
  const result = client.spawn();
  assert.deepEqual(spawnCalls[0].args, [...MARKET_PROCESS_ARGS]);
  assert.equal(spawnCalls[0].command, 'C:/Python/python.exe');
  assert.equal(spawnCalls[0].options.cwd, 'E:\\market');
  assert.deepEqual(spawnCalls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(spawnCalls[0].options.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.equal(spawnCalls[0].options.env.PYTHONUTF8, '1');
  assert.equal(spawnCalls[0].options.env.PYTHONIOENCODING, 'utf-8');
  assert.equal(result.pid, child.pid);
});

test('writes NDJSON ids and buffers fragmented UTF-8 stdout', async () => {
  const child = fakeProcess({
    onWrite(request, current) {
      const line = `${success(request.id, { value: '市场' })}\n`;
      current.stdout.write(line.slice(0, 17));
      current.stdout.write(line.slice(17));
    }
  });
  const { client } = clientWith(child);
  client.spawn();
  const value = await client.request('get_market_home', {});
  const sent = JSON.parse(child.writes[0]);
  assert.equal(sent.protocol_version, MARKET_TRANSPORT_PROTOCOL);
  assert.equal(sent.id, 'core-market-1');
  assert.equal(child.writes[0].endsWith('\n'), true);
  assert.deepEqual(value, { value: '市场' });
});

test('keeps one request in flight and accepts multiple framed response lines', async () => {
  const child = fakeProcess();
  const { client } = clientWith(child);
  client.spawn();
  const first = client.request('get_module_status', {});
  const second = client.request('get_desktop_snapshot', {});
  assert.equal(child.writes.length, 1);
  child.stdout.write(`${success('core-market-1', { order: 1 })}\n${success('core-market-2', { order: 2 })}\n`);
  assert.deepEqual(await first, { order: 1 });
  assert.deepEqual(await second, { order: 2 });
  assert.equal(child.writes.length, 2);
});

test('rejects malformed, protocol-mismatched, and unmatched responses as stable fatal errors', async (t) => {
  for (const [name, response, code] of [
    ['malformed', '{bad}\n', 'MARKET_MALFORMED_RESPONSE'],
    ['protocol', `${JSON.stringify({ protocol_version: 'wrong', id: 'core-market-1', ok: true, result: {} })}\n`, 'MARKET_PROTOCOL_MISMATCH'],
    ['id', `${success('other-id', {})}\n`, 'MARKET_UNMATCHED_RESPONSE']
  ]) {
    await t.test(name, async () => {
      const child = fakeProcess();
      const { client } = clientWith(child);
      client.spawn();
      const pending = client.request('get_module_status', {});
      child.stdout.write(response);
      await assert.rejects(pending, (error) => error.code === code);
      await assert.rejects(client.request('get_module_status', {}), (error) => error.code === code);
      assert.equal(child.killed, true);
    });
  }
});

test('bounds stderr diagnostics and the pending queue', async () => {
  const child = fakeProcess();
  const { client } = clientWith(child, { maxStderrBytes: 8, maxQueue: 2 });
  client.spawn();
  child.stderr.write('0123456789');
  const first = client.request('get_module_status', {});
  const second = client.request('get_desktop_snapshot', {});
  await assert.rejects(
    client.request('get_market_home', {}),
    (error) => error.code === 'MARKET_REQUEST_QUEUE_FULL'
  );
  assert.equal(client.getDiagnostics().stderr, '23456789');
  child.stdout.write(`${success('core-market-1', {})}\n${success('core-market-2', {})}\n`);
  await Promise.all([first, second]);
});

test('timeout enters a stable failed state and terminates the process', async () => {
  const child = fakeProcess();
  const { client } = clientWith(child, { requestTimeoutMs: 10 });
  client.spawn();
  await assert.rejects(client.request('get_module_status', {}), (error) => error.code === 'MARKET_REQUEST_TIMEOUT');
  await assert.rejects(client.request('get_module_status', {}), (error) => error.code === 'MARKET_REQUEST_TIMEOUT');
  assert.equal(child.killed, true);
});

test('child exit rejects the active and queued requests', async () => {
  const child = fakeProcess();
  const { client } = clientWith(child);
  client.spawn();
  const first = client.request('get_module_status', {});
  const second = client.request('get_desktop_snapshot', {});
  child.emit('close', 7, null);
  await assert.rejects(first, (error) => error.code === 'MARKET_PROCESS_EXITED');
  await assert.rejects(second, (error) => error.code === 'MARKET_PROCESS_EXITED');
});

test('unavailable Python process fails only Market with a stable transport error', async () => {
  const child = fakeProcess();
  const { client } = clientWith(child);
  client.spawn();
  const pending = client.request('get_module_status', {});
  child.emit('error', Object.assign(new Error('python not found'), { code: 'ENOENT' }));
  await assert.rejects(pending, (error) => error.code === 'MARKET_PROCESS_ERROR');
  await assert.rejects(
    client.request('get_desktop_snapshot', {}),
    (error) => error.code === 'MARKET_PROCESS_ERROR'
  );
  assert.equal(child.killed, true);
});

test('graceful shutdown waits for the flushed response and process close', async () => {
  const child = fakeProcess({
    onWrite(request, current) {
      if (request.method !== 'shutdown') return;
      current.stdout.write(`${success(request.id, {
        shutdown: true, disposed: true, bridge_version: 'nexa.market.desktop-bridge.v0.1'
      })}\n`);
      queueMicrotask(() => current.emit('close', 0, null));
    }
  });
  const { client } = clientWith(child);
  client.spawn();
  const result = await client.shutdown();
  assert.equal(result.shutdown, true);
  assert.equal(result.disposed, true);
  assert.equal(result.killFallbackUsed, false);
  assert.equal(client.getDiagnostics().pid, null);
});

test('shutdown uses a kill fallback when a successful transport does not exit', async () => {
  const child = fakeProcess({
    onWrite(request, current) {
      if (request.method === 'shutdown') current.stdout.write(`${success(request.id, {
        shutdown: true, disposed: true
      })}\n`);
    }
  });
  const { client } = clientWith(child);
  client.spawn();
  const result = await client.shutdown();
  assert.equal(result.killFallbackUsed, true);
  assert.equal(child.killed, true);
  assert.equal(client.getDiagnostics().pid, null);
});
