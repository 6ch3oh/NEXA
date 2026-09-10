'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const catalog = require('../../src/shared/nexaModulePresentationCatalog');

test('exposes the authoritative V0.1 route order and explicit module mappings', () => {
  assert.deepEqual(catalog.listRoutes().map(({ id }) => id), [
    'home', 'cost', 'calendar', 'automation-center', 'study-center', 'device-center', 'market', 'creator-ops', 'dashi',
    'resources', 'starbench', 'settings'
  ]);
  assert.deepEqual(catalog.listPrimaryRoutes().map(({ id }) => id), [
    'home', 'cost', 'calendar', 'automation-center', 'study-center', 'device-center', 'market', 'creator-ops', 'dashi', 'starbench', 'settings'
  ]);
  assert.equal(catalog.getRoute('settings').shortLabel, '设置');
  assert.equal(catalog.getRoute('settings').accessibleName, '移动设备配对设置');
  assert.equal(catalog.getRoute('dashi').moduleId, 'dashi');
  assert.equal(catalog.getRoute('dashi').shortLabel, 'Dashi');
  assert.equal(catalog.getRoute('dashi').accessibleName, 'Dashi任务板');
  assert.equal(catalog.getModuleMetadata('dashi').routeId, 'dashi');
  assert.equal(catalog.getRoute('creator-ops').moduleId, 'creator-ops');
  assert.equal(catalog.getModuleMetadata('creator-ops').routeId, 'creator-ops');
  assert.equal(catalog.getRoute('market').moduleId, 'market');
  assert.equal(catalog.getModuleMetadata('market').routeId, 'market');
  assert.equal(catalog.getRoute('starbench').moduleId, 'starbench');
  assert.equal(catalog.getModuleMetadata('starbench').routeId, 'starbench');
  assert.equal(catalog.getRoute('cost').moduleId, 'consumption');
  assert.equal(catalog.getRoute('calendar').moduleId, 'today-tomorrow');
  assert.equal(catalog.getModuleMetadata('today-tomorrow').routeId, 'calendar');
  assert.equal(catalog.getRoute('study-center').moduleId, 'study-center');
  assert.equal(catalog.getModuleMetadata('study-center').routeId, 'study-center');
  assert.equal(catalog.getRoute('automation-center').moduleId, 'automation-center');
  assert.equal(catalog.getModuleMetadata('automation-center').routeId, 'automation-center');
  assert.equal(catalog.getModuleMetadata('legacy-device').routeId, null);
  assert.equal(catalog.getModuleMetadata('unknown'), undefined);
});

test('labels are deterministic for every supported renderer locale', () => {
  assert.equal(catalog.routeLabel('settings', 'zh-CN'), '设置');
  assert.equal(catalog.routeLabel('settings', 'zh-TW'), '設定');
  assert.equal(catalog.routeLabel('home', 'ja'), 'ホーム');
  assert.equal(catalog.moduleLabel('consumption', 'ko'), '소비 센터');
  assert.equal(catalog.routeLabel('home', 'unknown'), 'Home');
  assert.equal(catalog.routeLabel('dashi', 'en'), 'Dashi Task Board');
  assert.deepEqual(catalog.listPrimaryRoutes().map(({ shortLabel }) => shortLabel), [
    '首页', '消费', '日历', '自动化', '学习', '设备', '市场', '创作', 'Dashi', '星测', '设置'
  ]);
  assert.deepEqual(catalog.listPrimaryRoutes().map(({ accessibleName }) => accessibleName), [
    '首页', '消费中心', '日历管家', '自动化中心', '学习中心', '设备与网络', '股票市场', '自媒体运营', 'Dashi任务板', '星测', '移动设备配对设置'
  ]);
});

test('Home composition excludes route-only Dashi and exposes no private domain data', () => {
  const modules = catalog.listAssemblyModules('zh-CN');
  assert.deepEqual(modules.map(({ moduleId }) => moduleId), [
    'consumption', 'today-tomorrow', 'study-center', 'device-center', 'market', 'creator-ops'
  ]);
  assert.deepEqual(modules.map(({ routeId }) => routeId), [
    'cost', 'calendar', 'study-center', 'device-center', 'market', 'creator-ops'
  ]);
  assert.deepEqual(modules.map(({ label }) => label), [
    '消费中心', '日历管家', '学习中心', '设备与网络', '股票市场', '自媒体运营'
  ]);
  assert.equal(modules.some(({ moduleId }) => moduleId === 'dashi'), false);
  assert.equal(modules.some(({ moduleId }) => moduleId === 'starbench'), false);
  for (const module of modules) {
    assert.equal(typeof module.description, 'string');
    assert.equal(Object.hasOwn(module, 'data'), false);
    assert.equal(Object.hasOwn(module, 'snapshot'), false);
  }
});
