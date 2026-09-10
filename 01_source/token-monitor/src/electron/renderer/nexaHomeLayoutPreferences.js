'use strict';

(function exposeNexaHomeLayoutPreferences(root, factory) {
  const preferenceApi = typeof module === 'object' && module.exports
    ? require('./homeModulePreferences')
    : root?.TokenMonitorHomeModulePreferences;
  const api = factory(preferenceApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NexaHomeLayoutPreferences = api;
})(typeof window !== 'undefined' ? window : null, function createNexaHomeLayoutPreferencesApi(preferenceApi) {
  const HOME_LAYOUT_DENSITIES = Object.freeze(['comfortable', 'compact']);
  const DEFAULT_HOME_LAYOUT_DENSITY = 'comfortable';
  const DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS = Object.freeze({
    order: 'homeModuleOrder',
    hidden: 'hiddenHomeModules',
    density: 'homeModuleDensity'
  });

  function normalizeHomeLayoutDensity(value, fallback = DEFAULT_HOME_LAYOUT_DENSITY) {
    const normalizedFallback = HOME_LAYOUT_DENSITIES.includes(String(fallback || '').trim().toLowerCase())
      ? String(fallback).trim().toLowerCase()
      : DEFAULT_HOME_LAYOUT_DENSITY;
    const normalized = String(value || '').trim().toLowerCase();
    return HOME_LAYOUT_DENSITIES.includes(normalized) ? normalized : normalizedFallback;
  }

  function requirePreferenceApi() {
    const required = [
      'moveHomeModuleOrder',
      'normalizeHiddenHomeModules',
      'normalizeHomeModuleOrder',
      'reorderHomeModuleOrder'
    ];
    if (!preferenceApi || required.some((name) => typeof preferenceApi[name] !== 'function')) {
      throw new TypeError('NEXA Home layout requires the existing homeModulePreferences API');
    }
    return preferenceApi;
  }

  function normalizeWidgetId(value) {
    return String(value || '').trim().toLowerCase();
  }

  function createWidgetOptions(input) {
    if (!Array.isArray(input) || input.length === 0) {
      throw new TypeError('NEXA Home layout requires at least one widgetId');
    }
    const seen = new Set();
    return input.map((entry) => {
      const rawId = typeof entry === 'string' ? entry : entry?.widgetId ?? entry?.id;
      const id = normalizeWidgetId(rawId);
      if (!id || id.includes(',')) {
        throw new TypeError('NEXA Home widgetId must be a non-empty value without commas');
      }
      if (seen.has(id)) throw new TypeError(`Duplicate NEXA Home widgetId: ${id}`);
      seen.add(id);
      return Object.freeze({ id });
    });
  }

  function parseList(value) {
    return Array.isArray(value) ? value : String(value || '').split(',');
  }

  function validateExactOrder(value, widgetOptions, label) {
    const expectedIds = widgetOptions.map((widget) => widget.id);
    const expected = new Set(expectedIds);
    const raw = parseList(value);
    const result = raw.map(normalizeWidgetId);
    const unique = new Set(result);
    const valid = result.length === expectedIds.length
      && unique.size === expectedIds.length
      && result.every((id) => expected.has(id));
    if (!valid) throw new TypeError(`${label} must contain every known widgetId exactly once`);
    return result;
  }

  function normalizePreferenceKeys(value = {}) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('preferenceKeys must be an object');
    }
    const keys = {};
    for (const name of Object.keys(DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS)) {
      const key = String(value[name] ?? DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS[name]).trim();
      if (!key) throw new TypeError(`preferenceKeys.${name} must be a non-empty string`);
      keys[name] = key;
    }
    if (new Set(Object.values(keys)).size !== Object.keys(keys).length) {
      throw new TypeError('NEXA Home layout preference keys must be unique');
    }
    return Object.freeze(keys);
  }

  function sameArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function sameState(left, right) {
    return left.density === right.density
      && sameArray(left.orderedWidgetIds, right.orderedWidgetIds)
      && sameArray(left.hiddenWidgetIds, right.hiddenWidgetIds);
  }

  function createNexaHomeLayoutPreferencesController(options = {}) {
    const primitives = requirePreferenceApi();
    const widgetOptions = createWidgetOptions(options.widgetIds ?? options.widgets);
    const knownIds = widgetOptions.map((widget) => widget.id);
    const knownSet = new Set(knownIds);
    const preferenceKeys = normalizePreferenceKeys(options.preferenceKeys);
    if (typeof options.readPreferences !== 'function') {
      throw new TypeError('readPreferences must be a function');
    }
    if (typeof options.writePreferences !== 'function') {
      throw new TypeError('writePreferences must be a function');
    }

    const defaultOrder = options.defaultOrderedWidgetIds === undefined
      ? [...knownIds]
      : validateExactOrder(options.defaultOrderedWidgetIds, widgetOptions, 'defaultOrderedWidgetIds');
    const normalizedDefaultHidden = primitives.normalizeHiddenHomeModules(
      options.defaultHiddenWidgetIds || '',
      widgetOptions
    );
    const defaultHiddenSet = new Set(parseList(normalizedDefaultHidden).map(normalizeWidgetId).filter(Boolean));
    const defaultState = {
      orderedWidgetIds: defaultOrder,
      hiddenWidgetIds: defaultOrder.filter((id) => defaultHiddenSet.has(id)),
      density: normalizeHomeLayoutDensity(options.defaultDensity)
    };
    let state = {
      orderedWidgetIds: [...defaultState.orderedWidgetIds],
      hiddenWidgetIds: [...defaultState.hiddenWidgetIds],
      density: defaultState.density
    };
    let operationTail = Promise.resolve();

    function requireWidgetId(widgetId) {
      const id = normalizeWidgetId(widgetId);
      if (!knownSet.has(id)) throw new TypeError(`Unknown NEXA Home widgetId: ${id || '(empty)'}`);
      return id;
    }

    function canonicalizeState(candidate = {}) {
      const orderedWidgetIds = primitives.normalizeHomeModuleOrder(
        candidate.orderedWidgetIds,
        widgetOptions
      );
      const normalizedHidden = primitives.normalizeHiddenHomeModules(
        candidate.hiddenWidgetIds,
        widgetOptions
      );
      const hiddenSet = new Set(parseList(normalizedHidden).map(normalizeWidgetId).filter(Boolean));
      return {
        orderedWidgetIds,
        hiddenWidgetIds: orderedWidgetIds.filter((id) => hiddenSet.has(id)),
        density: normalizeHomeLayoutDensity(candidate.density, defaultState.density)
      };
    }

    function serialize(candidate) {
      return {
        [preferenceKeys.order]: candidate.orderedWidgetIds.join(','),
        [preferenceKeys.hidden]: candidate.hiddenWidgetIds.join(','),
        [preferenceKeys.density]: candidate.density
      };
    }

    function createSnapshot(candidate = state) {
      const orderedWidgetIds = Object.freeze([...candidate.orderedWidgetIds]);
      const hiddenWidgetIds = Object.freeze([...candidate.hiddenWidgetIds]);
      const hiddenSet = new Set(hiddenWidgetIds);
      const visibleWidgetIds = Object.freeze(orderedWidgetIds.filter((id) => !hiddenSet.has(id)));
      const widgets = Object.freeze(orderedWidgetIds.map((widgetId, index) => Object.freeze({
        widgetId,
        index,
        visible: !hiddenSet.has(widgetId)
      })));
      return Object.freeze({
        version: 1,
        layoutMode: 'ordered',
        supportsFreeFormLayout: false,
        orderedWidgetIds,
        hiddenWidgetIds,
        visibleWidgetIds,
        density: candidate.density,
        isDefault: sameState(candidate, defaultState),
        widgets
      });
    }

    function enqueue(operation) {
      const scheduled = operationTail.then(operation);
      operationTail = scheduled.catch(() => {});
      return scheduled;
    }

    async function persist(nextState) {
      const canonical = canonicalizeState(nextState);
      if (sameState(state, canonical)) return createSnapshot();
      await options.writePreferences(serialize(canonical));
      state = canonical;
      return createSnapshot();
    }

    function load(loadOptions = {}) {
      return enqueue(async () => {
        if (loadOptions === null || typeof loadOptions !== 'object' || Array.isArray(loadOptions)) {
          throw new TypeError('load options must be an object');
        }
        const repair = loadOptions.repair !== false;
        const stored = await options.readPreferences();
        if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
          throw new TypeError('readPreferences must resolve to an object');
        }
        const loaded = canonicalizeState({
          orderedWidgetIds: stored[preferenceKeys.order] ?? defaultState.orderedWidgetIds,
          hiddenWidgetIds: stored[preferenceKeys.hidden] ?? defaultState.hiddenWidgetIds,
          density: stored[preferenceKeys.density] ?? defaultState.density
        });
        const canonicalPreferences = serialize(loaded);
        const needsRepair = Object.entries(canonicalPreferences).some(([key, value]) => (
          !Object.prototype.hasOwnProperty.call(stored, key)
          || typeof stored[key] !== 'string'
          || stored[key] !== value
        ));
        if (repair && needsRepair) await options.writePreferences(canonicalPreferences);
        state = loaded;
        return createSnapshot();
      });
    }

    function setWidgetVisible(widgetId, visible) {
      return enqueue(async () => {
        const id = requireWidgetId(widgetId);
        if (typeof visible !== 'boolean') throw new TypeError('visible must be a boolean');
        const hiddenSet = new Set(state.hiddenWidgetIds);
        if (visible) hiddenSet.delete(id);
        else hiddenSet.add(id);
        if (hiddenSet.size >= knownIds.length) {
          throw new RangeError('NEXA Home must keep at least one widget visible');
        }
        return persist({
          ...state,
          hiddenWidgetIds: state.orderedWidgetIds.filter((knownId) => hiddenSet.has(knownId))
        });
      });
    }

    function showWidget(widgetId) {
      return setWidgetVisible(widgetId, true);
    }

    function hideWidget(widgetId) {
      return setWidgetVisible(widgetId, false);
    }

    function toggleWidget(widgetId) {
      return enqueue(async () => {
        const id = requireWidgetId(widgetId);
        const hiddenSet = new Set(state.hiddenWidgetIds);
        const shouldHide = !hiddenSet.has(id);
        if (shouldHide) hiddenSet.add(id);
        else hiddenSet.delete(id);
        if (hiddenSet.size >= knownIds.length) {
          throw new RangeError('NEXA Home must keep at least one widget visible');
        }
        return persist({
          ...state,
          hiddenWidgetIds: state.orderedWidgetIds.filter((knownId) => hiddenSet.has(knownId))
        });
      });
    }

    function showAllWidgets() {
      return enqueue(() => persist({ ...state, hiddenWidgetIds: [] }));
    }

    function moveWidget(widgetId, direction) {
      return enqueue(async () => {
        const id = requireWidgetId(widgetId);
        if (direction !== 'up' && direction !== 'down') {
          throw new TypeError('direction must be "up" or "down"');
        }
        const order = primitives.moveHomeModuleOrder(
          state.orderedWidgetIds,
          widgetOptions,
          id,
          direction
        );
        return persist({ ...state, orderedWidgetIds: order });
      });
    }

    function reorderWidget(widgetId, targetIndex) {
      return enqueue(async () => {
        const id = requireWidgetId(widgetId);
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= knownIds.length) {
          throw new RangeError('targetIndex must be an in-range integer');
        }
        const order = primitives.reorderHomeModuleOrder(
          state.orderedWidgetIds,
          widgetOptions,
          id,
          targetIndex
        );
        return persist({ ...state, orderedWidgetIds: order });
      });
    }

    function setOrderedWidgetIds(orderedWidgetIds) {
      return enqueue(async () => {
        if (!Array.isArray(orderedWidgetIds)) {
          throw new TypeError('orderedWidgetIds must be an array');
        }
        const order = validateExactOrder(orderedWidgetIds, widgetOptions, 'orderedWidgetIds');
        return persist({ ...state, orderedWidgetIds: order });
      });
    }

    function setDensity(density) {
      return enqueue(async () => {
        const normalized = String(density || '').trim().toLowerCase();
        if (!HOME_LAYOUT_DENSITIES.includes(normalized)) {
          throw new TypeError('density must be "comfortable" or "compact"');
        }
        return persist({ ...state, density: normalized });
      });
    }

    function restoreDefaults() {
      return enqueue(() => persist({
        orderedWidgetIds: [...defaultState.orderedWidgetIds],
        hiddenWidgetIds: [...defaultState.hiddenWidgetIds],
        density: defaultState.density
      }));
    }

    return Object.freeze({
      getSnapshot: createSnapshot,
      hideWidget,
      load,
      moveWidget,
      reorderWidget,
      restoreDefaults,
      setDensity,
      setOrderedWidgetIds,
      setWidgetVisible,
      showAllWidgets,
      showWidget,
      toggleWidget
    });
  }

  return Object.freeze({
    DEFAULT_HOME_LAYOUT_DENSITY,
    DEFAULT_HOME_LAYOUT_PREFERENCE_KEYS,
    HOME_LAYOUT_DENSITIES,
    createNexaHomeLayoutPreferencesController,
    normalizeHomeLayoutDensity
  });
});
