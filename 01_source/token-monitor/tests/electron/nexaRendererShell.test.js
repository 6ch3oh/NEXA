'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const integration = fs.readFileSync(path.join(root, 'nexaRendererIntegration.js'), 'utf8');
const calendarHomeWidget = fs.readFileSync(path.join(root, 'nexaCalendarHomeWidgetRenderer.js'), 'utf8');
const consumptionHomeWidget = fs.readFileSync(path.join(root, 'nexaConsumptionHomeWidgetRenderer.js'), 'utf8');
const creatorOpsHomeWidget = fs.readFileSync(path.join(root, 'nexaCreatorOpsHomeWidgetRenderer.js'), 'utf8');
const homeOverviewWidget = fs.readFileSync(path.join(root, 'nexaHomeOverviewRenderer.js'), 'utf8');
const presentationCatalog = fs.readFileSync(path.join(root, '..', '..', 'shared', 'nexaModulePresentationCatalog.js'), 'utf8');
const main = fs.readFileSync(path.join(root, '..', 'main.js'), 'utf8');
const catalog = require(path.join(root, '..', '..', 'shared', 'nexaModulePresentationCatalog.js'));
const { installMoreNavigationInteraction } = require(path.join(root, 'nexaRendererIntegration.js'));

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      target: init.target || this,
      key: init.key,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.open = false;
    this.focused = false;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  contains(target) {
    return target === this || this.children.some((child) => child.contains(target));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.focused = true;
  }

  click() {
    if (this.tagName === 'SUMMARY' && this.parentElement?.tagName === 'DETAILS') {
      this.parentElement.open = !this.parentElement.open;
      this.parentElement.dispatch('toggle');
    }
    this.dispatch('click');
  }
}

