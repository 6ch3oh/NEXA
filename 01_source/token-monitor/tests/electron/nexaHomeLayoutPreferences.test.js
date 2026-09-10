'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_HOME_LAYOUT_DENSITY,
  DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS,
  HOME_LAYOUT_DENSITIES,
  createNexaHomeLayoutPreferencesController,
  normalizeHomeLayoutDensity
} = require('../../src/electron/renderer/nexaHomeLayoutPreferences');

const widgetIds = [
  'module:today-tomorrow',
  'core:ai-usage',
  'module:consumption',
  'core:daily-learning',
  'core:device-network'
];

function canonicalPreferences(overrides = {}) {
  return {
    homeModuleOrder: widgetIds.join(','),
    hiddenHomeModules: '',
    homeModuleDensity: 'comfortable',
    ...overrides
  };
}

function createHarness(initial = canonicalPreferences(), controllerOptions = {}) {
  let stored = { ...initial };
  const writes = [];
  const controller = createNexaHomeLayoutPreferencesController({
    widgetIds,
    readPreferences: async () => ({ ...stored }),
    writePreferences: async (patch) => {
      const copy = { ...patch };
      writes.push(copy);
      stored = { ...stored, ...copy };
    },
    ...controllerOptions
  });
  return {
    controller,
    getStored: () => ({ ...stored }),
    writes
  };
}

test('exports frozen density and preference-key contracts', () => {
  assert.deepEqual(HOME_LAYOUT_DENSITIES, ['comfortable', 'compact']);
  assert.equal(DEFAULT_HOME_LAYOUT_DENSITY, 'comfortable');
  assert.deepEqual(DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS, {
    order: 'homeModuleOrder',
    hidden: 'hiddenHomeModules',
    density: 'homeModuleDensity'
  });
  assert.equal(Object.isFrozen(HOME_LAYOUT_DENSITIES), true);
  assert.equal(Object.isFrozen(DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS), true);
  assert.equal(normalizeHomeLayoutDensity(' COMPACT '), 'compact');
  assert.equal(normalizeHomeLayoutDensity('wide'), 'comfortable');
  assert.equal(normalizeHomeLayoutDensity('wide', 'compact'), 'compact');
});

test('controller validates widget definitions, callbacks, and preference keys', () => {
  const callbacks = { readPreferences() { return {}; }, writePreferences() {} };
  assert.throws(
    () => createNexaHomeLayoutPreferencesController(callbacks),
    /at least one widgetId/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({ widgetIds: [], ...callbacks }),
    /at least one widgetId/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({ widgetIds: ['a', ' A '], ...callbacks }),
    /Duplicate/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({ widgetIds: ['bad,id'], ...callbacks }),
    /without commas/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({ widgetIds: ['a'], writePreferences() {} }),
    /readPreferences/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({ widgetIds: ['a'], readPreferences() {} }),
    /writePreferences/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({
      widgetIds: ['a'],
      preferenceKeys: { order: 'same', hidden: 'same' },
      ...callbacks
    }),
    /must be unique/
  );
  assert.throws(
    () => createNexaHomeLayoutPreferencesController({
      widgetIds: ['a', 'b'],
      defaultOrderedWidgetIds: ['a'],
      ...callbacks
    }),
    /exactly once/
  );
});

test('default snapshot is deeply frozen, renderer-facing, and ordered-only', () => {
  const { controller } = createHarness();
  const snapshot = controller.getSnapshot();
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.orderedWidgetIds), true);
  assert.equal(Object.isFrozen(snapshot.widgets), true);
  assert.equal(Object.isFrozen(snapshot.widgets[0]), true);
  assert.deepEqual(snapshot, {
    version: 1,
    layoutMode: 'ordered',
    supportsFreeFormLayout: false,
    orderedWidgetIds: widgetIds,
    hiddenWidgetIds: [],
    visibleWidgetIds: widgetIds,
    density: 'comfortable',
    isDefault: true,
    widgets: widgetIds.map((widgetId, index) => ({ widgetId, index, visible: true }))
  });
  assert.equal('slotId' in snapshot, false);
  assert.equal('coordinates' in snapshot, false);
  assert.equal('resizeWidget' in controller, false);
  assert.equal('moveWidgetToSlot' in controller, false);
  assert.throws(() => snapshot.orderedWidgetIds.push('free-form'));
});

