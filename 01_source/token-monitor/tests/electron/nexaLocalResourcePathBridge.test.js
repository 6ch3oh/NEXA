'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1,
  NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR,
  createNexaLocalResourcePathController,
  createNexaLocalResourcePathIpcHandlers
} = require('../../src/electron/nexaLocalResourcePathBridge');

function handlers(options = {}) {
  return createNexaLocalResourcePathIpcHandlers({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    lstat: (absolutePath) => fs.promises.lstat(absolutePath),
    ...options
  });
}

test('publishes one generic frozen PATH_ONLY V0.1 contract', () => {
  assert.equal(Object.isFrozen(NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1), true);
  assert.deepEqual(NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1, {
    name: 'NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1',
    version: '0.1',
    mode: 'PATH_ONLY',
    authority: 'USER_INTENT_ONLY',
    resourceKinds: ['file', 'directory'],
    requestKinds: ['file', 'files', 'directory', 'relocate_file', 'relocate_directory', 'explorer_drop']
  });
  assert.deepEqual(NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR.invokeChannels, [
    'nexa:local-resource-path:select',
    'nexa:local-resource-path:resolve-drop'
  ]);
  assert.doesNotMatch(JSON.stringify(NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1), /creator|content|asset|ai/i);
});

test('selects one or multiple files and returns only absolute path projections', async () => {
  const selected = [path.resolve('fixture-a.jpg'), path.resolve('fixture-b.mp4')];
  const calls = [];
  const bridge = handlers({
    showOpenDialog: async (_event, options) => {
      calls.push(options);
      return { canceled: false, filePaths: calls.length === 1 ? [selected[0]] : selected };
    }
  });

  assert.deepEqual(await bridge['nexa:local-resource-path:select']({}, { request_kind: 'file' }), {
    contract_version: '0.1', status: 'selected', request_kind: 'file',
    resources: [{ kind: 'file', absolute_path: selected[0] }]
  });
  assert.deepEqual(await bridge['nexa:local-resource-path:select']({}, { request_kind: 'files' }), {
    contract_version: '0.1', status: 'selected', request_kind: 'files',
    resources: selected.map((absolute_path) => ({ kind: 'file', absolute_path }))
  });
  assert.deepEqual(calls, [
    { properties: ['openFile'] },
    { properties: ['openFile', 'multiSelections'] }
  ]);
});

test('selects directories and supports file/directory relocate semantics without copying', async () => {
  const selected = path.resolve('fixture-directory');
  const bridge = handlers({ showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) });
  for (const request_kind of ['directory', 'relocate_file', 'relocate_directory']) {
    const result = await bridge['nexa:local-resource-path:select']({}, { request_kind });
    assert.equal(result.status, 'selected');
    assert.equal(result.request_kind, request_kind);
    assert.equal(result.resources[0].kind, request_kind === 'relocate_file' ? 'file' : 'directory');
    assert.equal(result.resources[0].absolute_path, selected);
  }
});

test('returns explicit cancel and fails closed on malformed native dialog responses', async () => {
  const cancel = handlers();
  assert.deepEqual(await cancel['nexa:local-resource-path:select']({}, { request_kind: 'directory' }), {
    contract_version: '0.1', status: 'cancelled', request_kind: 'directory', resources: []
  });

  for (const result of [null, {}, { canceled: false, filePaths: [] },
    { canceled: false, filePaths: ['relative.txt'] },
    { canceled: false, filePaths: [path.resolve('a'), path.resolve('b')] }]) {
    const invalid = handlers({ showOpenDialog: async () => result });
    const response = await invalid['nexa:local-resource-path:select']({}, { request_kind: 'file' });
    assert.equal(response.status, 'error');
    assert.equal(response.error.code, 'INVALID_DIALOG_RESPONSE');
    assert.deepEqual(response.resources, []);
  }
});

test('classifies exact disk-backed drop paths as file/directory and supports multiple resources', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-path-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'fixture.txt');
  const directory = path.join(root, 'fixture-directory');
  fs.writeFileSync(file, 'fixture');
  fs.mkdirSync(directory);

  const result = await handlers()['nexa:local-resource-path:resolve-drop']({}, [file, directory]);
  assert.deepEqual(result, {
    contract_version: '0.1', status: 'selected', request_kind: 'explorer_drop',
    resources: [
      { kind: 'file', absolute_path: file },
      { kind: 'directory', absolute_path: directory }
    ]
  });
});

test('rejects unsupported or invalid drop objects without exposing a general filesystem command', async () => {
  const bridge = handlers();
  for (const input of [null, [], ['relative.txt'], [''], new Array(129).fill(path.resolve('x'))]) {
    const result = await bridge['nexa:local-resource-path:resolve-drop']({}, input);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.resources, []);
  }
  const controller = createNexaLocalResourcePathController();
  assert.deepEqual(Object.keys(controller), ['start', 'stop', 'getSnapshot', 'execute']);
  await assert.rejects(controller.execute({ type: 'read-file' }), { code: 'UNSUPPORTED_COMMAND' });
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'nexaLocalResourcePathBridge.js'), 'utf8');
  assert.doesNotMatch(source, /readFile|readdir|writeFile|rmSync|rename|child_process|exec\s*\(/);
});
