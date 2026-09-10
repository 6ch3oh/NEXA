'use strict';

const WINDOW_SIZE_MODES = Object.freeze({
  COMPACT: 'compact',
  STANDARD: 'standard',
  EXPANDED: 'expanded',
  MANUAL: 'manual'
});

const WINDOW_SIZE_PRESETS = Object.freeze({
  [WINDOW_SIZE_MODES.COMPACT]: Object.freeze({ width: 468, height: 720 }),
  [WINDOW_SIZE_MODES.STANDARD]: Object.freeze({ width: 1180, height: 800 }),
  [WINDOW_SIZE_MODES.EXPANDED]: Object.freeze({ width: 1440, height: 960 })
});

const LEGACY_SMALL_DEFAULT = Object.freeze({ width: 340, height: 650 });
const LEGACY_SMALL_TOLERANCE = 32;
const WINDOW_SIZE_MODE_VALUES = new Set(Object.values(WINDOW_SIZE_MODES));

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWindowSizeMode(value, fallback = WINDOW_SIZE_MODES.STANDARD) {
  const normalized = String(value || '').trim().toLowerCase();
  return WINDOW_SIZE_MODE_VALUES.has(normalized) ? normalized : fallback;
}

function validWindowBounds(value) {
  if (!value || typeof value !== 'object') return null;
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const bounds = { width: Math.round(width), height: Math.round(height) };
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x !== null && y !== null) {
    bounds.x = Math.round(x);
    bounds.y = Math.round(y);
  }
  return bounds;
}

function isLegacySmallDefault(value, tolerance = LEGACY_SMALL_TOLERANCE) {
  const bounds = validWindowBounds(value);
  if (!bounds) return false;
  return Math.abs(bounds.width - LEGACY_SMALL_DEFAULT.width) <= tolerance
    && Math.abs(bounds.height - LEGACY_SMALL_DEFAULT.height) <= tolerance;
}

function migrateWindowSizeSettings(saved = {}) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const explicitMode = WINDOW_SIZE_MODE_VALUES.has(String(source.windowSizeMode || '').trim().toLowerCase());
  const savedBounds = validWindowBounds(source.windowBounds);
  const savedManualBounds = validWindowBounds(source.manualWindowBounds);

  if (explicitMode) {
    const windowSizeMode = normalizeWindowSizeMode(source.windowSizeMode);
    const fallbackBounds = windowSizeMode === WINDOW_SIZE_MODES.MANUAL
      ? savedManualBounds
      : WINDOW_SIZE_PRESETS[windowSizeMode];
    return {
      windowSizeMode,
      windowMigrationDone: true,
      ...(savedBounds || fallbackBounds ? { windowBounds: savedBounds || { ...fallbackBounds } } : {}),
      ...(savedManualBounds ? { manualWindowBounds: savedManualBounds } : {}),
      changed: source.windowMigrationDone !== true,
      reason: source.windowMigrationDone === true ? 'already-explicit' : 'explicit-mode'
    };
  }

  if (savedBounds && isLegacySmallDefault(savedBounds)) {
    return {
      windowSizeMode: WINDOW_SIZE_MODES.STANDARD,
      windowMigrationDone: true,
      windowBounds: {
        ...(typeof savedBounds.x === 'number' ? { x: savedBounds.x, y: savedBounds.y } : {}),
        ...WINDOW_SIZE_PRESETS[WINDOW_SIZE_MODES.STANDARD]
      },
      ...(savedManualBounds ? { manualWindowBounds: savedManualBounds } : {}),
      changed: true,
      reason: 'legacy-small-default'
    };
  }

  if (savedBounds) {
    return {
      windowSizeMode: WINDOW_SIZE_MODES.MANUAL,
      windowMigrationDone: true,
      windowBounds: savedBounds,
      manualWindowBounds: savedManualBounds || savedBounds,
      changed: true,
      reason: 'preserved-custom-bounds'
    };
  }

  return {
    windowSizeMode: WINDOW_SIZE_MODES.STANDARD,
    windowMigrationDone: true,
    windowBounds: { ...WINDOW_SIZE_PRESETS[WINDOW_SIZE_MODES.STANDARD] },
    ...(savedManualBounds ? { manualWindowBounds: savedManualBounds } : {}),
    changed: true,
    reason: 'standard-default'
  };
}

function clampWindowBounds(value, workArea, limits = {}) {
  const bounds = validWindowBounds(value) || { ...WINDOW_SIZE_PRESETS[WINDOW_SIZE_MODES.STANDARD] };
  const area = validWindowBounds(workArea) || bounds;
  const areaX = finiteNumber(workArea?.x) ?? 0;
  const areaY = finiteNumber(workArea?.y) ?? 0;
  const minWidth = Math.min(area.width, Math.max(1, finiteNumber(limits.minWidth) ?? 1));
  const minHeight = Math.min(area.height, Math.max(1, finiteNumber(limits.minHeight) ?? 1));
  const maxWidth = Math.min(area.width, Math.max(minWidth, finiteNumber(limits.maxWidth) ?? area.width));
  const maxHeight = Math.min(area.height, Math.max(minHeight, finiteNumber(limits.maxHeight) ?? area.height));
  const width = Math.round(Math.min(maxWidth, Math.max(minWidth, bounds.width)));
  const height = Math.round(Math.min(maxHeight, Math.max(minHeight, bounds.height)));
  const fallbackX = areaX + Math.round((area.width - width) / 2);
  const fallbackY = areaY + Math.round((area.height - height) / 2);
  const requestedX = finiteNumber(bounds.x) ?? fallbackX;
  const requestedY = finiteNumber(bounds.y) ?? fallbackY;
  const x = Math.round(Math.min(areaX + area.width - width, Math.max(areaX, requestedX)));
  const y = Math.round(Math.min(areaY + area.height - height, Math.max(areaY, requestedY)));
  return { x, y, width, height };
}

function boundsForWindowSizeMode(mode, currentBounds, manualBounds, workArea, limits) {
  const normalizedMode = normalizeWindowSizeMode(mode);
  const current = validWindowBounds(currentBounds) || { ...WINDOW_SIZE_PRESETS[WINDOW_SIZE_MODES.STANDARD] };
  if (normalizedMode === WINDOW_SIZE_MODES.MANUAL) {
    return clampWindowBounds(validWindowBounds(manualBounds) || current, workArea, limits);
  }
  const preset = WINDOW_SIZE_PRESETS[normalizedMode];
  const centered = { ...preset };
  if (typeof current.x === 'number') {
    centered.x = Math.round(current.x + ((current.width - preset.width) / 2));
    centered.y = Math.round(current.y + ((current.height - preset.height) / 2));
  }
  return clampWindowBounds(centered, workArea, limits);
}

module.exports = {
  LEGACY_SMALL_DEFAULT,
  LEGACY_SMALL_TOLERANCE,
  WINDOW_SIZE_MODES,
  WINDOW_SIZE_PRESETS,
  boundsForWindowSizeMode,
  clampWindowBounds,
  isLegacySmallDefault,
  migrateWindowSizeSettings,
  normalizeWindowSizeMode,
  validWindowBounds
};