test('load accepts canonical preferences without writing a repair', async () => {
  const order = [widgetIds[2], widgetIds[0], widgetIds[1], widgetIds[4], widgetIds[3]];
  const { controller, writes } = createHarness(canonicalPreferences({
    homeModuleOrder: order.join(','),
    hiddenHomeModules: `${widgetIds[0]},${widgetIds[3]}`,
    homeModuleDensity: 'compact'
  }));
  const snapshot = await controller.load();
  assert.deepEqual(snapshot.orderedWidgetIds, order);
  assert.deepEqual(snapshot.hiddenWidgetIds, [widgetIds[0], widgetIds[3]]);
  assert.deepEqual(snapshot.visibleWidgetIds, [widgetIds[2], widgetIds[1], widgetIds[4]]);
  assert.equal(snapshot.density, 'compact');
  assert.equal(snapshot.isDefault, false);
  assert.deepEqual(writes, []);
});

test('load repairs corrupt values with legacy preference normalization', async () => {
  const { controller, writes } = createHarness({
    homeModuleOrder: [widgetIds[2].toUpperCase(), 'unknown', widgetIds[2], widgetIds[0]],
    hiddenHomeModules: [...widgetIds, 'unknown'],
    homeModuleDensity: 'spacious',
    arbitraryCoordinates: { x: 12, y: 4 }
  });
  const snapshot = await controller.load();
  const expectedOrder = [widgetIds[2], widgetIds[0], widgetIds[1], widgetIds[3], widgetIds[4]];
  assert.deepEqual(snapshot.orderedWidgetIds, expectedOrder);
  assert.deepEqual(snapshot.hiddenWidgetIds, []);
  assert.equal(snapshot.density, 'comfortable');
  assert.deepEqual(writes, [{
    homeModuleOrder: expectedOrder.join(','),
    hiddenHomeModules: '',
    homeModuleDensity: 'comfortable'
  }]);
  assert.deepEqual(Object.keys(writes[0]).sort(), [
    'hiddenHomeModules',
    'homeModuleDensity',
    'homeModuleOrder'
  ]);
});

test('load can normalize without repairing and rejects invalid callback results', async () => {
  const { controller, writes } = createHarness({});
  assert.equal((await controller.load({ repair: false })).isDefault, true);
  assert.deepEqual(writes, []);

  const invalid = createNexaHomeLayoutPreferencesController({
    widgetIds,
    readPreferences: async () => null,
    writePreferences: async () => {}
  });
  await assert.rejects(invalid.load(), /must resolve to an object/);
  assert.equal(invalid.getSnapshot().isDefault, true);
  await assert.rejects(controller.load(null), /load options must be an object/);
});

test('hide, show, toggle, and show-all persist canonical visibility', async () => {
  const { controller, writes } = createHarness();
  await controller.load();
  assert.deepEqual((await controller.hideWidget(widgetIds[1])).hiddenWidgetIds, [widgetIds[1]]);
  assert.deepEqual((await controller.toggleWidget(widgetIds[3])).hiddenWidgetIds, [widgetIds[1], widgetIds[3]]);
  assert.deepEqual((await controller.showWidget(widgetIds[1])).hiddenWidgetIds, [widgetIds[3]]);
  assert.deepEqual((await controller.setWidgetVisible(widgetIds[3], true)).hiddenWidgetIds, []);
  assert.deepEqual((await controller.showAllWidgets()).hiddenWidgetIds, []);
  assert.equal(writes.length, 4);
  assert.equal(writes[0].hiddenHomeModules, widgetIds[1]);
  assert.equal(writes[1].hiddenHomeModules, `${widgetIds[1]},${widgetIds[3]}`);
  assert.equal(writes[3].hiddenHomeModules, '');
});

