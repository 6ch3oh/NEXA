'use strict';

(function exposeNexaDesktopComposition(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaDesktopComposition = api;
})(typeof window !== 'undefined' ? window : null, function createNexaDesktopCompositionApi() {
  const HOME_WIDGET_CONTRACT_VERSION = 1;
  const slots = Object.freeze([
    Object.freeze({ id: 'today', labels: Object.freeze({ en: 'Today', 'zh-CN': '今日区域' }) }),
    Object.freeze({ id: 'data', labels: Object.freeze({ en: 'Data', 'zh-CN': '数据区域' }) }),
    Object.freeze({ id: 'activity', labels: Object.freeze({ en: 'Activity', 'zh-CN': '动态区域' }) }),
    Object.freeze({ id: 'status', labels: Object.freeze({ en: 'Status', 'zh-CN': '底部状态区域' }) })
  ]);
  const placements = Object.freeze([
    Object.freeze({ moduleId: 'today-tomorrow', slotId: 'today', order: 10 }),
    Object.freeze({ moduleId: 'consumption', slotId: 'data', order: 10 }),
    Object.freeze({ moduleId: 'market', slotId: 'data', order: 20 }),
    Object.freeze({ moduleId: 'creator-ops', slotId: 'activity', order: 10 }),
    Object.freeze({ moduleId: 'device-center', slotId: 'status', order: 10 })
  ]);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const placementByModuleId = new Map(placements.map((placement) => [placement.moduleId, placement]));

  function localeKey(locale) {
    return /^zh-(?:CN|Hans)/i.test(String(locale || '')) ? 'zh-CN' : 'en';
  }

  function listHomeSlots(locale) {
    const key = localeKey(locale);
    return slots.map((slot) => Object.freeze({ id: slot.id, label: slot.labels[key] || slot.labels.en }));
  }

  function getWidgetPlacement(moduleId) {
    const value = placementByModuleId.get(moduleId);
    return value ? Object.freeze({ ...value }) : undefined;
  }

  function resolveWidgetPlacement(moduleId, override = {}) {
    const preferred = placementByModuleId.get(moduleId);
    const requestedSlot = typeof override.slotId === 'string' ? override.slotId : preferred?.slotId;
    const slotId = slotIds.has(requestedSlot) ? requestedSlot : 'status';
    const requestedOrder = Number(override.order);
    const order = Number.isFinite(requestedOrder) ? requestedOrder : preferred?.order ?? 1000;
    return Object.freeze({ moduleId, slotId, order });
  }

  function listWidgetPlacements() {
    return placements.map((placement) => Object.freeze({ ...placement }));
  }

  return Object.freeze({
    HOME_WIDGET_CONTRACT_VERSION,
    getWidgetPlacement,
    listHomeSlots,
    listWidgetPlacements,
    resolveWidgetPlacement
  });
});
