'use strict';

const { writePrivateJsonAtomic } = require('./credentialStore');

const DEFAULT_NOTION_TODO_DATA_SOURCE_ID = '6c2b41b5-a595-4b61-817f-a9019550392b';
const DEFAULT_NOTION_TODO_REFRESH_MS = 5 * 60 * 1000;
const NOTION_VERSION = '2026-03-11';
const NOTION_API_ORIGIN = 'https://api.notion.com';
const NOTION_TODO_STATUS_TEXT = Object.freeze({
  loading: '正在读取待办',
  empty: '暂无待办',
  notConfigured: '尚未配置 Notion',
  invalidToken: 'Token 无效',
  unauthorized: '数据库未授权',
  notFound: '数据源不存在',
  rateLimited: '请求过于频繁，请稍后重试',
  network: '网络连接失败',
  stale: '已显示上次成功数据',
  error: '网络连接失败'
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNotionToken(value) {
  return String(value || '').trim();
}

function normalizeNotionDataSourceId(value) {
  const raw = String(value || '').trim();
  return raw || DEFAULT_NOTION_TODO_DATA_SOURCE_ID;
}

function normalizeNotionTodoRefreshMs(value) {
  const ms = Math.trunc(Number(value));
  if (!Number.isFinite(ms)) return DEFAULT_NOTION_TODO_REFRESH_MS;
  return Math.max(60_000, Math.min(60 * 60 * 1000, ms));
}

function notionTodoConfigured(settings) {
  return Boolean(settings?.notionTodoEnabled && normalizeNotionToken(settings?.notionToken) && normalizeNotionDataSourceId(settings?.notionDataSourceId));
}

function notionTodoSettingsForRenderer(settings) {
  return {
    notionTodoEnabled: Boolean(settings?.notionTodoEnabled),
    notionToken: '',
    notionTokenConfigured: Boolean(normalizeNotionToken(settings?.notionToken)),
    notionDataSourceId: normalizeNotionDataSourceId(settings?.notionDataSourceId),
    notionTodoRefreshMs: normalizeNotionTodoRefreshMs(settings?.notionTodoRefreshMs)
  };
}

function normalizeVisibleTitle(value) {
  return String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
}

function textFromRichText(items) {
  return Array.isArray(items)
    ? normalizeVisibleTitle(items.map((item) => String(item?.plain_text || item?.text?.content || '')).join(''))
    : '';
}

function parseTitle(properties) {
  return textFromRichText(properties?.['\u4efb\u52a1\u540d\u79f0']?.title);
}

function parsePriority(properties) {
  const name = properties?.['优先级']?.select?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : '';
}

function parseStatus(properties) {
  const name = properties?.['状态']?.status?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : '';
}

function parseDue(properties) {
  const date = properties?.['截止日期']?.date;
  const start = typeof date?.start === 'string' ? date.start.trim() : '';
  if (!start) return null;
  return {
    start,
    end: typeof date?.end === 'string' ? date.end : '',
    timeZone: typeof date?.time_zone === 'string' ? date.time_zone : '',
    hasTime: /T/.test(start)
  };
}

function normalizeNotionTodoPage(page) {
  const properties = isObject(page?.properties) ? page.properties : {};
  return {
    id: String(page?.id || ''),
    url: typeof page?.url === 'string' ? page.url : '',
    title: parseTitle(properties),
    priority: parsePriority(properties),
    due: parseDue(properties),
    status: parseStatus(properties)
  };
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysKey(base, days) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return localDateKey(date);
}

function dueDateKey(todo) {
  const start = todo?.due?.start || '';
  if (!start) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  const parsed = new Date(start);
  return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed);
}

function dueTimeMs(todo) {
  const start = todo?.due?.start || '';
  if (!start) return Number.POSITIVE_INFINITY;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return new Date(`${start}T00:00:00`).getTime();
  const parsed = new Date(start);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

function classifyNotionTodo(todo, now = new Date()) {
  const key = dueDateKey(todo);
  if (!key) return 'nodate';
  const today = localDateKey(now);
  if (key < today) return 'overdue';
  if (key === today) return 'today';
  if (key <= addDaysKey(now, 7)) return 'upcoming';
  return 'later';
}

function priorityRank(priority) {
  if (priority === '🔴 高') return 0;
  if (priority === '🟡 中') return 1;
  if (priority === '🟢 低') return 2;
  return 3;
}

const CATEGORY_ORDER = Object.freeze({ overdue: 0, today: 1, upcoming: 2, nodate: 3, later: 4 });

function compareTodos(a, b) {
  const category = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
  if (category !== 0) return category;
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  const due = dueTimeMs(a) - dueTimeMs(b);
  if (due !== 0) return due;
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans');
}

function normalizeTodoCollection(pages, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const todos = [];
  for (const page of pages || []) {
    const todo = normalizeNotionTodoPage(page);
    if (!todo.title) continue;
    if (todo.status === '已完成') continue;
    const category = classifyNotionTodo(todo, now);
    todos.push({ ...todo, category });
  }
  todos.sort(compareTodos);
  const sections = { overdue: [], today: [], upcoming: [], nodate: [] };
  let laterCount = 0;
  for (const todo of todos) {
    if (todo.category === 'later') laterCount += 1;
    else if (sections[todo.category]) sections[todo.category].push(todo);
  }
  return {
    sections,
    laterCount,
    overdueCount: sections.overdue.length,
    todayCount: sections.today.length,
    items: todos.filter((todo) => todo.category !== 'later')
  };
}

function retryAfterMs(headers) {
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : '';
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

function sanitizeNotionError(error) {
  const known = new Set(['notConfigured', 'invalidToken', 'unauthorized', 'notFound', 'rateLimited', 'network']);
  if (known.has(error?.code)) return {
    code: error.code,
    status: Number(error.status) || 0,
    retryAfterMs: Number(error.retryAfterMs) || 0,
    message: NOTION_TODO_STATUS_TEXT[error.code] || NOTION_TODO_STATUS_TEXT.error
  };
  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') return { code: 'network', status: 0, retryAfterMs: 0, message: NOTION_TODO_STATUS_TEXT.network };
  return { code: 'network', status: 0, retryAfterMs: 0, message: NOTION_TODO_STATUS_TEXT.network };
}

function notionHttpError(response) {
  const status = Number(response?.status) || 0;
  const error = new Error(status === 429 ? NOTION_TODO_STATUS_TEXT.rateLimited : NOTION_TODO_STATUS_TEXT.error);
  error.status = status;
  error.retryAfterMs = status === 429 ? retryAfterMs(response?.headers) : 0;
  if (status === 401) error.code = 'invalidToken';
  else if (status === 403) error.code = 'unauthorized';
  else if (status === 404) error.code = 'notFound';
  else if (status === 429) error.code = 'rateLimited';
  else error.code = 'network';
  return error;
}

async function queryNotionTodoPages(options = {}) {
  const token = normalizeNotionToken(options.token);
  const dataSourceId = normalizeNotionDataSourceId(options.dataSourceId);
  if (!token || !dataSourceId) {
    const error = new Error(NOTION_TODO_STATUS_TEXT.notConfigured);
    error.code = 'notConfigured';
    throw error;
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    const error = new Error(NOTION_TODO_STATUS_TEXT.network);
    error.code = 'network';
    throw error;
  }

  const pages = [];
  let startCursor = '';
  do {
    const body = {
      page_size: 100,
      filter: { property: '状态', status: { does_not_equal: '已完成' } }
    };
    if (startCursor) body.start_cursor = startCursor;
    let response;
    try {
      response = await fetchImpl(`${NOTION_API_ORIGIN}/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: options.signal
      });
    } catch (error) {
      throw sanitizeNotionError(error);
    }
    if (!response?.ok) throw notionHttpError(response);
    const payload = await response.json();
    if (Array.isArray(payload?.results)) pages.push(...payload.results);
    startCursor = payload?.has_more && payload?.next_cursor ? String(payload.next_cursor) : '';
  } while (startCursor);
  return pages;
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function fetchNotionTodoSnapshot(settings, options = {}) {
  if (!notionTodoConfigured(settings)) {
    return emptyNotionTodoSnapshot({ status: 'notConfigured', message: NOTION_TODO_STATUS_TEXT.notConfigured });
  }
  const pages = await queryNotionTodoPages({
    token: settings.notionToken,
    dataSourceId: settings.notionDataSourceId,
    fetchImpl: options.fetchImpl,
    signal: options.signal || timeoutSignal(options.timeoutMs || 15_000)
  });
  const normalized = normalizeTodoCollection(pages, { now: options.now });
  return {
    ok: true,
    status: normalized.items.length > 0 ? 'ok' : 'empty',
    message: normalized.items.length > 0 ? '' : NOTION_TODO_STATUS_TEXT.empty,
    updatedAt: options.nowMs || Date.now(),
    ...normalized
  };
}

function emptyNotionTodoSnapshot(extra = {}) {
  return {
    ok: false,
    status: 'notConfigured',
    message: NOTION_TODO_STATUS_TEXT.notConfigured,
    updatedAt: 0,
    sections: { overdue: [], today: [], upcoming: [], nodate: [] },
    laterCount: 0,
    overdueCount: 0,
    todayCount: 0,
    items: [],
    ...extra
  };
}

function displayCacheSnapshot(snapshot) {
  const base = emptyNotionTodoSnapshot({ ok: Boolean(snapshot?.ok), status: snapshot?.status || 'ok', message: snapshot?.message || '', updatedAt: Number(snapshot?.updatedAt) || 0 });
  const sections = isObject(snapshot?.sections) ? snapshot.sections : {};
  for (const key of Object.keys(base.sections)) {
    base.sections[key] = Array.isArray(sections[key])
      ? sections[key]
          .map((todo) => ({
            id: String(todo?.id || ''),
            url: String(todo?.url || ''),
            title: normalizeVisibleTitle(todo?.title),
            priority: String(todo?.priority || ''),
            due: todo?.due ? { start: String(todo.due.start || ''), end: String(todo.due.end || ''), timeZone: String(todo.due.timeZone || ''), hasTime: Boolean(todo.due.hasTime) } : null,
            status: String(todo?.status || ''),
            category: key
          }))
          .filter((todo) => todo.title)
      : [];
  }
  base.items = Object.values(base.sections).flat();
  base.laterCount = Math.max(0, Math.trunc(Number(snapshot?.laterCount) || 0));
  base.overdueCount = base.sections.overdue.length;
  base.todayCount = base.sections.today.length;
  return base;
}

function readNotionTodoCache(cachePath, fsApi) {
  try {
    const parsed = JSON.parse(fsApi.readFileSync(cachePath, 'utf8'));
    return displayCacheSnapshot(parsed);
  } catch (_) {
    return null;
  }
}

function writeNotionTodoCache(cachePath, snapshot, deps = {}) {
  const writeJson = deps.writeJson || writePrivateJsonAtomic;
  writeJson(cachePath, displayCacheSnapshot(snapshot), { fs: deps.fs });
}

function isAllowedNotionTodoUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch (_) { return false; }
  if (parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'www.notion.so'
    || parsed.hostname === 'notion.so'
    || parsed.hostname === 'app.notion.com';
}

function createNotionTodoRuntime(options = {}) {
  const getSettings = options.getSettings || (() => ({}));
  const cachePath = options.cachePath || '';
  const fsApi = options.fs;
  const fetchSnapshot = options.fetchSnapshot || fetchNotionTodoSnapshot;
  const readCache = options.readCache || readNotionTodoCache;
  const writeCache = options.writeCache || writeNotionTodoCache;
  const logger = options.logger;
  const onUpdate = options.onUpdate;
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  let snapshot = cachePath && fsApi ? readCache(cachePath, fsApi) : null;
  let inFlight = null;
  let timer = null;
  let retryUntil = 0;
  let lastLoggedError = '';

  function emit() {
    if (typeof onUpdate === 'function') onUpdate(runtime.getSnapshot());
  }

  function logOnce(error) {
    const code = error?.code || 'network';
    if (lastLoggedError === code) return;
    lastLoggedError = code;
    if (typeof logger === 'function') logger(`[notion] ${NOTION_TODO_STATUS_TEXT[code] || NOTION_TODO_STATUS_TEXT.error}`);
  }

  function schedule() {
    if (timer) clearTimer(timer);
    const settings = getSettings();
    if (!notionTodoConfigured(settings)) return;
    const interval = normalizeNotionTodoRefreshMs(settings.notionTodoRefreshMs);
    timer = setTimer(() => {
      timer = null;
      void runtime.refresh().finally(schedule);
    }, interval);
  }

  const runtime = {
    getSnapshot() {
      return snapshot || emptyNotionTodoSnapshot();
    },
    async refresh(options = {}) {
      const settings = getSettings();
      if (!notionTodoConfigured(settings)) {
        snapshot = emptyNotionTodoSnapshot({ status: 'notConfigured', message: NOTION_TODO_STATUS_TEXT.notConfigured });
        emit();
        return snapshot;
      }
      if (inFlight) return inFlight;
      if (!options.force && retryUntil > now()) {
        return snapshot || emptyNotionTodoSnapshot({ status: 'rateLimited', message: NOTION_TODO_STATUS_TEXT.rateLimited });
      }
      inFlight = (async () => {
        try {
          const next = await fetchSnapshot(settings, { nowMs: now(), now: new Date(now()) });
          snapshot = displayCacheSnapshot(next);
          retryUntil = 0;
          lastLoggedError = '';
          if (cachePath) {
            try { writeCache(cachePath, snapshot, { fs: fsApi }); } catch (_) {}
          }
          emit();
          return snapshot;
        } catch (error) {
          const safe = sanitizeNotionError(error);
          if (safe.retryAfterMs > 0) retryUntil = now() + Math.min(safe.retryAfterMs, 15 * 60 * 1000);
          logOnce(safe);
          if (!snapshot && cachePath && fsApi) snapshot = readCache(cachePath, fsApi);
          const stale = snapshot ? displayCacheSnapshot({ ...snapshot, ok: false, status: safe.code, message: NOTION_TODO_STATUS_TEXT.stale }) : null;
          snapshot = stale || emptyNotionTodoSnapshot({ status: safe.code, message: safe.message });
          emit();
          return snapshot;
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
    async testConnection() {
      try {
        const next = await fetchSnapshot({ ...getSettings(), notionTodoEnabled: true }, { nowMs: now(), now: new Date(now()) });
        return { ok: true, status: next.status, message: next.message || '' };
      } catch (error) {
        return { ok: false, ...sanitizeNotionError(error) };
      }
    },
    start() {
      schedule();
      if (notionTodoConfigured(getSettings())) void runtime.refresh();
    },
    reconfigure() {
      runtime.stop();
      runtime.start();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    }
  };
  return runtime;
}

module.exports = {
  DEFAULT_NOTION_TODO_DATA_SOURCE_ID,
  DEFAULT_NOTION_TODO_REFRESH_MS,
  NOTION_TODO_STATUS_TEXT,
  NOTION_VERSION,
  createNotionTodoRuntime,
  displayCacheSnapshot,
  emptyNotionTodoSnapshot,
  fetchNotionTodoSnapshot,
  isAllowedNotionTodoUrl,
  normalizeNotionDataSourceId,
  normalizeNotionTodoPage,
  normalizeNotionTodoRefreshMs,
  normalizeNotionToken,
  normalizeTodoCollection,
  notionTodoConfigured,
  notionTodoSettingsForRenderer,
  queryNotionTodoPages,
  sanitizeNotionError,
  writeNotionTodoCache
};