test('visibility validation rejects unknown widgets, non-booleans, and hiding the last widget', async () => {
  const hidden = widgetIds.slice(1).join(',');
  const { controller, writes } = createHarness(canonicalPreferences({ hiddenHomeModules: hidden }));
  await controller.load();
  await assert.rejects(controller.hideWidget(widgetIds[0]), /at least one widget visible/);
  await assert.rejects(controller.toggleWidget(widgetIds[0]), /at least one widget visible/);
  await assert.rejects(controller.showWidget('unknown'), /Unknown/);
  await assert.rejects(controller.setWidgetVisible(widgetIds[0], 'yes'), /boolean/);
  assert.deepEqual(controller.getSnapshot().visibleWidgetIds, [widgetIds[0]]);
  assert.deepEqual(writes, []);
});

test('move and indexed reorder reuse ordered-list behavior and skip boundary no-ops', async () => {
  const { controller, writes } = createHarness();
  await controller.load();
  await controller.moveWidget(widgetIds[0], 'up');
  assert.deepEqual(writes, []);
  assert.deepEqual(
    (await controller.moveWidget(widgetIds[2], 'up')).orderedWidgetIds,
    [widgetIds[0], widgetIds[2], widgetIds[1], widgetIds[3], widgetIds[4]]
  );
  assert.deepEqual(
    (await controller.reorderWidget(widgetIds[4], 1)).orderedWidgetIds,
    [widgetIds[0], widgetIds[4], widgetIds[2], widgetIds[1], widgetIds[3]]
  );
  await assert.rejects(controller.moveWidget(widgetIds[0], 'left'), /direction/);
  await assert.rejects(controller.reorderWidget(widgetIds[0], -1), /targetIndex/);
  await assert.rejects(controller.reorderWidget(widgetIds[0], 1.5), /targetIndex/);
  assert.equal(writes.length, 2);
});

test('setOrderedWidgetIds is a strict drag-sort commit boundary', async () => {
  const { controller, writes } = createHarness();
  await controller.load();
  await assert.rejects(controller.setOrderedWidgetIds(widgetIds.join(',')), /must be an array/);
  await assert.rejects(controller.setOrderedWidgetIds(widgetIds.slice(1)), /exactly once/);
  await assert.rejects(controller.setOrderedWidgetIds([...widgetIds.slice(0, 4), 'unknown']), /exactly once/);
  await assert.rejects(controller.setOrderedWidgetIds([...widgetIds.slice(0, 4), widgetIds[0]]), /exactly once/);
  const reversed = [...widgetIds].reverse();
  assert.deepEqual((await controller.setOrderedWidgetIds(reversed)).orderedWidgetIds, reversed);
  await controller.setOrderedWidgetIds(reversed);
  assert.equal(writes.length, 1);
});

test('density accepts only compact or comfortable and avoids no-op writes', async () => {
  const { controller, writes } = createHarness();
  await controller.load();
  await controller.setDensity('comfortable');
  assert.deepEqual(writes, []);
  assert.equal((await controller.setDensity(' COMPACT ')).density, 'compact');
  await controller.setDensity('compact');
  await assert.rejects(controller.setDensity('dense'), /comfortable.*compact/);
  assert.equal(controller.getSnapshot().density, 'compact');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].homeModuleDensity, 'compact');
});

