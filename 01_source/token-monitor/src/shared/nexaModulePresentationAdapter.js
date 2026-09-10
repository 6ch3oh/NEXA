'use strict';

(function exposeNexaModulePresentationAdapter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaModulePresentationAdapter = api;
})(typeof window !== 'undefined' ? window : null, function createNexaModulePresentationAdapterApi() {
  const PRESENTATION_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);

  function normalizeState(value) {
    const state = String(value || '').trim().toUpperCase();
    return PRESENTATION_STATES.has(state) ? state : 'UNAVAILABLE';
  }

  function safeDetail(value) {
    const detail = String(value || '').trim();
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(detail) ? detail : '';
  }

  function createModulePresentationAdapter(options = {}) {
    const composition = options.composition;
    if (!composition || typeof composition.resolveWidgetPlacement !== 'function') {
      throw new TypeError('Module Presentation Adapter requires a Desktop Composition');
    }

    function adapt(entry, module, state, layout = {}) {
      if (!entry || typeof entry.moduleId !== 'string' || typeof entry.routeId !== 'string') {
        throw new TypeError('Module presentation entry requires moduleId and routeId');
      }
      const placement = composition.resolveWidgetPlacement(entry.moduleId, layout);
      const enabled = module?.enabled !== false;
      const status = enabled ? normalizeState(state) : 'OFFLINE';
      const theme = typeof layout.theme === 'string' && layout.theme.trim() ? layout.theme.trim() : 'inherit';
      return Object.freeze({
        widgetId: `module:${entry.moduleId}`,
        moduleId: entry.moduleId,
        routeId: entry.routeId,
        slotId: placement.slotId,
        order: placement.order,
        title: String(entry.label || entry.moduleId),
        description: String(entry.description || ''),
        status,
        detail: safeDetail(layout.detail),
        enabled,
        visible: layout.visible !== false,
        theme,
        capabilities: Object.freeze({ movable: true, themable: true, removable: true })
      });
    }

    function adaptAll(options = {}) {
      const entries = Array.isArray(options.entries) ? options.entries : [];
      const modules = new Map((Array.isArray(options.modules) ? options.modules : [])
        .map((module) => [module.moduleId, module]));
      const layouts = options.layouts instanceof Map ? options.layouts : new Map();
      const stateFor = typeof options.stateFor === 'function' ? options.stateFor : () => 'UNAVAILABLE';
      const detailFor = typeof options.detailFor === 'function' ? options.detailFor : () => '';
      return entries.map((entry) => {
        const layout = { ...(layouts.get(entry.moduleId) || {}), detail: detailFor(entry.moduleId) };
        return adapt(entry, modules.get(entry.moduleId), stateFor(entry.moduleId), layout);
      }).sort((left, right) => left.slotId.localeCompare(right.slotId) || left.order - right.order ||
        left.moduleId.localeCompare(right.moduleId));
    }

    return Object.freeze({ adapt, adaptAll });
  }

  return Object.freeze({ createModulePresentationAdapter, normalizeState });
});
