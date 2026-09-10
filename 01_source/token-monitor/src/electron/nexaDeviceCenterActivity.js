'use strict';

const DEVICE_CENTER_ACTIVITY_MODES = Object.freeze({
  FOREGROUND: 'foreground',
  BACKGROUND: 'background'
});

function deviceCenterActivityModeForWindow(targetWindow) {
  if (!targetWindow ||
      typeof targetWindow.isDestroyed !== 'function' || targetWindow.isDestroyed() ||
      typeof targetWindow.isVisible !== 'function' || !targetWindow.isVisible() ||
      typeof targetWindow.isMinimized !== 'function' || targetWindow.isMinimized()) {
    return DEVICE_CENTER_ACTIVITY_MODES.BACKGROUND;
  }
  return DEVICE_CENTER_ACTIVITY_MODES.FOREGROUND;
}

function createNexaDeviceCenterActivityController(options = {}) {
  if (typeof options.getComposition !== 'function' || typeof options.getMainWindow !== 'function') {
    throw new TypeError('Device Center activity controller requires composition and window readers');
  }
  const onError = typeof options.onError === 'function' ? options.onError : () => {};
  const boundWindows = new WeakSet();

  function sync(targetWindow = options.getMainWindow()) {
    const mainWindow = options.getMainWindow();
    if (targetWindow !== mainWindow) {
      return Object.freeze({ applied: false, mode: null, changed: false });
    }
    const mode = targetWindow
      ? deviceCenterActivityModeForWindow(targetWindow)
      : DEVICE_CENTER_ACTIVITY_MODES.BACKGROUND;
    const application = options.getComposition()?.deviceCenterApplication;
    if (typeof application?.setActivityMode !== 'function') {
      return Object.freeze({ applied: false, mode, changed: false });
    }
    try {
      const changed = application.setActivityMode(mode) === true;
      return Object.freeze({ applied: true, mode, changed });
    } catch (error) {
      onError(error?.code || 'DEVICE_CENTER_ACTIVITY_SYNC_FAILED');
      return Object.freeze({ applied: false, mode, changed: false });
    }
  }

  function bind(targetWindow) {
    if (!targetWindow || typeof targetWindow.on !== 'function' || boundWindows.has(targetWindow)) return false;
    boundWindows.add(targetWindow);
    for (const eventName of ['show', 'hide', 'minimize', 'restore']) {
      targetWindow.on(eventName, () => { sync(targetWindow); });
    }
    sync(targetWindow);
    return true;
  }

  return Object.freeze({ bind, sync });
}

module.exports = {
  DEVICE_CENTER_ACTIVITY_MODES,
  createNexaDeviceCenterActivityController,
  deviceCenterActivityModeForWindow
};
