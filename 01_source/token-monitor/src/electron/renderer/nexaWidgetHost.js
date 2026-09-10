'use strict';

(function exposeNexaWidgetHost(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaWidgetHost = api;
})(typeof window !== 'undefined' ? window : null, function createNexaWidgetHostApi() {
  const WIDGET_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);

  function setVisible(element, visible) {
    const show = visible === true;
    element.hidden = !show;
    element.classList?.toggle('hidden', !show);
    element.setAttribute?.('aria-hidden', String(!show));
    if ('inert' in element) element.inert = !show;
    return show;
  }

  function createNexaWidgetHost(options = {}) {
    const slots = new Map(Object.entries(options.slots || {}).filter(([, element]) => element));
    if (!slots.size) throw new TypeError('Widget Host requires at least one slot container');
    const widgets = new Map();

    function requireWidget(widgetId) {
      const widget = widgets.get(widgetId);
      if (!widget) throw new TypeError(`Unknown widget: ${widgetId}`);
      return widget;
    }

    function requireSlot(slotId) {
      const slot = slots.get(slotId);
      if (!slot) throw new TypeError(`Unknown widget slot: ${slotId}`);
      return slot;
    }

    function setStatus(widgetId, status, label = status) {
      const widget = requireWidget(widgetId);
      const next = WIDGET_STATES.has(status) ? status : 'UNAVAILABLE';
      widget.status = next;
      widget.element.dataset.widgetStatus = next;
      const target = widget.element.querySelector?.('[data-nexa-widget-status]');
      if (target) target.textContent = String(label || next);
      return next;
    }

    function register(definition = {}) {
      const widgetId = String(definition.widgetId || '').trim();
      if (!widgetId || widgets.has(widgetId)) throw new TypeError('Widget registration requires a unique widgetId');
      if (!definition.element) throw new TypeError('Widget registration requires an element');
      const slot = requireSlot(definition.slotId);
      const widget = {
        widgetId,
        moduleId: typeof definition.moduleId === 'string' ? definition.moduleId : null,
        slotId: definition.slotId,
        order: Number.isFinite(definition.order) ? definition.order : 1000,
        element: definition.element,
        status: 'UNAVAILABLE',
        theme: typeof definition.theme === 'string' ? definition.theme : 'inherit',
        capabilities: Object.freeze({
          movable: definition.capabilities?.movable === true,
          themable: definition.capabilities?.themable === true,
          removable: definition.capabilities?.removable === true
        })
      };
      definition.element.dataset.nexaWidgetId = widgetId;
      definition.element.dataset.widgetSlot = widget.slotId;
      definition.element.dataset.widgetTheme = widget.theme;
      definition.element.dataset.widgetMovable = String(widget.capabilities.movable);
      widgets.set(widgetId, widget);
      slot.append(definition.element);
      setStatus(widgetId, definition.status, definition.statusLabel);
      setVisible(definition.element, definition.visible !== false);
      return snapshot(widget);
    }

    function show(widgetId) {
      return setVisible(requireWidget(widgetId).element, true);
    }

    function hide(widgetId) {
      return !setVisible(requireWidget(widgetId).element, false);
    }

    function move(widgetId, slotId, order) {
      const widget = requireWidget(widgetId);
      const slot = requireSlot(slotId);
      widget.slotId = slotId;
      if (Number.isFinite(order)) widget.order = order;
      widget.element.dataset.widgetSlot = slotId;
      slot.append(widget.element);
      return snapshot(widget);
    }

    function setTheme(widgetId, theme) {
      const widget = requireWidget(widgetId);
      widget.theme = typeof theme === 'string' && theme.trim() ? theme.trim() : 'inherit';
      widget.element.dataset.widgetTheme = widget.theme;
      return widget.theme;
    }

    function unregister(widgetId) {
      const widget = widgets.get(widgetId);
      if (!widget) return false;
      widget.element.remove?.();
      widgets.delete(widgetId);
      return true;
    }

    function clear() {
      for (const widgetId of [...widgets.keys()]) unregister(widgetId);
    }

    function snapshot(widget) {
      return Object.freeze({
        widgetId: widget.widgetId,
        moduleId: widget.moduleId,
        slotId: widget.slotId,
        order: widget.order,
        status: widget.status,
        visible: widget.element.hidden !== true,
        theme: widget.theme,
        capabilities: widget.capabilities
      });
    }

    function getSnapshot() {
      return Object.freeze([...widgets.values()].map(snapshot));
    }

    return Object.freeze({ clear, getSnapshot, hide, move, register, setStatus, setTheme, show, unregister });
  }

  return Object.freeze({ createNexaWidgetHost, setVisible });
});
