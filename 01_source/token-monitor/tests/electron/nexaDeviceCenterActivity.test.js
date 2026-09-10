'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  DEVICE_CENTER_ACTIVITY_MODES,
  createNexaDeviceCenterActivityController,
  deviceCenterActivityModeForWindow
} = require('../../src/electron/nexaDeviceCenterActivity');

class FakeWindow extends EventEmitter {
  constructor({ visible = false, minimized = false, destroyed = false } = {}) {
    super();
    this.visible = visible;
    this.minimized = minimized;
    this.destroyed = destroyed;
  }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  isDestroyed() { return this.destroyed; }
}

test('window activity projection distinguishes visible foreground from hidden or minimized background', () => {
  assert.equal(deviceCenterActivityModeForWindow(new FakeWindow({ visible: true })), 'foreground');
  assert.equal(deviceCenterActivityModeForWindow(new FakeWindow({ visible: false })), 'background');
  assert.equal(deviceCenterActivityModeForWindow(new FakeWindow({ visible: true, minimized: true })), 'background');
  assert.equal(deviceCenterActivityModeForWindow(new FakeWindow({ visible: true, destroyed: true })), 'background');
  assert.equal(deviceCenterActivityModeForWindow(null), 'background');
});

test('main window lifecycle forwards one activity mode to the existing Device Center application', () => {
  const modes = [];
  const application = { setActivityMode(mode) { modes.push(mode); return true; } };
  let mainWindow = new FakeWindow();
  const controller = createNexaDeviceCenterActivityController({
    getComposition: () => ({ deviceCenterApplication: application }),
    getMainWindow: () => mainWindow
  });

  assert.equal(controller.bind(mainWindow), true);
  assert.equal(controller.bind(mainWindow), false);
  mainWindow.visible = true;
  mainWindow.emit('show');
  mainWindow.minimized = true;
  mainWindow.emit('minimize');
  mainWindow.minimized = false;
  mainWindow.emit('restore');
  mainWindow.visible = false;
  mainWindow.emit('hide');

  assert.deepEqual(modes, [
    DEVICE_CENTER_ACTIVITY_MODES.BACKGROUND,
    DEVICE_CENTER_ACTIVITY_MODES.FOREGROUND,
    DEVICE_CENTER_ACTIVITY_MODES.BACKGROUND,
    DEVICE_CENTER_ACTIVITY_MODES.FOREGROUND,
    DEVICE_CENTER_ACTIVITY_MODES.BACKGROUND
  ]);
});

test('events from a replaced window cannot change the current cadence', () => {
  const modes = [];
  const oldWindow = new FakeWindow({ visible: true });
  const currentWindow = new FakeWindow({ visible: true });
  let mainWindow = oldWindow;
  const controller = createNexaDeviceCenterActivityController({
    getComposition: () => ({ deviceCenterApplication: { setActivityMode(mode) { modes.push(mode); return true; } } }),
    getMainWindow: () => mainWindow
  });
  controller.bind(oldWindow);
  mainWindow = currentWindow;
  controller.bind(currentWindow);
  oldWindow.visible = false;
  oldWindow.emit('hide');
  assert.deepEqual(modes, ['foreground', 'foreground']);
});

test('composition without the optional cadence extension is a safe no-op', () => {
  const mainWindow = new FakeWindow({ visible: true });
  const controller = createNexaDeviceCenterActivityController({
    getComposition: () => ({ deviceCenterApplication: {} }),
    getMainWindow: () => mainWindow
  });
  assert.deepEqual(controller.sync(), { applied: false, mode: 'foreground', changed: false });
});

test('cadence errors expose only a bounded code to the host logger', () => {
  const seen = [];
  const mainWindow = new FakeWindow({ visible: true });
  const controller = createNexaDeviceCenterActivityController({
    getComposition: () => ({ deviceCenterApplication: { setActivityMode() { throw new Error('C:\\private\\secret'); } } }),
    getMainWindow: () => mainWindow,
    onError: (code) => seen.push(code)
  });
  assert.equal(controller.sync().applied, false);
  assert.deepEqual(seen, ['DEVICE_CENTER_ACTIVITY_SYNC_FAILED']);
});

test('main wires the activity controller before window reveal and after composition load', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /nexaDeviceCenterActivityController\.bind\(win\)/);
  assert.match(source, /nexaAppComposition = composition;\s*nexaDeviceCenterActivityController\.sync\(\)/);
});
