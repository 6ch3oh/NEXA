'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRenderer, formatAttemptTime, safeFailureCode, validatedEndpoint
} = require('../../src/electron/renderer/nexaStudyCenterRenderer');

function element(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, className: '', textContent: '',
    contentWindow: tag.toLowerCase() === 'iframe' ? {} : undefined,
    listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    removeEventListener(name, listener) { if (this.listeners[name] === listener) delete this.listeners[name]; }
  };
}

function messageTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    dispatch(event) { listeners.get('message')?.(event); },
    hasMessageListener() { return listeners.has('message'); }
  };
}

test('Study Center renderer accepts only the owned loopback endpoint set', () => {
  assert.equal(validatedEndpoint({ host: '127.0.0.1', port: 4316, url: 'http://127.0.0.1:4316/' }), 'http://127.0.0.1:4316/');
  assert.equal(validatedEndpoint({ host: '127.0.0.1', port: 4416, url: 'http://127.0.0.1:4416/' }), 'http://127.0.0.1:4416/');
  assert.equal(validatedEndpoint({ host: 'localhost', port: 4316, url: 'http://localhost:4316/' }), null);
  assert.equal(validatedEndpoint({ host: '127.0.0.1', port: 4317, url: 'http://127.0.0.1:4317/' }), null);
  assert.equal(validatedEndpoint({ host: '127.0.0.1', port: 4416, url: 'http://127.0.0.1:4316/' }), null);
  assert.equal(validatedEndpoint({ host: '127.0.0.1', port: 4416, url: 'http://127.0.0.1:4416/admin' }), null);
});

test('Study Center failure presentation keeps codes bounded and dates truthful', () => {
  assert.equal(safeFailureCode('STUDY_CENTER_START_FAILED'), 'STUDY_CENTER_START_FAILED');
  assert.equal(safeFailureCode('private/path'), 'STUDY_CENTER_UNAVAILABLE');
  assert.equal(formatAttemptTime(null), '尚未尝试');
  assert.equal(formatAttemptTime('not-a-date'), '时间未知');
});

test('Study Center renderer mounts the module-owned UI and releases lifecycle on route exit', async () => {
  const ownerDocument = { createElement: element };
  const surface = element('section');
  surface.ownerDocument = ownerDocument;
  let starts = 0;
  let stops = 0;
  const readiness = {
    ready: true, code: 'READY', runtimeNetworkDependency: 0,
    singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
    endpoint: { host: '127.0.0.1', port: 4316, url: 'http://127.0.0.1:4316/', owned: true }
  };
  const messages = messageTarget();
  const contexts = [];
  const renderer = createRenderer({
    surface,
    messageTarget: messages,
    onContextChange: (value) => contexts.push(value),
    api: {
      async start() { starts += 1; return { ok: true, value: readiness }; },
      async getReadiness() { return { ok: true, value: readiness }; },
      async stop() { stops += 1; return { ok: true }; }
    }
  });

  assert.equal((await renderer.activate()).status, 'LIMITED');
  assert.equal(surface.children[0].dataset.studyCenterState, 'loading-frame');
  const frame = surface.children[0].children[0];
  assert.equal(frame.tagName, 'IFRAME');
  assert.equal(frame.src, 'http://127.0.0.1:4316/');
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms allow-same-origin allow-downloads');
  assert.equal(surface.children[0].children[1].children[1].textContent, '本地学习内容已启动，正在完成页面载入…');
  const load = frame.listeners.load;
  load();
  assert.equal(renderer.getState().status, 'LIMITED');
  assert.equal(surface.children[0].dataset.studyCenterState, 'awaiting-render');
  assert.equal(surface.children[0].children[1].children[1].textContent, '页面已连接，正在呈现本地学习内容…');
  messages.dispatch({ source: frame.contentWindow, origin: 'http://127.0.0.1:4416', data: { type:'NEXA_STUDY_CENTER_FRAME_STATE', version:1, state:'READY' } });
  messages.dispatch({ source: {}, origin: 'http://127.0.0.1:4316', data: { type:'NEXA_STUDY_CENTER_FRAME_STATE', version:1, state:'READY' } });
  assert.equal(renderer.getState().status, 'LIMITED');
  messages.dispatch({ source: frame.contentWindow, origin: 'http://127.0.0.1:4316', data: { type:'NEXA_STUDY_CENTER_FRAME_STATE', version:1, state:'READY' } });
  assert.equal(renderer.getState().status, 'READY');
  assert.equal(surface.children[0].dataset.studyCenterState, 'ready');
  assert.equal(surface.children[0].children.length, 1);
  assert.deepEqual(contexts.map((value) => value.status), ['LIMITED', 'READY']);
  assert.equal(messages.hasMessageListener(), false);
  assert.equal(starts, 1);
  assert.equal((await renderer.unmount()).status, 'OFFLINE');
  assert.equal(stops, 1);
  assert.deepEqual(surface.children, []);
});

