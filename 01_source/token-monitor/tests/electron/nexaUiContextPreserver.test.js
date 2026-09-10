'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { captureUiContext, restoreUiContext } = require('../../src/electron/renderer/nexaUiContextPreserver');

function element({ id, tagName = 'DIV', value, scrollTop = 0, scrollHeight = 0, clientHeight = 0, open = false, role = '', selected = '' }) {
  const attributes = new Map([['role', role], ['aria-selected', selected]]);
  const item = { id, tagName, value, scrollTop, scrollHeight, clientHeight, open, dataset: {}, name: '', getAttribute: (key) => attributes.get(key) || null, setAttribute: (key, next) => attributes.set(key, next) };
  return item;
}

test('refresh capture and restore keeps scroll, selected date/filter, selected tab and expansion', () => {
  const scroller = element({ id: 'consumption-list', scrollTop: 318, scrollHeight: 1000, clientHeight: 300 });
  const filter = element({ id: 'expense-filter', tagName: 'INPUT', value: '本月' });
  const date = element({ id: 'calendar-date', tagName: 'INPUT', value: '2026-09-05' });
  const details = element({ id: 'creator-details', tagName: 'DETAILS', open: true });
  const tab = element({ id: 'learning-tab', role: 'tab', selected: 'true' });
  const items = [scroller, filter, date, details, tab];
  const root = { id: 'root', tagName: 'DIV', dataset: {}, name: '', scrollHeight: 0, clientHeight: 0, getAttribute: () => null, querySelectorAll: () => items };
  const byId = Object.fromEntries([root, ...items].map((item) => [item.id, item]));
  const document = { scrollingElement: { scrollTop: 455 }, getElementById: (id) => byId[id] || null, querySelectorAll: () => [] };
  const window = { scrollY: 455, scrollX: 0, scrollTo: ({ top }) => { window.scrollY = top; } };
  const snapshot = captureUiContext(document, window, [root]);
  scroller.scrollTop = 0; filter.value = '今日'; date.value = ''; details.open = false; tab.setAttribute('aria-selected', 'false'); window.scrollY = 0;
  restoreUiContext(snapshot, document, window);
  assert.deepEqual({ page: window.scrollY, list: scroller.scrollTop, filter: filter.value, date: date.value, open: details.open, tab: tab.getAttribute('aria-selected') }, { page: 455, list: 318, filter: '本月', date: '2026-09-05', open: true, tab: 'true' });
});

test('global preserver covers Home, Consumption, Calendar, Automation, Learning, Device and Creator surfaces', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/nexaRendererIntegration.js'), 'utf8');
  for (const name of ['workspace', 'consumptionSurface', 'daySurface', 'automationCenterSurface', 'studyCenterSurface', 'deviceSurface', 'creatorOpsSurface']) assert.match(source, new RegExp(`roots:[\\s\\S]{0,240}${name}`));
});
