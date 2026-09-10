'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createRenderer } = require('../../src/electron/renderer/nexaCreatorOpsUiIntegrationHost');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.disabled = false;
    this.attributes = {};
    this.dataset = {};
    this.classList = { toggle() {} };
    this.listeners = new Map();
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  click() { return this.listeners.get('click')?.(); }
  dispatch(type, event) { return this.listeners.get(type)?.(event); }
}

function document() {
  return {
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ textContent: text })
  };
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function findAll(root, predicate, result = []) {
  if (predicate(root)) result.push(root);
  for (const child of root.children || []) findAll(child, predicate, result);
  return result;
}

function ready() {
  return {
    contractVersion: '1.0', state: 'READY', ready: true, errorCode: null,
    message: 'ready', endpoint: { host: '127.0.0.1', port: 8765, url: 'http://127.0.0.1:8765/' },
    runtimeInstanceCount: 1, generation: 1
  };
}

test('mounts the module-owned endpoint handoff and opens only through the safe facade', async () => {
  const surface = new FakeElement('section');
  const contexts = [];
  const calls = [];
  const renderer = createRenderer({
    document: document(), surface,
    api: {
      start: async () => { calls.push('start'); return { ok: true, value: ready() }; },
      getReadiness: async () => ({ ok: true, value: ready() }),
      open: async () => { calls.push('open'); return { ok: true, value: ready() }; }
    },
    onContextChange: (value) => contexts.push(value)
  });

  await renderer.activate();
  assert.deepEqual(renderer.getState(), { status: 'ready' });
  const button = find(surface, (node) => node.tagName === 'button');
  assert.equal(button.textContent, '打开高级管理');
  await button.click();
  assert.deepEqual(calls, ['start', 'open']);
  assert.deepEqual(contexts.at(-1), { title: '自媒体运营', status: 'READY' });
  assert.ok(find(surface, (node) => node.textContent.includes('本地服务可用')));
});

test('isolates backend offline and mount errors into stable renderer states', async () => {
  const offlineSurface = new FakeElement('section');
  const offline = createRenderer({
    document: document(), surface: offlineSurface,
    api: {
      start: async () => ({ ok: false, error: { code: 'HOST_START_TIMEOUT', stack: 'private' } }),
      getReadiness: async () => ({ ok: true, value: {
        ...ready(), state: 'ERROR', ready: false, endpoint: null,
        runtimeInstanceCount: 0, errorCode: 'HOST_PROCESS_EXITED'
      } }),
      open: async () => ({ ok: false, error: { code: 'OPEN_FAILED' } })
    }
  });

  await offline.activate();
  assert.deepEqual(offline.getState(), { status: 'error', code: 'HOST_START_TIMEOUT' });
  assert.equal(JSON.stringify(offlineSurface).includes('private'), false);
  assert.throws(() => createRenderer({ api: {}, surface: offlineSurface, document: document() }), TypeError);
  assert.equal(offline.unmount(), true);
  assert.deepEqual(offlineSurface.children, []);
});

test('fails closed when a ready host omits its authoritative endpoint', async () => {
  const surface = new FakeElement('section');
  const renderer = createRenderer({
    document: document(), surface,
    api: {
      start: async () => ({ ok: true, value: { ...ready(), endpoint: null } }),
      getReadiness: async () => ({ ok: true, value: { ...ready(), endpoint: null } }),
      open: async () => ({ ok: true, value: ready() })
    }
  });

  await renderer.activate();
  assert.deepEqual(renderer.getState(), { status: 'error', code: 'INVALID_CREATOR_OPS_READINESS' });
});

