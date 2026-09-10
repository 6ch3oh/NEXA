'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../../src/shared/nexaModulePresentationCatalog');
const {
  createExclusivePresentationController,
  createNexaModuleHost,
  createPrimarySurfaceController,
  setSurfaceVisibility
} = require('../../src/electron/renderer/nexaModuleHost');

class FakeSurface {
  constructor(id) {
    this.id = id;
    this.hidden = true;
    this.inert = true;
    this.attributes = new Map([['aria-hidden', 'true']]);
    this.classes = new Set(['hidden']);
    this.classList = {
      contains: (name) => this.classes.has(name),
      toggle: (name, force) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      }
    };
    this.parentNode = null;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
}

class FakePresentationHost {
  constructor() { this.children = []; }
  append(child) {
    child.remove?.();
    this.children.push(child);
    child.parentNode = this;
  }
}

function isVisible(surface) {
  return surface.hidden === false &&
    surface.classList.contains('hidden') === false &&
    surface.getAttribute('aria-hidden') === 'false' &&
    surface.inert === false;
}

function controlSnapshot(consumptionEnabled = true) {
  return {
    version: 1,
    modules: [
      { moduleId: 'automation-center', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'LIMITED' } },
      { moduleId: 'consumption', enabled: consumptionEnabled, autoStart: false, runtimeStatus: 'inactive', readiness: { state: 'OFFLINE' } },
      { moduleId: 'today-tomorrow', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'READY' } },
      { moduleId: 'dashi', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'READY' } },
      { moduleId: 'device-center', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'READY' } },
      { moduleId: 'market', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'READY' } },
      { moduleId: 'creator-ops', enabled: true, autoStart: false, runtimeStatus: 'running', readiness: { state: 'READY' } },
      { moduleId: 'legacy-device', enabled: true, autoStart: false, runtimeStatus: 'inactive' }
    ]
  };
}

test('models loading, ready, empty, disabled, and error without business state', () => {
  const host = createNexaModuleHost({ catalog });
  assert.equal(host.getSnapshot().status, 'ready');
  assert.equal(host.routeState('cost'), 'loading');
  assert.equal(host.routeState('resources'), 'empty');
  host.updateControlSnapshot(controlSnapshot());
  assert.equal(host.routeState('home'), 'ready');
  assert.equal(host.routeState('cost'), 'ready');
  assert.equal(host.routeState('automation-center'), 'ready');
  assert.equal(host.routeState('dashi'), 'ready');
  assert.equal(host.routeState('device-center'), 'ready');
  assert.equal(host.routeState('unknown'), 'error');
  host.updateControlSnapshot(null);
  assert.equal(host.routeState('cost'), 'error');
});

test('preserves bounded readiness in host snapshots without module domain data', () => {
  const host = createNexaModuleHost({ catalog });
  const value = controlSnapshot();
  value.modules[0].readiness = { state: 'LIMITED', code: 'MODULE_STARTING', secret: 'discarded' };
  host.updateControlSnapshot(value);
  assert.deepEqual(host.getSnapshot().modules[0].readiness, {
    state: 'LIMITED', code: 'MODULE_STARTING'
  });
});

test('disabled business routes fail closed and Settings remains recoverable', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot(false));
  assert.deepEqual(host.navigate('cost'), { ok: false, code: 'MODULE_DISABLED', moduleId: 'consumption' });
  assert.equal(host.navigate('settings').ok, true);
  assert.equal(host.getSnapshot().activeRoute, 'settings');
});

test('disabling the active module returns the host to Settings', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot(true));
  assert.equal(host.navigate('cost').ok, true);
  host.updateControlSnapshot(controlSnapshot(false));
  assert.equal(host.getSnapshot().activeRoute, 'settings');
});

test('snapshots are defensive and carry no module domain payload', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot());
  const snapshot = host.getSnapshot();
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.modules), true);
  assert.equal(Object.hasOwn(snapshot, 'records'), false);
  assert.equal(Object.hasOwn(snapshot, 'devices'), false);
});