test('Renderer loads one shared presentation catalog, host, and integration boundary', () => {
  const catalogIndex = html.indexOf('nexaModulePresentationCatalog.js');
  const compositionIndex = html.indexOf('nexaDesktopComposition.js');
  const adapterIndex = html.indexOf('nexaModulePresentationAdapter.js');
  const hostIndex = html.indexOf('nexaModuleHost.js');
  const widgetHostIndex = html.indexOf('nexaWidgetHost.js');
  const consumptionHomeWidgetIndex = html.indexOf('nexaConsumptionHomeWidgetRenderer.js');
  const calendarHomeWidgetIndex = html.indexOf('nexaCalendarHomeWidgetRenderer.js');
  const creatorOpsHomeWidgetIndex = html.indexOf('nexaCreatorOpsHomeWidgetRenderer.js');
  const automationCenterIndex = html.indexOf('nexaAutomationCenterRenderer.js');
  const appIndex = html.indexOf('app.js');
  const integrationIndex = html.indexOf('nexaRendererIntegration.js');
  assert.ok(catalogIndex > 0 && catalogIndex < compositionIndex);
  assert.ok(compositionIndex < adapterIndex && adapterIndex < hostIndex);
  assert.ok(hostIndex < widgetHostIndex);
  assert.ok(widgetHostIndex < consumptionHomeWidgetIndex && consumptionHomeWidgetIndex < integrationIndex);
  assert.ok(widgetHostIndex < calendarHomeWidgetIndex && calendarHomeWidgetIndex < integrationIndex);
  assert.ok(widgetHostIndex < creatorOpsHomeWidgetIndex && creatorOpsHomeWidgetIndex < integrationIndex);
  assert.ok(hostIndex < automationCenterIndex && automationCenterIndex < integrationIndex);
  assert.ok(hostIndex < appIndex && appIndex < integrationIndex);
  assert.equal((html.match(/id="nexaTopNavigation"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaModuleSurface"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaHomeCompositionSurface"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaHomeModuleGrid"/g) || []).length, 1);
  for (const id of ['Today', 'Data', 'Activity', 'Status']) {
    assert.equal((html.match(new RegExp(`id="nexaHomeWidget${id}"`, 'g')) || []).length, 1);
  }
  assert.equal((html.match(/id="nexaWorkspace"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaHomeRecovery"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaDashiSurface"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaConsumptionSurface"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaAutomationCenterSurface"/g) || []).length, 1);
  assert.equal((html.match(/nexaAutomationCenterRenderer\.js/g) || []).length, 1);
  assert.equal((html.match(/id="nexaCreatorOpsSurface"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaMarketSurface"/g) || []).length, 1);
  assert.equal((html.match(/nexaMarketRenderer\.js/g) || []).length, 1);
  assert.equal((html.match(/id="nexaStarBenchSurface"/g) || []).length, 1);
  assert.equal((html.match(/nexaStarBenchRenderer\.js/g) || []).length, 1);
  assert.equal((html.match(/id="nexaRightDrawer"/g) || []).length, 1);
  assert.equal((html.match(/id="nexaModuleSettings"/g) || []).length, 1);
});

test('cold-start Settings content is visibility-hidden until the Settings route opens', () => {
  assert.match(html, /id="settingsPanel" class="settings-panel hidden"/);
  assert.match(css, /\.settings-panel\s*\{[^}]*visibility:\s*visible;/s);
  assert.match(css, /\.settings-panel\.hidden\s*\{[^}]*visibility:\s*hidden;/s);
});

test('Settings hides every legacy Token Monitor surface behind the NEXA page', () => {
  assert.match(css, /\.shell:is\(\.nexa-module-route, \.settings-open\) #legacyTotalPanel,/);
  assert.match(css, /\.shell:is\(\.nexa-module-route, \.settings-open\) \.footer\s*\{\s*display:\s*none !important;/);
  assert.match(css, /\.settings-context-rail\s*\{[\s\S]*?min-height:\s*46px/);
  assert.match(css, /\.settings-context-rail button\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.match(css, /\.nexa-module-batch-actions button\s*\{[\s\S]*?border-radius:\s*10px[\s\S]*?background:\s*var\(--surface-raised\)/);
});

test('visible multiplication-sign close controls have Chinese accessible names', () => {
  for (const id of ['closeButton', 'nexaRightDrawerClose', 'appUpdatePillDismiss', 'appUpdatePopoverClose']) {
    assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*aria-label="[一-鿿]+[^"]*"[^>]*>×<\\/button>`));
  }
  const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  assert.match(dashboard, /id="closeBtn"[^>]*aria-label="关闭窗口"[^>]*>×<\/button>/);
});

test('settings status follows the latest renderer presentation state', () => {
  assert.match(integration, /const rendererState = rendererPresentationStates\.get\(module\.moduleId\)/);
  assert.match(integration, /if \(rendererState\) return projectedStatus\(rendererState\)/);
  assert.match(integration, /rendererPresentationStates\.set\(moduleId, state\);[\s\S]*?renderSettings\(host\.getSnapshot\(\)\)/);
});

test('authoritative shell geometry and overflow protections are explicit', () => {
  assert.match(css, /\.nexa-top-navigation\s*\{[\s\S]*?overflow-x:\s*clip;[\s\S]*?overflow-y:\s*visible/);
  assert.match(css, /\.nexa-top-navigation button\s*\{[\s\S]*?flex:\s*1 1 0/);
  assert.match(css, /\.nexa-context-bar\s*\{[\s\S]*?flex:\s*0 0 56px/);
  assert.match(css, /\.nexa-context-bar strong\s*\{[\s\S]*?min-width:\s*2\.5em;[\s\S]*?max-width:\s*40%/);
  assert.match(css, /\.titlebar\s*\{[\s\S]*?min-height:\s*40px/);
  assert.match(css, /calc\(\(100vw - 1180px\) \/ 2\)/);
  assert.match(css, /\.shell\.nexa-module-route \.nexa-workspace\s*\{[\s\S]*?overflow:\s*hidden auto/);
  for (const selector of ['nexa-consumption-surface', 'nexa-today-tomorrow-surface', 'nexa-dashi-surface', 'nexa-device-surface', 'nexa-creator-ops-surface']) {
    assert.match(css, new RegExp(`\\.${selector}\\s*\\{[\\s\\S]*?overflow:\\s*visible`));
  }
  assert.match(main, /maxWidth:\s*1600/);
});

test('fixed L1 keeps Home and Settings visible while More is only below the supported width', () => {
  assert.match(integration, /catalog\.listPrimaryRoutes\(\)/);
  assert.match(integration, /max-width:\s*1100px/);
  assert.match(integration, /max-width:\s*1023px/);
  assert.match(integration, /summary\.textContent = '更多'/);
  assert.match(integration, /installMoreNavigationInteraction\(\{ navigation, more, summary \}\)/);
  assert.match(integration, /directRouteIds = new Set\(\['home', 'settings', snapshot\.activeRoute\]\)/);
  assert.match(integration, /button\.closest\?\.\('details'\)\?\.removeAttribute\('open'\);[\s\S]*?navigate\(route\.id\)/);
  assert.doesNotMatch(integration, /button\.classList\.toggle\('hidden', Boolean\(route\.moduleId/);
});

test('narrow More fallback opens, exposes every hidden Wave 001 route, navigates, and closes', () => {
  const ownerDocument = new FakeEventTarget();
  const navigation = new FakeElement('nav', ownerDocument);
  const more = new FakeElement('details', ownerDocument);
  const summary = new FakeElement('summary', ownerDocument);
  const menu = new FakeElement('div', ownerDocument);
  const home = new FakeElement('button', ownerDocument);
  const routes = catalog.listPrimaryRoutes();
  const navigatedRoutes = [];

  assert.deepEqual(routes.map((route) => route.id), [
    'home', 'cost', 'calendar', 'automation-center', 'study-center', 'device-center', 'market', 'creator-ops', 'dashi', 'starbench', 'settings'
  ]);

  home.setAttribute('data-nexa-route', 'home');
  home.addEventListener('click', () => navigatedRoutes.push('home'));
  navigation.append(home);
  const settings = new FakeElement('button', ownerDocument);
  settings.setAttribute('data-nexa-route', 'settings');
  settings.addEventListener('click', () => navigatedRoutes.push('settings'));
  navigation.append(settings);
  for (const route of routes.filter((entry) => !['home', 'settings'].includes(entry.id))) {
    const button = new FakeElement('button', ownerDocument);
    button.setAttribute('data-nexa-route', route.id);
    button.addEventListener('click', () => {
      more.open = false;
      more.dispatch('toggle');
      navigatedRoutes.push(route.id);
    });
    menu.append(button);
  }
  more.append(summary, menu);
  navigation.append(more);

  const interaction = installMoreNavigationInteraction({ navigation, more, summary, ownerDocument });
  assert.equal(summary.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.children.length, 9);

  for (const button of menu.children) {
    summary.click();
    assert.equal(more.open, true);
    assert.equal(summary.getAttribute('aria-expanded'), 'true');
    button.click();
    assert.equal(more.open, false);
    assert.equal(summary.getAttribute('aria-expanded'), 'false');
  }
  assert.deepEqual(navigatedRoutes, routes.filter((route) => !['home', 'settings'].includes(route.id)).map((route) => route.id));

  settings.click();
  assert.equal(navigatedRoutes.at(-1), 'settings', 'Settings remains directly reachable without opening More');

  home.click();
  assert.equal(navigatedRoutes.at(-1), 'home', 'Home remains directly reachable after More navigation');

  summary.click();
  ownerDocument.dispatch('pointerdown', { target: new FakeElement('main', ownerDocument) });
  assert.equal(more.open, false, 'More reopens after returning Home and outside pointer closes the panel');

  summary.click();
  summary.click();
  assert.equal(more.open, false, 'clicking More again closes the panel');

  summary.click();
  const escape = navigation.dispatch('keydown', { key: 'Escape' });
  assert.equal(more.open, false);
  assert.equal(summary.focused, true);
  assert.equal(escape.defaultPrevented, true);
  interaction.dispose();
});

test('route integration isolates the composed Home from the full Calendar surface', () => {
  for (const id of [
    'nexaModuleSurface',
    'nexaHomeCompositionSurface',
    'nexaConsumptionSurface',
    'nexaAutomationCenterSurface',
    'nexaDashiSurface',
    'nexaDeviceCenterSurface',
    'nexaCreatorOpsSurface',
    'nexaMarketSurface',
    'nexaStarBenchSurface'
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*class="[^"]*nexa-primary-surface[^"]*"[^>]*hidden[^>]*aria-hidden="true"`));
  }
  assert.doesNotMatch(html, /id="nexaTodayTomorrowSurface"[^>]*nexa-primary-surface/);
  assert.match(css, /\.nexa-primary-surface\.hidden,[\s\S]*?\.nexa-primary-surface\[hidden\][\s\S]*?display:\s*none\s*!important/);
  assert.match(integration, /createPrimarySurfaceController\(\[[\s\S]*?homeCompositionSurface[\s\S]*?marketSurface[\s\S]*?\]\)/);
  assert.match(integration, /createExclusivePresentationController\(contextBar, \[[\s\S]*?dayNavigation[\s\S]*?marketNavigation[\s\S]*?\]\)/);
  assert.match(integration, /primarySurfaceController\.showOnly\(activePrimarySurface\)/);
  assert.match(integration, /secondaryNavigationController\.showOnly\(activeSecondaryNavigation\)/);
  assert.match(integration, /transitionActiveUiModule\(nextUiModuleId\)/);
  assert.match(integration, /setSurfaceVisibility\(daySurface, todayRoute\)/);
  assert.match(integration, /const homeRoute = snapshot\.activeRoute === 'home'/);
  assert.match(integration, /const todayRoute = snapshot\.activeRoute === 'calendar'/);
  assert.match(integration, /shell\.classList\.toggle\('nexa-home-route', homeRoute\)/);
  assert.match(integration, /if \(workspace\) workspace\.scrollTop = 0/);
});

test('Core Renderer host uses only the formal NEXA control API and generic surfaces', () => {
  for (const member of [
    'getSnapshot', 'setEnabled', 'setAutoStart', 'setAllEnabled', 'setAllAutoStart'
  ]) assert.match(integration, new RegExp(`api\\.control\\.${member}`));
  assert.doesNotMatch(integration, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|setInterval|require\s*\(/);
  assert.doesNotMatch(integration, /expense-records|normalizeDeviceRecord|createExpense|repository/i);
  assert.match(integration, /NexaConsumptionRenderer\?\.createRenderer/);
  assert.match(integration, /api\['legacy-device'\]\.getSnapshot\(\)/);
  assert.match(integration, /NexaDashiRenderer\?\.createRenderer/);
  assert.match(integration, /NexaDeviceCenterUiIntegrationHost\?\.createRenderer/);
  assert.match(integration, /NexaCreatorOpsUiIntegrationHost\?\.createRenderer/);
  assert.match(integration, /NexaMarketRenderer\?\.createRenderer/);
  assert.match(integration, /NexaStarBenchRenderer\?\.createRenderer/);
  assert.match(integration, /NexaAutomationCenterRenderer\?\.createRenderer/);
  assert.match(integration, /createRendererSafely/);
  assert.match(integration, /runRendererLifecycle/);
  assert.match(integration, /catalog\.listAssemblyModules/);
  assert.doesNotMatch(integration, /NexaDeviceCenterRenderer\?\.createRenderer/);
  assert.match(integration, /compactNavigation\.addEventListener\('change', render\)/);
  assert.doesNotMatch(integration, /api\.dashi\.(?:create|update|delete|run|retry|accept|reject)/);
});

test('Settings is always navigable and disabled module routes fail into recovery', () => {
  assert.match(integration, /function openSettings\(\)/);
  assert.match(integration, /result\.code === 'MODULE_DISABLED'/);
  assert.match(integration, /openSettings\(\)/);
  assert.match(integration, /button\.dataset\.moduleState = module\?\.enabled === false \? 'disabled' : 'available'/);
});

test('Home composes only registered widgets through four Core-owned slots and excludes Dashi', () => {
  assert.match(css, /\.nexa-home-widget-layout\s*\{/);
  assert.match(css, /\.nexa-home-widget-container\s*\{/);
  for (const slot of ['today', 'data', 'activity', 'status']) {
    assert.match(html, new RegExp(`data-nexa-widget-container="${slot}"`));
  }
  assert.match(integration, /presentationAdapter\.adaptAll/);
  assert.doesNotMatch(presentationCatalog, /moduleId: 'dashi', descriptions:/);
  assert.match(integration, /stateFor:\s*homeModuleState/);
  assert.match(integration, /widgetHost\.register/);
  assert.match(integration, /NexaConsumptionHomeWidgetRenderer\.createRenderer/);
  assert.match(integration, /consumptionHomeWidgetRenderer\.getElement\(\)/);
  assert.match(integration, /consumptionHomeWidgetRenderer, 'activate'/);
  assert.match(integration, /consumptionHomeWidgetRenderer, 'deactivate'/);
  assert.match(integration, /consumptionHomeWidgetRenderer\?\.dispose\(\)/);
  assert.match(consumptionHomeWidget, /api\.getHomeSummary/);
  for (const field of ['month_expense_cents', 'today_expense_cents', 'category_distribution', 'recent_transactions', 'freshness']) {
    assert.match(consumptionHomeWidget, new RegExp(`summary\\.${field}`));
  }
  assert.match(consumptionHomeWidget, /消费摘要暂不可用/);
  assert.doesNotMatch(consumptionHomeWidget, /api\.execute|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.match(integration, /NexaCalendarHomeWidgetRenderer\.createRenderer/);
  assert.match(integration, /calendarHomeWidgetRenderer\.getElement\(\)/);
  assert.match(integration, /calendarHomeWidgetRenderer\?\.load\(\)/);
  assert.match(integration, /await Promise\.allSettled\(loads\)/);
  assert.match(calendarHomeWidget, /api\.getDateSummary/);
  assert.match(calendarHomeWidget, /api\.getMonthSummary/);
  assert.match(calendarHomeWidget, /onOpenGlobalCommand/);
  assert.doesNotMatch(calendarHomeWidget, /api\.parseHomeInput|api\.proposeLocalAi/);
  for (const field of ['date', 'events', 'next_event', 'todo_count']) {
    assert.match(calendarHomeWidget, new RegExp(`summary\\.${field}`));
  }
  assert.match(calendarHomeWidget, /summary\.tasks/);
  assert.match(calendarHomeWidget, /在全局命令栏中安排/);
  assert.match(calendarHomeWidget, /api\.execute\(\{\s*type:\s*'create-day-task'/s);
  assert.match(calendarHomeWidget, /api\.execute\(\{\s*type:\s*'complete-task'/s);
  assert.doesNotMatch(calendarHomeWidget, /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.match(integration, /NexaCreatorOpsHomeWidgetRenderer\.createRenderer/);
  assert.match(integration, /creatorOpsHomeWidgetRenderer\.getElement\(\)/);
  assert.match(integration, /creatorOpsHomeWidgetRenderer, 'activate'/);
  assert.match(integration, /creatorOpsHomeWidgetRenderer, 'deactivate'/);
  assert.match(integration, /creatorOpsHomeWidgetRenderer\?\.dispose\(\)/);
  assert.match(creatorOpsHomeWidget, /api\.getHomeSummary/);
  for (const field of ['account_matrix', 'performance', 'recent_activity', 'freshness', 'selected_window']) {
    assert.match(creatorOpsHomeWidget, new RegExp(`summary\\.${field}`));
  }
  assert.match(creatorOpsHomeWidget, /value\.time_window/);
  assert.match(creatorOpsHomeWidget, /自媒体动态摘要暂不可用/);
  assert.doesNotMatch(creatorOpsHomeWidget, /api\.(?:start|stop|open)|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.match(integration, /!widget\.enabled/);
  assert.match(integration, /'打开 \/ 重试'/);
  assert.match(integration, /\['home', 'calendar'\]\.includes\(routeId\).*todayTomorrowRenderer/s);
  assert.ok(html.indexOf('id="nexaTodayTomorrowSurface"') < html.indexOf('id="nexaHomeCompositionSurface"'));
  assert.match(html, />星枢首页</);
  assert.match(html, /nexaHomeOverviewRenderer\.js/);
  assert.match(integration, /NexaHomeOverviewRenderer\.createRenderer/);
  assert.match(integration, /homeOverviewRenderer, 'activate'/);
  assert.match(integration, /homeOverviewRenderer, 'deactivate'/);
  assert.match(integration, /homeOverviewRenderer\?\.dispose\(\)/);
  assert.match(homeOverviewWidget, /statsApi\.getStats/);
  assert.match(integration, /widgetHost\.setStatus\('core:ai-usage'/);
  assert.match(integration, /widgetHost\.setStatus\('core:device-network'/);
  assert.match(integration, /studyApi:\s*api\['study-center'\]/);
  assert.match(homeOverviewWidget, /studyApi\?\.getHomeSummary/);
  assert.match(homeOverviewWidget, /学习摘要暂不可用/);
  assert.match(homeOverviewWidget, /deviceApi\?\.getHomeSummary/);
  assert.match(homeOverviewWidget, /summary\.network\.domestic/);
  assert.match(homeOverviewWidget, /module\?\.moduleId !== 'dashi'/);
  assert.doesNotMatch(homeOverviewWidget, /模拟|示例账号|示例设备/);
  assert.match(integration, /nexa-home-recovery-item/);
  assert.doesNotMatch(integration, /fetch\s*\(|repository|sqlite|portfolio.*calculate/i);
});

test('Core-owned visible copy is UTF-8 Chinese-first and contains no known mojibake markers', () => {
  const sources = [html, css, integration, presentationCatalog];
  for (const source of sources) assert.doesNotMatch(source, /�|Ã|â(?:€|™)|ï¿½/);
  for (const copy of ['首页', '消费中心', '日历管家', '设备与网络', '股票市场', '自媒体运营']) {
    assert.match([html, integration, presentationCatalog].join('\n'), new RegExp(copy));
  }
  for (const copy of ['今日', '本月', '累计', '全部启用', '全部停用', '自动启动']) assert.match(html, new RegExp(copy));
  assert.match(integration, /MODULE_INACTIVE'\) return '尚未启动'/);
  assert.match(integration, /surfaceState\.textContent = route\?\.moduleId[\s\S]*?projectedStatus/);
  assert.doesNotMatch(integration, /detail\.textContent = rendererFailures\.get/);
});
