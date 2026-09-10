'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const composition = require('../../src/shared/nexaDesktopComposition');
const { createModulePresentationAdapter } = require('../../src/shared/nexaModulePresentationAdapter');

test('desktop composition freezes the four v0.1 Home widget slots', () => {
  assert.equal(composition.HOME_WIDGET_CONTRACT_VERSION, 1);
  assert.deepEqual(composition.listHomeSlots('zh-CN'), [
    { id: 'today', label: '今日区域' },
    { id: 'data', label: '数据区域' },
    { id: 'activity', label: '动态区域' },
    { id: 'status', label: '底部状态区域' }
  ]);
  assert.deepEqual(composition.listHomeSlots('en').map(({ id }) => id), [
    'today', 'data', 'activity', 'status'
  ]);
});

test('desktop composition owns presentation placement without importing module data', () => {
  assert.deepEqual(composition.getWidgetPlacement('today-tomorrow'), {
    moduleId: 'today-tomorrow', slotId: 'today', order: 10
  });
  assert.deepEqual(composition.getWidgetPlacement('device-center'), {
    moduleId: 'device-center', slotId: 'status', order: 10
  });
  assert.equal(composition.getWidgetPlacement('dashi'), undefined);
  assert.equal(composition.listWidgetPlacements().some(({ moduleId }) => moduleId === 'dashi'), false);
  assert.equal(composition.getWidgetPlacement('future-module'), undefined);
  assert.deepEqual(composition.resolveWidgetPlacement('future-module'), {
    moduleId: 'future-module', slotId: 'status', order: 1000
  });
  assert.deepEqual(composition.resolveWidgetPlacement('future-module', { slotId: 'data', order: 7 }), {
    moduleId: 'future-module', slotId: 'data', order: 7
  });
});

test('presentation adapter projects bounded widget metadata and runtime state', () => {
  const adapter = createModulePresentationAdapter({ composition });
  const widget = adapter.adapt(
    { moduleId: 'consumption', routeId: 'cost', label: '消费中心', description: '查看消费状态。' },
    { moduleId: 'consumption', enabled: true, privateData: { total: 99 } },
    'READY',
    { detail: 'MODULE_READY', theme: 'compact' }
  );
  assert.deepEqual(widget, {
    widgetId: 'module:consumption',
    moduleId: 'consumption',
    routeId: 'cost',
    slotId: 'data',
    order: 10,
    title: '消费中心',
    description: '查看消费状态。',
    status: 'READY',
    detail: 'MODULE_READY',
    enabled: true,
    visible: true,
    theme: 'compact',
    capabilities: { movable: true, themable: true, removable: true }
  });
  assert.equal(Object.hasOwn(widget, 'privateData'), false);
  assert.equal(Object.hasOwn(widget, 'data'), false);
  assert.equal(Object.isFrozen(widget), true);
});

test('presentation adapter supports layout overrides and fail-closed status', () => {
  const adapter = createModulePresentationAdapter({ composition });
  const widgets = adapter.adaptAll({
    entries: [{ moduleId: 'future-module', routeId: 'future', label: 'Future', description: '' }],
    modules: [{ moduleId: 'future-module', enabled: false }],
    stateFor: () => 'invented',
    detailFor: () => 'raw path is rejected',
    layouts: new Map([['future-module', { slotId: 'activity', order: 2, visible: false }]])
  });
  assert.equal(widgets[0].slotId, 'activity');
  assert.equal(widgets[0].order, 2);
  assert.equal(widgets[0].visible, false);
  assert.equal(widgets[0].status, 'OFFLINE');
  assert.equal(widgets[0].detail, '');
});