test('restoreDefaults atomically restores order, visibility, and density', async () => {
  const { controller, writes } = createHarness();
  await controller.load();
  await controller.hideWidget(widgetIds[1]);
  await controller.reorderWidget(widgetIds[4], 0);
  await controller.setDensity('compact');
  const snapshot = await controller.restoreDefaults();
  assert.deepEqual(snapshot.orderedWidgetIds, widgetIds);
  assert.deepEqual(snapshot.hiddenWidgetIds, []);
  assert.equal(snapshot.density, 'comfortable');
  assert.equal(snapshot.isDefault, true);
  assert.deepEqual(writes.at(-1), canonicalPreferences());
  const writeCount = writes.length;
  await controller.restoreDefaults();
  assert.equal(writes.length, writeCount);
});

test('failed writes roll back in-memory state and do not poison later operations', async () => {
  let failNextWrite = true;
  const writes = [];
  const controller = createNexaHomeLayoutPreferencesController({
    widgetIds,
    readPreferences: async () => canonicalPreferences(),
    writePreferences: async (patch) => {
      writes.push({ ...patch });
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error('disk unavailable');
      }
    }
  });
  await controller.load();
  await assert.rejects(controller.hideWidget(widgetIds[1]), /disk unavailable/);
  assert.deepEqual(controller.getSnapshot().hiddenWidgetIds, []);
  assert.deepEqual((await controller.hideWidget(widgetIds[2])).hiddenWidgetIds, [widgetIds[2]]);
  assert.equal(writes.length, 2);
});

test('concurrent mutations serialize so later writes include earlier state', async () => {
  const writes = [];
  const controller = createNexaHomeLayoutPreferencesController({
    widgetIds,
    readPreferences: async () => canonicalPreferences(),
    writePreferences: async (patch) => {
      writes.push({ ...patch });
      await new Promise((resolve) => setImmediate(resolve));
    }
  });
  await controller.load();
  await Promise.all([
    controller.hideWidget(widgetIds[1]),
    controller.setDensity('compact'),
    controller.reorderWidget(widgetIds[4], 0)
  ]);
  assert.equal(writes.length, 3);
  assert.equal(writes[0].hiddenHomeModules, widgetIds[1]);
  assert.equal(writes[1].hiddenHomeModules, widgetIds[1]);
  assert.equal(writes[1].homeModuleDensity, 'compact');
  assert.equal(writes[2].hiddenHomeModules, widgetIds[1]);
  assert.equal(writes[2].homeModuleDensity, 'compact');
  assert.deepEqual(controller.getSnapshot().orderedWidgetIds, [widgetIds[4], ...widgetIds.slice(0, 4)]);
});

test('custom defaults and storage keys remain deterministic and never hide every widget', async () => {
  const customKeys = { order: 'order', hidden: 'hidden', density: 'density' };
  const writes = [];
  const controller = createNexaHomeLayoutPreferencesController({
    widgets: widgetIds.map((widgetId) => ({ widgetId })),
    defaultOrderedWidgetIds: [...widgetIds].reverse(),
    defaultHiddenWidgetIds: [...widgetIds],
    defaultDensity: 'compact',
    preferenceKeys: customKeys,
    readPreferences: async () => ({}),
    writePreferences: async (patch) => writes.push({ ...patch })
  });
  const snapshot = await controller.load();
  assert.deepEqual(snapshot.orderedWidgetIds, [...widgetIds].reverse());
  assert.deepEqual(snapshot.hiddenWidgetIds, []);
  assert.equal(snapshot.density, 'compact');
  assert.equal(snapshot.isDefault, true);
  assert.deepEqual(writes, [{
    order: [...widgetIds].reverse().join(','),
    hidden: '',
    density: 'compact'
  }]);
});

test('read failures preserve the last committed renderer model', async () => {
  let shouldFail = false;
  const controller = createNexaHomeLayoutPreferencesController({
    widgetIds,
    readPreferences: async () => {
      if (shouldFail) throw new Error('read failed');
      return canonicalPreferences({ homeModuleDensity: 'compact' });
    },
    writePreferences: async () => {}
  });
  await controller.load();
  shouldFail = true;
  await assert.rejects(controller.load(), /read failed/);
  assert.equal(controller.getSnapshot().density, 'compact');
});