test('projects readiness and renderer failures per module without blocking Home or sibling navigation', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot());
  assert.equal(host.moduleState('today-tomorrow'), 'READY');
  assert.equal(host.moduleState('consumption'), 'OFFLINE');
  assert.equal(host.moduleState('market', 'ERROR'), 'ERROR');
  assert.equal(host.moduleState('device-center', 'UNAVAILABLE'), 'UNAVAILABLE');
  assert.equal(host.moduleState('creator-ops', 'OFFLINE'), 'OFFLINE');
  assert.equal(host.moduleState('missing'), 'UNAVAILABLE');

  for (const failedModuleId of ['consumption', 'device-center', 'market', 'creator-ops']) {
    const failure = failedModuleId === 'device-center' ? 'UNAVAILABLE' : 'ERROR';
    assert.equal(host.moduleState(failedModuleId, failure), failure);
    assert.equal(host.navigate('home').ok, true);
    assert.equal(host.navigate(failedModuleId === 'market' ? 'dashi' : 'market').ok, true);
  }
});

test('isolates real primary surface visibility across Home, Market, Dashi, Device, Consumption, and Creator Ops routes', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot());
  const surfaces = {
    home: new FakeSurface('home'),
    cost: new FakeSurface('consumption'),
    'automation-center': new FakeSurface('automation-center'),
    dashi: new FakeSurface('dashi'),
    'device-center': new FakeSurface('device-center'),
    market: new FakeSurface('market'),
    'creator-ops': new FakeSurface('creator-ops')
  };
  const primary = createPrimarySurfaceController(Object.values(surfaces));

  function present(routeId) {
    assert.equal(host.navigate(routeId).ok, true);
    assert.equal(primary.showOnly(surfaces[routeId]), 1);
    const visible = Object.values(surfaces).filter(isVisible);
    assert.equal(visible.length, 1);
    assert.equal(visible[0], surfaces[routeId]);
  }

  for (const routeId of ['home', 'market', 'home']) present(routeId);
  assert.equal(isVisible(surfaces.home), true);
  assert.equal(isVisible(surfaces.market), false);

  for (const routeId of ['home', 'market', 'dashi', 'device-center', 'home']) present(routeId);
  for (const routeId of ['cost', 'automation-center', 'creator-ops', 'home']) present(routeId);
});

test('keeps Today/Tomorrow visible only as Home L2 without counting it as a primary surface', () => {
  const host = createNexaModuleHost({ catalog });
  host.updateControlSnapshot(controlSnapshot());
  const home = new FakeSurface('home');
  const market = new FakeSurface('market');
  const todayTomorrow = new FakeSurface('today-tomorrow-l2');
  const primary = createPrimarySurfaceController([home, market]);

  function present(routeId) {
    assert.equal(host.navigate(routeId).ok, true);
    primary.showOnly(routeId === 'home' ? home : market);
    setSurfaceVisibility(todayTomorrow, routeId === 'home');
    assert.equal([home, market].filter(isVisible).length, 1);
  }

  present('home');
  assert.equal(isVisible(todayTomorrow), true);
  present('market');
  assert.equal(isVisible(todayTomorrow), false);
  present('home');
  assert.equal(isVisible(todayTomorrow), true);
});

test('moves exclusive module navigation ownership through one Host slot without stale or duplicate DOM', () => {
  const slot = new FakePresentationHost();
  const calendar = new FakeSurface('calendar');
  const consumption = new FakeSurface('consumption');
  const market = new FakeSurface('market');
  const device = new FakeSurface('device');
  const controller = createExclusivePresentationController(slot, [calendar, consumption, market, device]);

  for (const active of [market, device, market, device, consumption, device, calendar, device, market, device]) {
    assert.equal(controller.showOnly(active), 1);
    assert.deepEqual(slot.children, [active]);
    assert.equal(active.parentNode, slot);
    assert.equal(isVisible(active), true);
    for (const inactive of [calendar, consumption, market, device].filter((value) => value !== active)) {
      assert.equal(inactive.parentNode, null);
      assert.equal(isVisible(inactive), false);
    }
  }
  assert.equal(controller.showOnly(null), 0);
  assert.deepEqual(slot.children, []);
});
