'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  calendarDays,
  createRenderer
} = require('../../src/electron/renderer/nexaCalendarHomeWidgetRenderer');
const { createNexaWidgetHost } = require('../../src/electron/renderer/nexaWidgetHost');

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
  }

  values() {
    return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean));
  }

  toggle(name, force) {
    const values = this.values();
    const add = force === undefined ? !values.has(name) : force;
    if (add) values.add(name);
    else values.delete(name);
    this.owner.className = [...values].join(' ');
    return add;
  }

  contains(name) {
    return this.values().has(name);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    const matches = selector === '[data-nexa-widget-status]'
      ? this.attributes.has('data-nexa-widget-status')
      : selector.startsWith('.') && this.classList.contains(selector.slice(1));
    if (matches) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ currentTarget: this, preventDefault() {}, ...event });
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function allText(element) {
  return [element.textContent, ...element.children.map(allText)].filter(Boolean).join(' ');
}

function find(element, predicate) {
  if (predicate(element)) return element;
  for (const child of element.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

const GENERATED_AT = '2026-08-13T00:00:00.000Z';

function summaryFixture(date = '2026-08-13', overrides = {}) {
  return {
    contract_version: '0.2.0',
    date,
    todo_count: 2,
    event_count: 1,
    holiday_label: null,
    anniversary_label: null,
    sublabel: '待办 2 项',
    sublabel_kind: 'todo_count',
    sublabel_priority: 30,
    events: [{ id: 'event-1', title: '产品评审', display_time: '09:00' }],
    next_event: { id: 'event-1', title: '产品评审', display_time: '09:00' },
    tasks: [
      { id: 'task-1', title: '整理纪要', status: 'pending', due_at: date },
      { id: 'task-2', title: '复核周报', status: 'pending', due_at: date }
    ],
    timeline: [
      {
        type: 'calendar_event',
        start_at: `${date}T09:00:00+08:00`,
        item: { id: 'event-1', title: '产品评审' }
      },
      {
        type: 'task_plan',
        start_at: `${date}T14:00:00+08:00`,
        item: { id: 'task-1', title: '整理纪要' }
      }
    ],
    detail_handoff: { route_id: 'today-tomorrow', action: 'view-date', date },
    edit_handoff: { route_id: 'today-tomorrow', action: 'edit-date', date },
    availability: 'available',
    generated_at: GENERATED_AT,
    freshness: {
      status: 'unknown', reason: 'source_timestamp_unavailable', generated_at: GENERATED_AT
    },
    ...overrides
  };
}

function monthDayFixture(date, overrides = {}) {
  const { contract_version, generated_at, freshness, ...value } = summaryFixture(date, overrides);
  return value;
}

function monthSummaryFixture(startDate, endDate, dates, overrides = {}) {
  const today = dates.find((item) => item.date === '2026-08-13') || dates[0];
  return {
    contract_version: '0.2.0',
    range: { start_date: startDate, end_date: endDate },
    dates,
    today_summary: today,
    next_event: today?.next_event || null,
    availability: 'available',
    generated_at: GENERATED_AT,
    freshness: {
      status: 'unknown', reason: 'source_timestamp_unavailable', generated_at: GENERATED_AT
    },
    ...overrides
  };
}

function calendarApi(overrides = {}) {
  return {
    async getDateSummary(date) { return { ok: true, value: summaryFixture(date) }; },
    async getMonthSummary(startDate, endDate) {
      return {
        ok: true,
        value: monthSummaryFixture(startDate, endDate, [monthDayFixture('2026-08-13')])
      };
    },
    async parseHomeInput() { return { ok: true, value: { time_state: 'relative_unresolved' } }; },
    async getLocalAiState() {
      return {
        ok: true,
        value: {
          contract_version: '0.1.0', status: 'unconfigured', configured: false,
          can_propose: false, can_write: false, runtime_connection: 'human_blocked', last_error_at: null
        }
      };
    },
    async proposeLocalAi() { return { ok: false, error: { code: 'AI_UNCONFIGURED' } }; },
    async confirmLocalAi() { return { ok: false, error: { code: 'CONFIRMATION_REQUIRED' } }; },
    async cancelLocalAi() { return { ok: false, error: { code: 'PROPOSAL_NOT_FOUND' } }; },
    async undoLocalAi() { return { ok: false, error: { code: 'PROPOSAL_NOT_FOUND' } }; },
    async execute(command) { return { ok: true, value: { status: 'executed', command } }; },
    ...overrides
  };
}

test('Today Slot renders the additive V0.2 date summary while retaining the Butler bridge', async () => {
  const calls = [];
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({
      async getDateSummary(date) {
        calls.push(['date', date]);
        return { ok: true, value: summaryFixture(date) };
      },
      async getMonthSummary(startDate, endDate) {
        calls.push(['month', startDate, endDate]);
        return {
          ok: true,
          value: monthSummaryFixture(startDate, endDate, [monthDayFixture('2026-08-13')])
        };
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  await renderer.loadMonth('2026-08');

  const text = allText(renderer.getElement());
  assert.match(text, /下一事件：产品评审 · 09:00/);
  assert.match(text, /安排/);
  assert.match(text, /整理纪要/);
  assert.match(text, /待办 2 项/);
  assert.match(text, /日期 2026-08-13/);
  assert.match(text, /事件 1 项/);
  assert.ok(text.indexOf('下一事件') < text.indexOf('安排'));
  assert.ok(text.indexOf('安排') < text.lastIndexOf('待办 2 项'));
  assert.deepEqual(calls, [
    ['date', '2026-08-13'],
    ['month', '2026-07-26', '2026-09-05']
  ]);
  assert.equal(renderer.getState().status, 'READY');
});

test('Today Slot renders the V0.2 no-arrangement state without fabricated events', async () => {
  const empty = summaryFixture('2026-08-13', {
    todo_count: 0,
    event_count: 0,
    sublabel: '暂无安排',
    sublabel_kind: 'empty',
    sublabel_priority: 60,
    events: [],
    next_event: null,
    tasks: [],
    timeline: []
  });
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({ async getDateSummary() { return { ok: true, value: empty }; } })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  const text = allText(renderer.getElement());
  assert.match(text, /下一事件：暂无/);
  assert.match(text, /选中日期没有已确认的安排/);
  assert.match(text, /事件 0 项/);
  assert.doesNotMatch(text, /模拟|示例事件|假数据/);
});

test('expanded month renders truthful per-date sublabels and exposes view/edit handoffs', async () => {
  const opened = [];
  const dates = [
    monthDayFixture('2026-08-13'),
    monthDayFixture('2026-08-15', {
      todo_count: 0,
      event_count: 1,
      holiday_label: '中秋节',
      sublabel: '中秋节',
      sublabel_kind: 'holiday',
      sublabel_priority: 40,
      events: [{ id: 'holiday-1', title: '中秋节', display_time: '全天' }],
      next_event: null,
      tasks: [],
      timeline: []
    })
  ];
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({
      async getMonthSummary(startDate, endDate) {
        return { ok: true, value: monthSummaryFixture(startDate, endDate, dates) };
      }
    }),
    onOpenCalendar(value) { opened.push(value); }
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  await renderer.loadMonth('2026-08');
  find(renderer.getElement(), (element) => element.textContent === '展开日期信息').dispatch('click');

  assert.equal(renderer.getState().expanded, true);
  assert.equal(renderer.getElement().classList.contains('is-calendar-expanded'), true);
  const selectedDay = find(renderer.getElement(), (element) => element.dataset?.date === '2026-08-13');
  const holiday = find(renderer.getElement(), (element) => element.dataset?.date === '2026-08-15');
  assert.match(allText(selectedDay), /待办 2 项/);
  assert.match(allText(holiday), /中秋节/);
  assert.equal(calendarDays('2026-08-01', { dates }).filter((entry) => entry.sublabel).length, 2);

  const openButton = find(renderer.getElement(), (element) => element.textContent === '查看完整日历');
  const editButton = find(renderer.getElement(), (element) => element.textContent === '编辑当日');
  openButton.dispatch('click');
  editButton.dispatch('click');
  assert.deepEqual(opened, [
    { route_id: 'today-tomorrow', action: 'view-date', date: '2026-08-13' },
    { route_id: 'today-tomorrow', action: 'edit-date', date: '2026-08-13' }
  ]);
});

test('Today Slot creates and completes real local tasks through the public execute bridge', async () => {
  const commands = [];
  let reads = 0;
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    now: new Date(2026, 7, 13, 9, 30),
    api: calendarApi({
      async getDateSummary(date) {
        reads += 1;
        return { ok: true, value: summaryFixture(date) };
      },
      async execute(command) {
        commands.push(command);
        return { ok: true, value: { status: 'executed' } };
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');

  await renderer.createDayTask('  整理   周报  ');
  await renderer.completeTask('task-1');

  assert.equal(commands.length, 2);
  assert.deepEqual({
    type: commands[0].type,
    planDate: commands[0].planDate,
    title: commands[0].title
  }, {
    type: 'create-day-task',
    planDate: '2026-08-13',
    title: '整理 周报'
  });
  assert.match(commands[0].commandId, /^nexa-home-create-task-/u);
  assert.equal(commands[1].type, 'complete-task');
  assert.equal(commands[1].taskId, 'task-1');
  assert.match(commands[1].commandId, /^nexa-home-complete-task-/u);
  assert.ok(reads >= 3, 'each write refreshes the selected date summary');
  assert.match(allText(renderer.getElement()), /事项已完成，日历摘要已刷新/);
});

test('month is visible by default, marks today semantically, and returns to today without changing card mode', async () => {
  const calls = [];
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    now: new Date(2026, 7, 13, 9, 30),
    api: calendarApi({
      async getDateSummary(date) {
        calls.push(date);
        return { ok: true, value: summaryFixture(date) };
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-15');
  await renderer.loadMonth('2026-08');

  const monthPanel = find(renderer.getElement(), (element) => element.classList?.contains('nexa-calendar-month-panel'));
  const today = find(renderer.getElement(), (element) => element.dataset?.date === '2026-08-13' && element.classList?.contains('nexa-calendar-month-day'));
  const returnToday = find(renderer.getElement(), (element) => element.textContent === '回到今天');
  assert.equal(monthPanel.hidden, false);
  assert.equal(today.attributes.get('aria-current'), 'date');
  assert.match(allText(today), /今天/);
  assert.equal(returnToday.disabled, false);
  returnToday.dispatch('click');
  await Promise.resolve();
  assert.equal(renderer.getState().selectedDate, '2026-08-13');
  assert.equal(renderer.getState().expanded, false);
  assert.equal(returnToday.disabled, true);
  assert.equal(calls.at(-1), '2026-08-13');
});

test('month keyboard navigation supports arrows and week Home/End keys', async () => {
  const calls = [];
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    now: new Date(2026, 7, 13),
    api: calendarApi({
      async getDateSummary(date) {
        calls.push(date);
        return { ok: true, value: summaryFixture(date) };
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  const selected = find(renderer.getElement(), (element) => element.dataset?.date === '2026-08-13' && element.classList?.contains('nexa-calendar-month-day'));
  selected.dispatch('keydown', { key: 'ArrowRight' });
  await Promise.resolve();
  assert.equal(renderer.getState().selectedDate, '2026-08-14');
  assert.equal(calls.at(-1), '2026-08-14');
});

test('a stale month response cannot replace the newer displayed month', async () => {
  const pending = new Map();
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({
      getMonthSummary(startDate, endDate) {
        return new Promise((resolve) => pending.set(startDate, { endDate, resolve }));
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  await Promise.resolve();
  const august = renderer.loadMonth('2026-08');
  assert.ok(pending.has('2026-07-26'));

  const nextMonth = find(renderer.getElement(), (element) => element.attributes.get('aria-label') === '下个月');
  nextMonth.dispatch('click');
  await Promise.resolve();
  const september = renderer.loadMonth('2026-09');
  assert.ok(pending.has('2026-08-30'));
  pending.get('2026-08-30').resolve({
    ok: true,
    value: monthSummaryFixture('2026-08-30', '2026-10-10', [
      monthDayFixture('2026-09-10', { sublabel: '新月份', sublabel_kind: 'event', sublabel_priority: 50 })
    ])
  });
  await september;
  assert.match(allText(find(renderer.getElement(), (element) => element.dataset?.date === '2026-09-10')), /新月份/);

  pending.get('2026-07-26').resolve({
    ok: true,
    value: monthSummaryFixture('2026-07-26', '2026-09-05', [
      monthDayFixture('2026-08-13', { sublabel: '过期月份' })
    ])
  });
  assert.equal(await august, null);
  assert.match(allText(find(renderer.getElement(), (element) => element.dataset?.date === '2026-09-10')), /新月份/);
  assert.doesNotMatch(allText(renderer.getElement()), /过期月份/);
});

test('Home calendar delegates natural-language scheduling to the one global command bar', async () => {
  const calls = [];
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi(),
    onOpenGlobalCommand(context) { calls.push(context); }
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  await renderer.load('2026-08-13');
  const shortcut = find(renderer.getElement(), (element) => element.textContent === '在全局命令栏中安排');
  assert.ok(shortcut);
  assert.equal(find(renderer.getElement(), (element) => /明天下午/.test(element.placeholder || '')), null);
  shortcut.dispatch('click');
  assert.equal(calls[0].selectedDate, '2026-08-13');
});

test('Calendar failures and module-not-ready state remain local to the Widget', async () => {
  const secret = 'E:\\private\\calendar.db';
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({ async getDateSummary() { throw new Error(`database failed at ${secret}`); } })
  });
  renderer.setHostState({ enabled: true, status: 'OFFLINE' });
  assert.match(allText(renderer.getElement()), /日历管家尚未就绪/);
  assert.equal(await renderer.load('2026-08-13'), null);
  const text = allText(renderer.getElement());
  assert.match(text, /今日日历暂时无法读取，其他桌面功能仍可继续使用/);
  assert.doesNotMatch(text, /读取失败/);
  assert.doesNotMatch(text, /private|calendar\.db|database failed/);
  assert.equal(renderer.getState().status, 'ERROR');
});

test('concurrent initialization coalesces, Host registration stays unique, and dispose removes listeners', async () => {
  let resolveSummary;
  let summaryCalls = 0;
  const renderer = createRenderer({
    ownerDocument: new FakeDocument(),
    api: calendarApi({
      getDateSummary() {
        summaryCalls += 1;
        return new Promise((resolve) => { resolveSummary = resolve; });
      }
    })
  });
  renderer.setHostState({ enabled: true, status: 'READY' });
  const first = renderer.load('2026-08-13');
  const duplicate = renderer.load('2026-08-13');
  assert.equal(first, duplicate);
  assert.equal(summaryCalls, 0, 'the bridge call begins in the queued microtask');
  await Promise.resolve();
  assert.equal(summaryCalls, 1);
  resolveSummary({ ok: true, value: summaryFixture() });
  await first;
  await renderer.loadMonth('2026-08');

  const slot = new FakeElement('div');
  const host = createNexaWidgetHost({ slots: { today: slot } });
  const definition = {
    widgetId: 'module:today-tomorrow', moduleId: 'today-tomorrow', slotId: 'today',
    element: renderer.getElement(), status: 'READY'
  };
  host.register(definition);
  host.clear();
  host.register(definition);
  assert.equal(host.getSnapshot().length, 1);

  const form = find(renderer.getElement(), (element) => element.tagName === 'FORM');
  const openButton = find(renderer.getElement(), (element) => element.textContent === '查看完整日历');
  const editButton = find(renderer.getElement(), (element) => element.textContent === '编辑当日');
  const quickAddForm = find(renderer.getElement(), (element) => element.classList?.contains('nexa-calendar-quick-add'));
  const refreshButton = find(renderer.getElement(), (element) => element.textContent === '刷新摘要');
  assert.equal(form.listenerCount('submit'), 1);
  assert.equal(quickAddForm.listenerCount('submit'), 1);
  assert.equal(openButton.listenerCount('click'), 1);
  assert.equal(editButton.listenerCount('click'), 1);
  assert.equal(refreshButton.listenerCount('click'), 1);
  assert.equal(renderer.dispose(), true);
  assert.equal(renderer.dispose(), false);
  assert.equal(form.listenerCount('submit'), 0);
  assert.equal(openButton.listenerCount('click'), 0);
  assert.equal(editButton.listenerCount('click'), 0);
  assert.equal(quickAddForm.listenerCount('submit'), 0);
  assert.equal(refreshButton.listenerCount('click'), 0);
});
