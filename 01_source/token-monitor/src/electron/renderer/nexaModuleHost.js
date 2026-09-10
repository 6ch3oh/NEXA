'use strict';

(function exposeNexaModuleHost(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaModuleHost = api;
})(typeof window !== 'undefined' ? window : null, function createNexaModuleHostApi() {
  const HOST_STATES = new Set(['loading', 'ready', 'disabled', 'empty', 'error']);
  const PRODUCT_STATES = new Set(['READY', 'LIMITED', 'OFFLINE', 'UNAVAILABLE', 'ERROR']);

  function setSurfaceVisibility(surface, visible) {
    if (!surface) return false;
    const shouldShow = visible === true;
    surface.hidden = !shouldShow;
    surface.classList?.toggle('hidden', !shouldShow);
    surface.setAttribute?.('aria-hidden', String(!shouldShow));
    if ('inert' in surface) surface.inert = !shouldShow;
    return shouldShow;
  }

  function createPrimarySurfaceController(surfaces = []) {
    const primarySurfaces = [...new Set(surfaces.filter(Boolean))];

    function showOnly(activeSurface) {
      if (activeSurface && !primarySurfaces.includes(activeSurface)) {
        throw new TypeError('activeSurface must belong to the primary surface set');
      }
      let visibleCount = 0;
      for (const surface of primarySurfaces) {
        if (setSurfaceVisibility(surface, surface === activeSurface)) visibleCount += 1;
      }
      return visibleCount;
    }

    return Object.freeze({ showOnly });
  }

  function createExclusivePresentationController(host, presentations = []) {
    if (!host || typeof host.append !== 'function') {
      throw new TypeError('host must expose an append capability');
    }
    const ownedPresentations = [...new Set(presentations.filter(Boolean))];

    function showOnly(activePresentation) {
      if (activePresentation && !ownedPresentations.includes(activePresentation)) {
        throw new TypeError('activePresentation must belong to the presentation set');
      }
      for (const presentation of ownedPresentations) {
        if (presentation === activePresentation) continue;
        setSurfaceVisibility(presentation, false);
        presentation.remove?.();
      }
      if (!activePresentation) return 0;
      setSurfaceVisibility(activePresentation, true);
      if (activePresentation.parentNode !== host) host.append(activePresentation);
      return 1;
    }

    return Object.freeze({ showOnly });
  }

  function cloneModule(value) {
    const result = {
      moduleId: value.moduleId,
      enabled: value.enabled === true,
      autoStart: value.autoStart === true,
      runtimeStatus: typeof value.runtimeStatus === 'string' ? value.runtimeStatus : 'inactive'
    };
    if (typeof value.errorCode === 'string') result.errorCode = value.errorCode;
    if (value.readiness && typeof value.readiness.state === 'string') {
      result.readiness = Object.freeze({
        state: value.readiness.state,
        ...(typeof value.readiness.code === 'string' ? { code: value.readiness.code } : {})
      });
    }
    return Object.freeze(result);
  }

  function createNexaModuleHost(options = {}) {
    const catalog = options.catalog;
    if (!catalog || typeof catalog.listRoutes !== 'function' || typeof catalog.getRoute !== 'function') {
      throw new TypeError('catalog must expose the NEXA presentation catalog surface');
    }
    const routeIds = catalog.listRoutes().map((route) => route.id);
    let activeRoute = routeIds.includes(options.initialRoute) ? options.initialRoute : 'home';
    let modules = new Map();
    let loadState = 'loading';

    function updateControlSnapshot(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.modules)) {
        modules = new Map();
        loadState = 'error';
        return getSnapshot();
      }
      modules = new Map(snapshot.modules.map((value) => [value.moduleId, cloneModule(value)]));
      loadState = 'ready';
      const route = catalog.getRoute(activeRoute);
      if (route?.moduleId && modules.get(route.moduleId)?.enabled !== true) activeRoute = 'settings';
      return getSnapshot();
    }

    function routeState(routeId) {
      const route = catalog.getRoute(routeId);
      if (!route) return 'error';
      if (loadState !== 'ready' && route.moduleId) return loadState;
      if (route.moduleId && modules.get(route.moduleId)?.enabled !== true) return 'disabled';
      if (routeId === 'resources') return 'empty';
      return 'ready';
    }

    function navigate(routeId) {
      const route = catalog.getRoute(routeId);
      if (!route) return Object.freeze({ ok: false, code: 'ROUTE_NOT_FOUND' });
      if (route.moduleId && modules.get(route.moduleId)?.enabled !== true) {
        return Object.freeze({ ok: false, code: 'MODULE_DISABLED', moduleId: route.moduleId });
      }
      activeRoute = routeId;
      return Object.freeze({ ok: true, snapshot: getSnapshot() });
    }

    function moduleState(moduleId, presentationState) {
      const module = modules.get(moduleId);
      if (loadState !== 'ready' || !module) return 'UNAVAILABLE';
      if (!module.enabled) return 'OFFLINE';
      if (PRODUCT_STATES.has(presentationState)) return presentationState;
      if (PRODUCT_STATES.has(module.readiness?.state)) return module.readiness.state;
      if (module.runtimeStatus === 'error') return 'ERROR';
      if (module.runtimeStatus === 'starting' || module.runtimeStatus === 'stopping') return 'LIMITED';
      if (module.runtimeStatus === 'running') return 'READY';
      return 'OFFLINE';
    }

    function getSnapshot() {
      const status = routeState(activeRoute);
      return Object.freeze({
        activeRoute,
        activeModuleId: catalog.getRoute(activeRoute)?.moduleId || null,
        status: HOST_STATES.has(status) ? status : 'error',
        modules: Object.freeze([...modules.values()].map(cloneModule))
      });
    }

    return Object.freeze({ getSnapshot, moduleState, navigate, routeState, updateControlSnapshot });
  }

  return Object.freeze({
    createExclusivePresentationController,
    createNexaModuleHost,
    createPrimarySurfaceController,
    setSurfaceVisibility
  });
});
