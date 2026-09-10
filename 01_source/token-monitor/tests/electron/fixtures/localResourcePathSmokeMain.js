'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const {
  createNexaLocalResourcePathIpcHandlers
} = require('../../../src/electron/nexaLocalResourcePathBridge');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const handlers = createNexaLocalResourcePathIpcHandlers({
    showOpenDialog(event, options) {
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      return dialog.showOpenDialog(parentWindow, options);
    },
    lstat: (absolutePath) => fs.promises.lstat(absolutePath)
  });
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  ipcMain.on('window:close', () => app.quit());

  const window = new BrowserWindow({
    width: 760,
    height: 620,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', '..', 'src', 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const preferences = window.webContents.getLastWebPreferences();
  console.log(JSON.stringify({
    event: 'NEXA_PATH_SMOKE_SECURITY',
    electron: process.versions.electron,
    contextIsolation: preferences.contextIsolation,
    nodeIntegration: preferences.nodeIntegration,
    sandbox: preferences.sandbox
  }));
  window.loadFile(path.join(__dirname, 'localResourcePathSmoke.html'));
});

app.on('window-all-closed', () => app.quit());
