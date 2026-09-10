'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNexaCommandAuditLog, normalizeRecord } = require('../../src/electron/nexaCommandAuditLog');

test('command audit keeps contracted fields and recursively removes secrets', async () => {
  const writes = [];
  const audit = createNexaCommandAuditLog({
    filePath: 'C:\\safe\\command-audit.jsonl',
    fsImpl: { mkdir: async () => {}, appendFile: async (_path, data) => { writes.push(data); } },
    clock: () => '2026-09-06T19:00:00+08:00',
  });
  await audit.record({
    command_id: 'command-1', origin_device: 'mobile', text: 'authorization: private', domain: 'device',
    plan: { steps: [{ capability: 'device.summary', arguments: { password: 'private', query: '状态' } }] },
    result: { access_token: 'private', status: 'ok' }, status: 'completed', ignored: 'not persisted',
  });
  const persisted = writes.join('');
  assert.doesNotMatch(persisted, /private|password|access_token|ignored/u);
  assert.match(persisted, /\[REDACTED\]/u);
  assert.equal(audit.list()[0].origin_device, 'mobile');
});

test('normalizeRecord supplies bounded local audit identities', () => {
  const value = normalizeRecord({ command_id: 'x', text: 'hello', status: 'completed' }, () => 'now');
  assert.equal(value.origin_device, 'desktop');
  assert.equal(value.timestamp, 'now');
});

test('diagnostic audit applies separate retention, strips legacy prompts, and stays inside its byte cap', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexa-command-audit-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'command-audit.jsonl');
  const now = Date.parse('2026-09-07T10:00:00+08:00');
  const day = 24 * 60 * 60 * 1000;
  const legacy = [
    { command_id: 'expired-success', text: 'private prompt', status: 'completed', timestamp: new Date(now - 2 * day).toISOString() },
    { command_id: 'retained-error', text: 'authorization: private', status: 'failed', timestamp: new Date(now - 6 * day).toISOString() },
    { command_id: 'expired-error', text: 'old prompt', status: 'failed', timestamp: new Date(now - 8 * day).toISOString() },
  ];
  await fs.promises.writeFile(filePath, `${legacy.map(JSON.stringify).join('\n')}\n`);
  const audit = createNexaCommandAuditLog({
    filePath, now: () => now, clock: () => new Date(now).toISOString(),
    maxBytes: 1024, maintenanceIntervalMs: 1,
  });
  await audit.record({ command_id: 'current-success', text: 'normal prompt body', status: 'completed' });
  const persisted = await fs.promises.readFile(filePath, 'utf8');
  assert.doesNotMatch(persisted, /expired-success|expired-error|private prompt|normal prompt body/u);
  assert.match(persisted, /retained-error|current-success|\[REDACTED\]/u);
  assert.ok((await fs.promises.stat(filePath)).size <= 1024);
  assert.equal(audit.getState().prompt_text_persisted, false);
  assert.equal(audit.getState().max_bytes, 1024);
});
