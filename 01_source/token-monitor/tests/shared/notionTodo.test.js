'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_NOTION_TODO_DATA_SOURCE_ID,
  NOTION_VERSION,
  createNotionTodoRuntime,
  displayCacheSnapshot,
  fetchNotionTodoSnapshot,
  isAllowedNotionTodoUrl,
  normalizeTodoCollection,
  queryNotionTodoPages,
  writeNotionTodoCache
} = require('../../src/shared/notionTodo');

function page({ id, title, priority, status = '待开始', due, url } = {}) {
  return {
    id: id || title || 'id',
    url: url || `https://www.notion.so/${id || 'abc'}`,
    properties: {
      '任务名称': { title: title ? [{ plain_text: title }] : [] },
      '优先级': { select: priority ? { name: priority } : null },
      '截止日期': { date: due ? { start: due } : null },
      '状态': { status: status ? { name: status } : null }
    }
  };
}

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || '' },
    json: async () => payload
  };
}

test('normalizes, filters and sorts Notion todo pages by local date and priority', () => {
  const now = new Date(2026, 7, 3, 10, 0, 0);
  const result = normalizeTodoCollection([
    page({ title: 'done', status: '已完成', due: '2026-08-03', priority: '🔴 高' }),
    page({ title: 'today low', status: '进行中', due: '2026-08-03T09:00:00+08:00', priority: '🟢 低' }),
    page({ title: 'today high', status: '待开始', due: '2026-08-03', priority: '🔴 高' }),
    page({ title: 'overdue', due: '2026-08-02', priority: '🟡 中' }),
    page({ title: 'future', due: '2026-08-10', priority: '🟢 低' }),
    page({ title: 'later', due: '2026-08-11', priority: '🔴 高' }),
    page({ title: 'nodate', priority: '🟡 中' })
  ], { now });

  assert.deepEqual(result.sections.overdue.map((todo) => todo.title), ['overdue']);
  assert.deepEqual(result.sections.today.map((todo) => todo.title), ['today high', 'today low']);
  assert.deepEqual(result.sections.upcoming.map((todo) => todo.title), ['future']);
  assert.deepEqual(result.sections.nodate.map((todo) => todo.title), ['nodate']);
  assert.equal(result.laterCount, 1);
  assert.equal(result.todayCount, 2);
  assert.equal(result.overdueCount, 1);
  assert.equal(result.items.some((todo) => todo.title === 'done'), false);
  assert.equal(result.sections.today[0].priority, '🔴 高');
  assert.equal(result.sections.today[1].due.hasTime, true);
});

test('blank Notion todo titles are filtered before sections, counts and cache', () => {
  const now = new Date(2026, 7, 3, 10, 0, 0);
  const result = normalizeTodoCollection([
    page({ id: 'empty-array', due: '2026-08-03' }),
    page({ id: 'blank-space', title: '   \n  \t ', due: '2026-08-02' }),
    page({ id: 'blank-invisible', title: '\u200B\u2060', due: '2026-08-11' }),
    page({ id: 'normal', title: 'normal task', due: '2026-08-03' })
  ], { now });

  assert.deepEqual(result.items.map((todo) => todo.title), ['normal task']);
  assert.equal(result.todayCount, 1);
  assert.equal(result.overdueCount, 0);
  assert.equal(result.laterCount, 0);
  assert.deepEqual(result.sections.overdue, []);
  assert.deepEqual(result.sections.nodate, []);

  const cached = displayCacheSnapshot({
    ok: true,
    status: 'ok',
    updatedAt: 1,
    sections: {
      overdue: [{ id: 'blank-cache', title: '   ', url: 'https://www.notion.so/blank-cache' }],
      today: result.sections.today,
      upcoming: [],
      nodate: []
    },
    laterCount: 0
  });
  assert.deepEqual(cached.sections.overdue, []);
  assert.deepEqual(cached.items.map((todo) => todo.title), ['normal task']);
});

test('queryNotionTodoPages uses data source query endpoint, headers, server filter and pagination', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return calls.length === 1
      ? response(200, { results: [page({ title: 'one' })], has_more: true, next_cursor: 'next' })
      : response(200, { results: [page({ title: 'two' })], has_more: false });
  };

  const pages = await queryNotionTodoPages({
    token: 'unit-test-token',
    dataSourceId: DEFAULT_NOTION_TODO_DATA_SOURCE_ID,
    fetchImpl
  });

  assert.equal(pages.length, 2);
  assert.equal(calls[0].url, `https://api.notion.com/v1/data_sources/${DEFAULT_NOTION_TODO_DATA_SOURCE_ID}/query`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer unit-test-token');
  assert.equal(calls[0].options.headers['Notion-Version'], NOTION_VERSION);
  assert.deepEqual(calls[0].body.filter, { property: '状态', status: { does_not_equal: '已完成' } });
  assert.equal(calls[1].body.start_cursor, 'next');
  assert.doesNotMatch(calls[0].url, /\/v1\/databases\//);
});

