'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createNexaWidgetHost } = require('../../src/electron/renderer/nexaWidgetHost');

class FakeElement {
  constructor() {
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.attributes = new Map();
    this.hidden = false;
    this.inert = false;
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name)
    };
    this.statusTarget = null;
  }

  append(element) {
    element.remove();
    element.parent = this;
    this.children.push(element);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  querySelector(selector) {
    return selector === '[data-nexa-widget-status]' ? this.statusTarget : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

test('widget host registers, displays, hides, and updates status', () => {
  const today = new FakeElement();
  const status = new FakeElement();
  const host = createNexaWidgetHost({ slots: { today, status } });
  const card = new FakeElement();
  card.statusTarget = { textContent: '' };

  assert.deepEqual(host.register({
    widgetId: 'module:calendar', moduleId: 'calendar', slotId: 'today', order: 5,
    element: card, status: 'READY', statusLabel: '可用', visible: true,
    capabilities: { movable: true, themable: true, removable: true }
  }), {
    widgetId: 'module:calendar', moduleId: 'calendar', slotId: 'today', order: 5,
    status: 'READY', visible: true, theme: 'inherit',
    capabilities: { movable: true, themable: true, removable: true }
  });
  assert.equal(today.children[0], card);
  assert.equal(card.statusTarget.textContent, '可用');
  assert.equal(card.attributes.get('aria-hidden'), 'false');

  assert.equal(host.hide('module:calendar'), true);
  assert.equal(card.hidden, true);
  assert.equal(host.show('module:calendar'), true);
  assert.equal(card.hidden, false);
  assert.equal(host.setStatus('module:calendar', 'ERROR', '异常'), 'ERROR');
  assert.equal(card.dataset.widgetStatus, 'ERROR');
  assert.equal(card.statusTarget.textContent, '异常');
});

test('widget host preserves future move, theme, unplug, and reset boundaries', () => {
  const today = new FakeElement();
  const status = new FakeElement();
  const host = createNexaWidgetHost({ slots: { today, status } });
  const first = new FakeElement();
  const second = new FakeElement();
  host.register({ widgetId: 'first', slotId: 'today', element: first, status: 'READY' });
  host.register({ widgetId: 'second', slotId: 'status', element: second, status: 'LIMITED' });

  assert.equal(host.move('first', 'status', 3).slotId, 'status');
  assert.equal(status.children.includes(first), true);
  assert.equal(host.setTheme('first', 'contrast'), 'contrast');
  assert.equal(first.dataset.widgetTheme, 'contrast');
  assert.equal(host.unregister('first'), true);
  assert.equal(host.unregister('first'), false);
  host.clear();
  assert.deepEqual(host.getSnapshot(), []);
  assert.equal(status.children.length, 0);
});
