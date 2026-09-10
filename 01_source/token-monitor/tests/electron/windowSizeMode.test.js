'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  WINDOW_SIZE_MODES,
  WINDOW_SIZE_PRESETS,
  boundsForWindowSizeMode,
  clampWindowBounds,
  migrateWindowSizeSettings,
  normalizeWindowSizeMode
} = require('../../src/electron/windowSizeMode');
const { MESSAGES } = require('../../src/electron/renderer/i18n');

const LIMITS = { minWidth: 240, minHeight: 140, maxWidth: 1600, maxHeight: 1400 };
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

test('V0.1 window layout presets are frozen at the approved dimensions', () => {
  assert.deepEqual(WINDOW_SIZE_PRESETS, {
    compact: { width: 468, height: 720 },
    standard: { width: 1180, height: 800 },
    expanded: { width: 1440, height: 960 }
  });
  assert.equal(normalizeWindowSizeMode('manual'), WINDOW_SIZE_MODES.MANUAL);
  assert.equal(normalizeWindowSizeMode('unknown'), WINDOW_SIZE_MODES.STANDARD);
});

test('new installs and the legacy small default migrate once to standard', () => {
  assert.deepEqual(migrateWindowSizeSettings({}), {
    windowSizeMode: 'standard',
    windowMigrationDone: true,
    windowBounds: { width: 1180, height: 800 },
    changed: true,
    reason: 'standard-default'
  });
  assert.deepEqual(migrateWindowSizeSettings({ windowBounds: { x: 40, y: 50, width: 350, height: 630 } }), {
    windowSizeMode: 'standard',
    windowMigrationDone: true,
    windowBounds: { x: 40, y: 50, width: 1180, height: 800 },
    changed: true,
    reason: 'legacy-small-default'
  });
});

test('legacy custom bounds are preserved as manual and explicit modes never remigrate', () => {
  const custom = migrateWindowSizeSettings({ windowBounds: { x: 80, y: 90, width: 910, height: 740 } });
  assert.equal(custom.windowSizeMode, 'manual');
  assert.deepEqual(custom.windowBounds, { x: 80, y: 90, width: 910, height: 740 });
  assert.deepEqual(custom.manualWindowBounds, custom.windowBounds);

  const explicit = migrateWindowSizeSettings({
    windowSizeMode: 'compact',
    windowMigrationDone: true,
    windowBounds: { x: 1, y: 2, width: 468, height: 720 }
  });
  assert.equal(explicit.changed, false);
  assert.equal(explicit.reason, 'already-explicit');
  assert.deepEqual(
    migrateWindowSizeSettings({ windowSizeMode: 'expanded', windowMigrationDone: true }).windowBounds,
    { width: 1440, height: 960 }
  );
});

test('preset changes preserve the window centre and manual restores its own bounds', () => {
  assert.deepEqual(
    boundsForWindowSizeMode('compact', { x: 100, y: 100, width: 1180, height: 800 }, null, WORK_AREA, LIMITS),
    { x: 456, y: 140, width: 468, height: 720 }
  );
  assert.deepEqual(
    boundsForWindowSizeMode('manual', null, { x: 33, y: 44, width: 900, height: 700 }, WORK_AREA, LIMITS),
    { x: 33, y: 44, width: 900, height: 700 }
  );
});

test('off-screen and oversized bounds are fully clamped into the selected work area', () => {
  assert.deepEqual(
    clampWindowBounds(
      { x: 4000, y: -800, width: 1600, height: 1400 },
      { x: 1920, y: 0, width: 1280, height: 720 },
      LIMITS
    ),
    { x: 1920, y: 0, width: 1280, height: 720 }
  );
});

test('Appearance exposes all four modes and the renderer persists mode changes', () => {
  const rendererDir = path.join(__dirname, '..', '..', 'src', 'electron', 'renderer');
  const html = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');
  const appearance = html.slice(
    html.indexOf('<div id="appearanceSettingsDetails"'),
    html.indexOf('<div class="settings-group settings-collapsible-group settings-tools-group"')
  );
  assert.match(appearance, /id="windowSizeModeInput"/);
  for (const mode of ['compact', 'standard', 'expanded', 'manual']) {
    assert.match(appearance, new RegExp(`<option value="${mode}"`));
  }
  assert.match(app, /windowSizeModeInput: document\.getElementById\('windowSizeModeInput'\)/);
  assert.match(app, /saveSettings\(\{ windowSizeMode: els\.windowSizeModeInput\.value \}\)/);
});

test('window layout labels are complete in every bundled locale', () => {
  const keys = [
    'settings.appearance.windowLayout',
    'settings.appearance.windowLayoutNote',
    'settings.appearance.windowLayout.compact',
    'settings.appearance.windowLayout.standard',
    'settings.appearance.windowLayout.expanded',
    'settings.appearance.windowLayout.manual'
  ];
  for (const [locale, messages] of Object.entries(MESSAGES)) {
    for (const key of keys) assert.ok(messages[key], `${locale} missing ${key}`);
  }
});