test('Notion API and network failures return safe sanitized errors', async () => {
  const cases = [
    [401, 'invalidToken'],
    [403, 'unauthorized'],
    [404, 'notFound'],
    [429, 'rateLimited']
  ];
  for (const [status, code] of cases) {
    await assert.rejects(
      queryNotionTodoPages({
        token: 'unit-test-token',
        dataSourceId: 'source',
        fetchImpl: async () => response(status, {}, { 'retry-after': '2' })
      }),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(JSON.stringify(error), /unit-test-token/);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      }
    );
  }

  await assert.rejects(
    queryNotionTodoPages({
      token: 'unit-test-token',
      dataSourceId: 'source',
      fetchImpl: async () => { throw Object.assign(new Error('unit-test-token leaked?'), { code: 'ECONNRESET' }); }
    }),
    (error) => {
      assert.equal(error.code, 'network');
      assert.doesNotMatch(JSON.stringify(error), /unit-test-token/);
      return true;
    }
  );
});

test('fetchNotionTodoSnapshot does not fetch when Notion is disabled or incomplete', async () => {
  let calls = 0;
  const snapshot = await fetchNotionTodoSnapshot({
    notionTodoEnabled: false,
    notionToken: 'unit-test-token',
    notionDataSourceId: 'source'
  }, {
    fetchImpl: async () => { calls += 1; return response(200, { results: [] }); }
  });

  assert.equal(calls, 0);
  assert.equal(snapshot.status, 'notConfigured');
});

test('task display cache contains only display fields and never stores token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-todo-cache-'));
  const cachePath = path.join(dir, 'notion-todos.json');
  try {
    writeNotionTodoCache(cachePath, {
      ok: true,
      status: 'ok',
      updatedAt: 1,
      notionToken: 'unit-test-token',
      sections: {
        overdue: [displayCacheSnapshot(normalizeTodoCollection([page({ title: 'safe', due: '2026-08-02' })], { now: new Date(2026, 7, 3) })).sections.overdue[0]],
        today: [],
        upcoming: [],
        nodate: []
      },
      laterCount: 0
    });
    const raw = fs.readFileSync(cachePath, 'utf8');
    assert.doesNotMatch(raw, /unit-test-token/);
    assert.match(raw, /safe/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime keeps old cache on failure, does not overlap refreshes, and avoids repeated logs', async () => {
  const oldSnapshot = displayCacheSnapshot({
    ok: true,
    status: 'ok',
    updatedAt: 1,
    sections: { overdue: [], today: [normalizeTodoCollection([page({ title: 'old', due: '2026-08-03' })], { now: new Date(2026, 7, 3) }).sections.today[0]], upcoming: [], nodate: [] },
    laterCount: 0
  });
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const logs = [];
  const runtime = createNotionTodoRuntime({
    getSettings: () => ({ notionTodoEnabled: true, notionToken: 'unit-test-token', notionDataSourceId: 'source' }),
    readCache: () => oldSnapshot,
    writeCache: () => { throw new Error('write failed'); },
    cachePath: 'cache.json',
    fs: fs,
    logger: (line) => logs.push(line),
    fetchSnapshot: async () => {
      calls += 1;
      await pending;
      const error = new Error('unit-test-token should not log');
      error.code = 'network';
      throw error;
    }
  });

  const first = runtime.refresh();
  const second = runtime.refresh();
  assert.equal(calls, 1);
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.sections.today[0].title, 'old');
  assert.equal(secondResult.sections.today[0].title, 'old');
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /unit-test-token/);
});

test('test connection can run without enabling automatic todo refresh', async () => {
  let calls = 0;
  const runtime = createNotionTodoRuntime({
    getSettings: () => ({ notionTodoEnabled: false, notionToken: 'unit-test-token', notionDataSourceId: 'source' }),
    fetchSnapshot: async () => {
      calls += 1;
      return { ok: true, status: 'empty', message: '', updatedAt: 1, sections: { overdue: [], today: [], upcoming: [], nodate: [] }, laterCount: 0, items: [] };
    }
  });

  const result = await runtime.testConnection();
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});
test('runtime does not call network when disabled', async () => {
  let calls = 0;
  const runtime = createNotionTodoRuntime({
    getSettings: () => ({ notionTodoEnabled: false, notionToken: 'unit-test-token', notionDataSourceId: 'source' }),
    fetchSnapshot: async () => { calls += 1; return {}; }
  });
  const snapshot = await runtime.refresh();
  assert.equal(calls, 0);
  assert.equal(snapshot.status, 'notConfigured');
});

test('only supported Notion HTTPS task URLs are allowed', () => {
  assert.equal(isAllowedNotionTodoUrl('https://www.notion.so/page-id'), true);
  assert.equal(isAllowedNotionTodoUrl('https://notion.so/page-id'), true);
  assert.equal(isAllowedNotionTodoUrl('https://app.notion.com/page-id'), true);
  assert.equal(isAllowedNotionTodoUrl('http://www.notion.so/page-id'), false);
  assert.equal(isAllowedNotionTodoUrl('https://evil.example/page-id'), false);
  assert.equal(isAllowedNotionTodoUrl('https://www.notion.so.evil.example/page-id'), false);
});
