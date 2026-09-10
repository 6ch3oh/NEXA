'use strict';

/* global DataTransfer, DragEvent, document */

const bridge = window.tokenMonitor.nexa['local-resource-path'];
const result = document.getElementById('result');
const diskFiles = document.getElementById('diskFiles');
const dropZone = document.getElementById('dropZone');

document.getElementById('runtimeSecurity').textContent = [
  `renderer process: ${typeof window.process}`,
  `renderer require: ${typeof window.require}`,
  `bridge frozen: ${Object.isFrozen(bridge)}`
].join(' · ');

async function show(promise) {
  const value = await promise;
  result.textContent = JSON.stringify(value, null, 2);
  return value;
}

document.getElementById('filePicker').addEventListener('click', () => {
  void show(bridge.selectFiles());
});
document.getElementById('directoryPicker').addEventListener('click', () => {
  void show(bridge.selectDirectory());
});
dropZone.addEventListener('dragover', (event) => event.preventDefault());
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  void show(bridge.resolveDroppedResources([...event.dataTransfer.files]));
});
document.getElementById('simulateDrop').addEventListener('click', () => {
  const transfer = new DataTransfer();
  for (const file of diskFiles.files) transfer.items.add(file);
  dropZone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
});
document.getElementById('shutdown').addEventListener('click', () => window.tokenMonitor.close());