test('mounts one Desktop-owned generic path handoff and forwards only selected envelopes', async () => {
  const surface = new FakeElement('section');
  const handoffs = [];
  const calls = [];
  let queries = 0;
  const file = path.resolve('desktop-drop-fixture.jpg');
  const renderer = createRenderer({
    document: document(), surface,
    api: {
      start: async () => ({ ok: true, value: ready() }),
      getReadiness: async () => ({ ok: true, value: ready() }),
      open: async () => ({ ok: true, value: ready() }),
      queryWorks: async () => { queries += 1; return { ok: true, value: { items: [], view: 'recent' } }; },
      executeWorksCommand: async (command) => {
        calls.push(['works-command', command]);
        return { ok: true, value: { items: [] } };
      }
    },
    pathBridge: {
      selectFiles: async (options) => {
        calls.push(['files', options]);
        return { status: 'selected', request_kind: options?.multiple ? 'files' : 'file',
          resources: [{ kind: 'file', absolute_path: file }] };
      },
      selectDirectory: async () => ({ status: 'cancelled', request_kind: 'directory', resources: [] }),
      relocateFile: async () => ({ status: 'cancelled', request_kind: 'relocate_file', resources: [] }),
      relocateDirectory: async () => ({ status: 'cancelled', request_kind: 'relocate_directory', resources: [] }),
      resolveDroppedResources: async (files) => {
        calls.push(['drop', files]);
        return { status: 'selected', request_kind: 'explorer_drop',
          resources: [{ kind: 'file', absolute_path: file }] };
      }
    },
    onPathHandoff: (value) => handoffs.push(value)
  });

  await renderer.activate();
  const buttons = findAll(surface, (node) => node.tagName === 'button');
  assert.deepEqual(buttons.filter((node) => ['全部', '最近', '作品集'].includes(node.textContent))
    .map((node) => node.textContent), ['全部', '最近', '作品集']);
  const beforeGrid = queries;
  await buttons.find((node) => node.textContent === '4宫格').click();
  assert.equal(queries, beforeGrid, 'grid density must not reload the Works query');
  assert.match(find(surface, (node) => String(node.className).includes('nexa-creator-works-grid-4')).className,
    /nexa-creator-works-grid-4/);
  const multiple = buttons.find((node) => node.textContent === '选择多个文件');
  await multiple.click();
  const dropZone = find(surface, (node) => node.className === 'nexa-local-resource-drop-zone');
  let prevented = false;
  dropZone.dispatch('drop', {
    preventDefault() { prevented = true; },
    dataTransfer: { files: [{ name: 'desktop-drop-fixture.jpg' }] }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(prevented, true);
  assert.equal(handoffs.length, 2);
  assert.equal(handoffs[0].resources[0].absolute_path, file);
  assert.deepEqual(renderer.getPathHandoffState(), {
    status: 'selected', request_kind: 'explorer_drop', resource_count: 1
  });
  assert.equal(JSON.stringify(surface).includes(file), false, 'Desktop UI leaked the selected absolute path');
  assert.equal(calls[0][0], 'files');
  assert.equal(calls[0][1].multiple, true);
  assert.equal(calls[1][0], 'works-command');
  assert.equal(calls[1][1].operation, 'intake');
  assert.equal(calls[2][0], 'drop');
});

test('Creator Ops owns one first-level route while Core mounts only its safe endpoint handoff', () => {
  const rendererRoot = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
  const html = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');
  const integration = fs.readFileSync(path.join(rendererRoot, 'nexaRendererIntegration.js'), 'utf8');
  const styles = fs.readFileSync(path.join(rendererRoot, 'styles.css'), 'utf8');
  assert.equal((html.match(/id="nexaCreatorOpsSurface"/g) || []).length, 1);
  assert.match(html, /nexaCreatorOpsUiIntegrationHost\.js/);
  assert.match(integration, /activeRoute === 'creator-ops'/);
  assert.match(integration, /api\['creator-ops'\]/);
  assert.doesNotMatch(integration, /127\.0\.0\.1|8765|creator_ops|sqlite|source_import/i);
  assert.match(styles, /\.nexa-creator-works-tabs \.nexa-creator-ops-action\[aria-pressed="true"\]/);
});

test('Works query failure replaces loading with one retryable error state and stable diagnostics', async () => {
  const surface = new FakeElement('section');
  const renderer = createRenderer({
    document: document(), surface,
    api: {
      start: async () => ({ ok: true, value: ready() }),
      getReadiness: async () => ({ ok: true, value: ready() }),
      open: async () => ({ ok: true, value: ready() }),
      queryWorks: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'private detail' } }),
      executeWorksCommand: async () => ({ ok: true, value: {} })
    },
    pathBridge: {
      selectFiles: async () => ({ status: 'cancelled', resources: [] }),
      selectDirectory: async () => ({ status: 'cancelled', resources: [] }),
      relocateFile: async () => ({ status: 'cancelled', resources: [] }),
      relocateDirectory: async () => ({ status: 'cancelled', resources: [] }),
      resolveDroppedResources: async () => ({ status: 'cancelled', resources: [] })
    }
  });

  await renderer.activate();
  await new Promise((resolve) => setImmediate(resolve));
  const text = JSON.stringify(surface);
  assert.match(text, /作品读取失败，请重试/);
  assert.match(text, /INTERNAL_ERROR/);
  assert.doesNotMatch(text, /正在读取作品/);
  assert.doesNotMatch(text, /private detail/);
  assert.ok(find(surface, (node) => node.tagName === 'button' && node.textContent === '重试读取'));
});

test('works and portfolio stay available when the optional path picker is unavailable', async () => {
  const surface = new FakeElement('section');
  const views = [];
  const renderer = createRenderer({
    document: document(), surface,
    api: {
      start: async () => ({ ok: true, value: ready() }),
      getReadiness: async () => ({ ok: true, value: ready() }),
      open: async () => ({ ok: true, value: ready() }),
      queryWorks: async (query) => { views.push(query.view); return { ok: true, value: { items: [], view: query.view } }; },
      executeWorksCommand: async () => ({ ok: true, value: {} })
    }
  });

  await renderer.activate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(JSON.stringify(surface), /本地文件选择当前不可用；作品查看与作品集仍可使用/);
  const portfolio = find(surface, (node) => node.tagName === 'button' && node.textContent === '作品集');
  assert.ok(portfolio);
  await portfolio.click();
  assert.deepEqual(views, ['recent', 'portfolio']);
  assert.equal(portfolio.attributes['aria-pressed'], 'true');
  assert.ok(find(surface, (node) => node.tagName === 'h2' && node.textContent === '我的作品集'));
  assert.ok(find(surface, (node) => node.textContent === '作品集中尚无作品。'));
  assert.equal(find(surface, (node) => node.textContent === '选择多个文件'), null);
});
