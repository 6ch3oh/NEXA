'use strict';

(function exposeNexaPresentationCatalog(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaModulePresentationCatalog = api;
})(typeof window !== 'undefined' ? window : null, function createNexaPresentationCatalogApi() {
  const routes = Object.freeze([
    Object.freeze({
      id: 'home', moduleId: null, shortLabel: '首页', accessibleName: '首页',
      labels: Object.freeze({ en: 'Home', 'zh-CN': '首页', 'zh-TW': '首頁', ko: '홈', ja: 'ホーム' })
    }),
    Object.freeze({
      id: 'cost', moduleId: 'consumption', shortLabel: '消费', accessibleName: '消费中心',
      labels: Object.freeze({ en: 'Consumption', 'zh-CN': '消费中心', 'zh-TW': '消費中心', ko: '소비 센터', ja: '消費センター' })
    }),
    Object.freeze({
      id: 'calendar', moduleId: 'today-tomorrow', shortLabel: '日历', accessibleName: '日历管家',
      labels: Object.freeze({ en: 'Calendar', 'zh-CN': '日历管家', 'zh-TW': '日曆管家', ko: '캘린더', ja: 'カレンダー' })
    }),
    Object.freeze({
      id: 'automation-center', moduleId: 'automation-center', shortLabel: '自动化', accessibleName: '自动化中心',
      labels: Object.freeze({ en: 'Automation Center', 'zh-CN': '自动化中心', 'zh-TW': '自動化中心', ko: '자동화 센터', ja: '自動化センター' })
    }),
    Object.freeze({
      id: 'study-center', moduleId: 'study-center', shortLabel: '学习', accessibleName: '学习中心',
      labels: Object.freeze({ en: 'Study Center', 'zh-CN': '学习中心', 'zh-TW': '學習中心', ko: '학습 센터', ja: '学習センター' })
    }),
    Object.freeze({
      id: 'device-center', moduleId: 'device-center', shortLabel: '设备', accessibleName: '设备与网络',
      labels: Object.freeze({ en: 'Device Center', 'zh-CN': '设备与网络', 'zh-TW': '裝置與網路', ko: '디바이스 및 네트워크', ja: 'デバイスとネットワーク' })
    }),
    Object.freeze({
      id: 'market', moduleId: 'market', shortLabel: '市场', accessibleName: '股票市场',
      labels: Object.freeze({ en: 'Market', 'zh-CN': '股票市场', 'zh-TW': '股票市場', ko: '주식 시장', ja: '株式市場' })
    }),
    Object.freeze({
      id: 'creator-ops', moduleId: 'creator-ops', shortLabel: '创作', accessibleName: '自媒体运营',
      labels: Object.freeze({ en: 'Creator Ops', 'zh-CN': '自媒体运营', 'zh-TW': '自媒體營運', ko: '크리에이터 운영', ja: 'クリエイター運用' })
    }),
    Object.freeze({
      id: 'dashi', moduleId: 'dashi', shortLabel: 'Dashi', accessibleName: 'Dashi任务板',
      labels: Object.freeze({ en: 'Dashi Task Board', 'zh-CN': 'Dashi任务板', 'zh-TW': 'Dashi任務板', ko: 'Dashi 작업 보드', ja: 'Dashi タスクボード' })
    }),
    Object.freeze({ id: 'resources', moduleId: null, labels: Object.freeze({ en: 'Resources', 'zh-CN': '资源', 'zh-TW': '資源', ko: '리소스', ja: 'リソース' }) }),
    Object.freeze({
      id: 'starbench', moduleId: 'starbench', shortLabel: '星测', accessibleName: '星测',
      labels: Object.freeze({ en: 'StarBench', 'zh-CN': '星测', 'zh-TW': '星測', ko: 'StarBench', ja: 'StarBench' })
    }),
    Object.freeze({
      id: 'settings', moduleId: null, shortLabel: '设置', accessibleName: '移动设备配对设置',
      labels: Object.freeze({ en: 'Settings', 'zh-CN': '设置', 'zh-TW': '設定', ko: '설정', ja: '設定' })
    })
  ]);
  const primaryRouteIds = Object.freeze([
    'home', 'cost', 'calendar', 'automation-center', 'study-center', 'device-center', 'market', 'creator-ops', 'dashi', 'starbench', 'settings'
  ]);
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const moduleMetadata = Object.freeze({
    consumption: Object.freeze({
      moduleId: 'consumption', routeId: 'cost', labels: Object.freeze({ en: 'Consumption', 'zh-CN': '消费中心', 'zh-TW': '消費中心', ko: '소비 센터', ja: '消費センター' })
    }),
    dashi: Object.freeze({
      moduleId: 'dashi', routeId: 'dashi', labels: Object.freeze({ en: 'Dashi Task Board', 'zh-CN': 'Dashi任务板', 'zh-TW': 'Dashi任務板', ko: 'Dashi 작업 보드', ja: 'Dashi タスクボード' })
    }),
    'device-center': Object.freeze({
      moduleId: 'device-center', routeId: 'device-center', labels: Object.freeze({ en: 'Device Center', 'zh-CN': '设备与网络', 'zh-TW': '裝置與網路', ko: '디바이스 및 네트워크', ja: 'デバイスとネットワーク' })
    }),
    'creator-ops': Object.freeze({
      moduleId: 'creator-ops', routeId: 'creator-ops', labels: Object.freeze({ en: 'Creator Ops', 'zh-CN': '自媒体运营', 'zh-TW': '自媒體營運', ko: '크리에이터 운영', ja: 'クリエイター運用' })
    }),
    market: Object.freeze({
      moduleId: 'market', routeId: 'market', labels: Object.freeze({ en: 'Stock Market', 'zh-CN': '股票市场', 'zh-TW': '股票市場', ko: '주식 시장', ja: '株式市場' })
    }),
    starbench: Object.freeze({
      moduleId: 'starbench', routeId: 'starbench', labels: Object.freeze({ en: 'StarBench', 'zh-CN': '星测', 'zh-TW': '星測', ko: 'StarBench', ja: 'StarBench' })
    }),
    'legacy-device': Object.freeze({
      moduleId: 'legacy-device', routeId: null, labels: Object.freeze({ en: 'Legacy Device', 'zh-CN': '设备状态', 'zh-TW': '裝置狀態', ko: '기기 상태', ja: 'デバイス状態' })
    }),
    'today-tomorrow': Object.freeze({
      moduleId: 'today-tomorrow', routeId: 'calendar', labels: Object.freeze({ en: 'Calendar', 'zh-CN': '日历管家', 'zh-TW': '日曆管家', ko: '캘린더', ja: 'カレンダー' })
    }),
    'automation-center': Object.freeze({
      moduleId: 'automation-center', routeId: 'automation-center', labels: Object.freeze({ en: 'Automation Center', 'zh-CN': '自动化中心', 'zh-TW': '自動化中心', ko: '자동화 센터', ja: '自動化センター' })
    }),
    'study-center': Object.freeze({
      moduleId: 'study-center', routeId: 'study-center', labels: Object.freeze({ en: 'Study Center', 'zh-CN': '学习中心', 'zh-TW': '學習中心', ko: '학습 센터', ja: '学習センター' })
    })
  });
  const assemblyModules = Object.freeze([
    Object.freeze({ moduleId: 'consumption', descriptions: Object.freeze({ en: 'Review spending statistics and recent records.', 'zh-CN': '查看消费统计与最近记录。' }) }),
    Object.freeze({ moduleId: 'today-tomorrow', descriptions: Object.freeze({ en: 'Plan today and tomorrow with tasks and reminders.', 'zh-CN': '安排今日与明日的任务和提醒。' }) }),
    Object.freeze({ moduleId: 'study-center', descriptions: Object.freeze({ en: 'Study CET6 and private local driving-theory collections.', 'zh-CN': '学习 CET6 与私有本地科目一资料。' }) }),
    Object.freeze({ moduleId: 'device-center', descriptions: Object.freeze({ en: 'Inspect devices, performance, network, and diagnostics.', 'zh-CN': '查看设备、性能、网络与诊断。' }) }),
    Object.freeze({ moduleId: 'market', descriptions: Object.freeze({ en: 'Review market, watchlist, portfolio, and research.', 'zh-CN': '查看行情、自选、持仓与研究。' }) }),
    Object.freeze({ moduleId: 'creator-ops', descriptions: Object.freeze({ en: 'Open the module-owned Creator Ops workspace.', 'zh-CN': '打开自媒体运营本地工作区。' }) })
  ]);

  function normalizeLocale(locale) {
    const value = String(locale || '').trim();
    if (/^zh-(?:CN|Hans)/i.test(value)) return 'zh-CN';
    if (/^zh-(?:TW|HK|Hant)/i.test(value)) return 'zh-TW';
    if (/^ko/i.test(value)) return 'ko';
    if (/^ja/i.test(value)) return 'ja';
    return 'en';
  }

  function cloneRoute(route) {
    const result = { id: route.id, moduleId: route.moduleId, label: route.labels.en };
    if (route.shortLabel) result.shortLabel = route.shortLabel;
    if (route.accessibleName) result.accessibleName = route.accessibleName;
    return result;
  }

  function listRoutes() {
    return routes.map(cloneRoute);
  }

  function listPrimaryRoutes() {
    return primaryRouteIds.map((routeId) => cloneRoute(routeById.get(routeId)));
  }

  function getRoute(routeId) {
    const route = routeById.get(routeId);
    return route ? cloneRoute(route) : undefined;
  }

  function getModuleMetadata(moduleId) {
    const value = moduleMetadata[moduleId];
    return value ? { moduleId: value.moduleId, routeId: value.routeId, label: value.labels.en } : undefined;
  }

  function listAssemblyModules(locale) {
    return assemblyModules.map((entry) => {
      const metadata = moduleMetadata[entry.moduleId];
      return {
        moduleId: entry.moduleId,
        routeId: metadata.routeId,
        label: metadata.labels[normalizeLocale(locale)],
        description: entry.descriptions[normalizeLocale(locale)] || entry.descriptions.en
      };
    });
  }

  function routeLabel(routeId, locale) {
    const route = routeById.get(routeId);
    return route ? route.labels[normalizeLocale(locale)] : routeId;
  }

  function moduleLabel(moduleId, locale) {
    const value = moduleMetadata[moduleId];
    return value ? value.labels[normalizeLocale(locale)] : moduleId;
  }

  return Object.freeze({
    getModuleMetadata, getRoute, listAssemblyModules, listPrimaryRoutes, listRoutes, moduleLabel, routeLabel
  });
});
