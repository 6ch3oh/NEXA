import { normalizeLegacyFailure } from './legacy-capability-contract.mjs';

export const LEGACY_NOTION_TODO_IPC = Object.freeze({
  get: 'notionTodo:get',
  refresh: 'notionTodo:refresh',
  test: 'notionTodo:test',
  open: 'notionTodo:open',
  push: 'notionTodo:push',
});

function assertBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') {
    throw new TypeError('Legacy Notion Todo bridge is required');
  }
  for (const method of ['get', 'refresh', 'test', 'open']) {
    if (typeof bridge[method] !== 'function') {
      throw new TypeError(`Legacy Notion Todo bridge.${method} must be a function`);
    }
  }
}

function wrappedFailure(error) {
  const input = error && typeof error === 'object'
    ? { code: typeof error.code === 'string' ? error.code : null }
    : null;
  return Object.freeze({ ok: false, value: null, failure: normalizeLegacyFailure(input) });
}

async function invoke(operation) {
  try {
    const value = await operation();
    if (value?.ok === false) {
      return Object.freeze({
        ok: false,
        value,
        failure: normalizeLegacyFailure(value, {
          hasCachedItems: Array.isArray(value.items) && value.items.length > 0,
        }),
      });
    }
    return Object.freeze({ ok: true, value, failure: null });
  } catch (error) {
    return wrappedFailure(error);
  }
}

export class LegacyNotionTodoPort {
  constructor(bridge) {
    assertBridge(bridge);
    this.bridge = bridge;
  }

  getSnapshot() {
    return invoke(() => this.bridge.get());
  }

  refresh() {
    return invoke(() => this.bridge.refresh());
  }

  testConnection() {
    return invoke(() => this.bridge.test());
  }

  openExternal(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new TypeError('openExternal url must be a non-empty string');
    }
    return invoke(() => this.bridge.open(url));
  }

  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('subscribe callback must be a function');
    if (typeof this.bridge.onPush !== 'function') return () => {};
    const unsubscribe = this.bridge.onPush(callback);
    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  }
}

export function createLegacyNotionTodoPort(bridge) {
  return new LegacyNotionTodoPort(bridge);
}