test('Study Center renderer mounts an approved fallback endpoint', async () => {
  const ownerDocument = { createElement: element };
  const surface = element('section');
  surface.ownerDocument = ownerDocument;
  const readiness = {
    ready: true, code: 'READY', runtimeNetworkDependency: 0,
    singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
    endpoint: { host: '127.0.0.1', port: 4416, url: 'http://127.0.0.1:4416/', owned: true }
  };
  const renderer = createRenderer({
    surface,
    api: {
      async start() { return { ok: true, value: readiness }; },
      async getReadiness() { return { ok: true, value: readiness }; },
      async stop() { return { ok: true }; }
    }
  });

  assert.equal((await renderer.activate()).status, 'LIMITED');
  const frame = surface.children[0].children[0];
  assert.equal(frame.src, 'http://127.0.0.1:4416/');
  const load = frame.listeners.load;
  load();
  assert.equal(renderer.getState().status, 'READY');
  await renderer.unmount();
});

test('Study Center keeps a local loading surface until the iframe has painted and ignores a late load after exit', async () => {
  const ownerDocument = { createElement: element };
  const surface = element('section');
  surface.ownerDocument = ownerDocument;
  const readiness = {
    ready: true, code: 'READY', runtimeNetworkDependency: 0,
    singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
    endpoint: { host: '127.0.0.1', port: 4516, url: 'http://127.0.0.1:4516/', owned: true }
  };
  const contexts = [];
  const renderer = createRenderer({
    surface,
    onContextChange: (value) => contexts.push(value),
    api: {
      async start() { return { ok: true, value: readiness }; },
      async getReadiness() { return { ok: true, value: readiness }; },
      async stop() { return { ok: true }; }
    }
  });

  await renderer.activate();
  const page = surface.children[0];
  const frame = page.children[0];
  const lateLoad = frame.listeners.load;
  assert.equal(page.children[1].attributes.role, 'status');
  assert.equal(frame.className, 'nexa-study-center-frame is-loading');
  await renderer.unmount();
  const contextCount = contexts.length;
  assert.equal(contexts.length, contextCount);
  lateLoad();
  assert.equal(contexts.length, contextCount);
  assert.equal(renderer.getState().status, 'OFFLINE');
  assert.deepEqual(surface.children, []);
});

test('Study Center converts rejected startup/readiness promises into a visible bounded error', async () => {
  for (const failurePoint of ['start', 'readiness']) {
    const ownerDocument = { createElement: element };
    const surface = element('section');
    surface.ownerDocument = ownerDocument;
    const readiness = {
      ready: true, code: 'READY', runtimeNetworkDependency: 0,
      singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
      endpoint: { host: '127.0.0.1', port: 4616, url: 'http://127.0.0.1:4616/', owned: true }
    };
    const renderer = createRenderer({
      surface,
      api: {
        async start() {
          if (failurePoint === 'start') throw Object.assign(new Error('private'), { code: 'STUDY_START_REJECTED' });
          return { ok: true, value: readiness };
        },
        async getReadiness() {
          if (failurePoint === 'readiness') throw new Error('private');
          return { ok: true, value: readiness };
        },
        async stop() { return { ok: true }; }
      }
    });

    assert.equal((await renderer.activate()).status, 'ERROR');
    const error = surface.children[0].children[0];
    assert.equal(error.attributes.role, 'alert');
    assert.equal(error.children[0].textContent, '学习中心暂时不可用');
    const serialized = JSON.stringify(error);
    assert.match(serialized, /用途：学习中心/);
    assert.match(serialized, /原因：本地 Study Center/);
    assert.match(serialized, /最近尝试：/);
    assert.match(serialized, /下一步：重新尝试/);
    assert.match(serialized, /重新尝试/);
    assert.match(serialized, new RegExp(
      failurePoint === 'start' ? 'STUDY_START_REJECTED' : 'STUDY_CENTER_READINESS_FAILED'
    ));
    await renderer.unmount();
  }
});

test('Study Center frame error and timeout both settle once and remain recoverable', async () => {
  const ownerDocument = { createElement: element };
  const surface = element('section');
  surface.ownerDocument = ownerDocument;
  const readiness = {
    ready: true, code: 'READY', runtimeNetworkDependency: 0,
    singleWriterScope: 'PROCESS_LOCAL_SINGLE_WRITER',
    endpoint: { host: '127.0.0.1', port: 4816, url: 'http://127.0.0.1:4816/', owned: true }
  };
  const timers = new Map();
  let nextTimer = 0;
  const renderer = createRenderer({
    surface,
    frameLoadTimeoutMs: 25,
    setTimeout(callback) { nextTimer += 1; timers.set(nextTimer, callback); return nextTimer; },
    clearTimeout(timer) { timers.delete(timer); },
    api: {
      async start() { return { ok: true, value: readiness }; },
      async getReadiness() { return { ok: true, value: readiness }; },
      async stop() { return { ok: true }; }
    }
  });

  await renderer.activate();
  const firstFrame = surface.children[0].children[0];
  firstFrame.listeners.error();
  assert.equal(renderer.getState().status, 'ERROR');
  assert.match(JSON.stringify(surface), /STUDY_CENTER_FRAME_LOAD_FAILED/);

  await renderer.activate();
  assert.equal(renderer.getState().status, 'LIMITED');
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  assert.equal(renderer.getState().status, 'ERROR');
  assert.match(JSON.stringify(surface), /STUDY_CENTER_FRAME_LOAD_TIMEOUT/);

  await renderer.activate();
  const recoveredFrame = surface.children[0].children[0];
  const load = recoveredFrame.listeners.load;
  load();
  assert.equal(renderer.getState().status, 'READY');
  assert.equal(timers.size, 0);
  await renderer.unmount();
});
