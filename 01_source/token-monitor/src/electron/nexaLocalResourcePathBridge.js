'use strict';

const path = require('node:path');

const PATH_BRIDGE_CONTRACT_VERSION = '0.1';
const MAX_RESOURCE_COUNT = 128;
const REQUEST_KINDS = Object.freeze({
  FILE: 'file',
  FILES: 'files',
  DIRECTORY: 'directory',
  RELOCATE_FILE: 'relocate_file',
  RELOCATE_DIRECTORY: 'relocate_directory',
  EXPLORER_DROP: 'explorer_drop'
});

const NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR = Object.freeze({
  moduleId: 'local-resource-path',
  contractVersion: 1,
  invokeChannels: Object.freeze([
    'nexa:local-resource-path:select',
    'nexa:local-resource-path:resolve-drop'
  ]),
  pushChannels: Object.freeze([])
});

const NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1 = Object.freeze({
  name: 'NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1',
  version: PATH_BRIDGE_CONTRACT_VERSION,
  mode: 'PATH_ONLY',
  authority: 'USER_INTENT_ONLY',
  resourceKinds: Object.freeze(['file', 'directory']),
  requestKinds: Object.freeze(Object.values(REQUEST_KINDS))
});

function envelope(status, requestKind, resources = [], errorCode) {
  return Object.freeze({
    contract_version: PATH_BRIDGE_CONTRACT_VERSION,
    status,
    request_kind: requestKind,
    resources: Object.freeze(resources),
    ...(errorCode ? { error: Object.freeze({ code: errorCode }) } : {})
  });
}

function errorEnvelope(requestKind, code) {
  return envelope('error', requestKind, [], code);
}

function normalizeAbsolutePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || !path.isAbsolute(value)) {
    return null;
  }
  return path.normalize(value);
}

function pickerDefinition(requestKind) {
  switch (requestKind) {
    case REQUEST_KINDS.FILE:
    case REQUEST_KINDS.RELOCATE_FILE:
      return Object.freeze({ kind: 'file', properties: Object.freeze(['openFile']), maximum: 1 });
    case REQUEST_KINDS.FILES:
      return Object.freeze({
        kind: 'file', properties: Object.freeze(['openFile', 'multiSelections']), maximum: MAX_RESOURCE_COUNT
      });
    case REQUEST_KINDS.DIRECTORY:
    case REQUEST_KINDS.RELOCATE_DIRECTORY:
      return Object.freeze({ kind: 'directory', properties: Object.freeze(['openDirectory']), maximum: 1 });
    default:
      return null;
  }
}

function projectPickerResult(requestKind, definition, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      typeof result.canceled !== 'boolean' || !Array.isArray(result.filePaths)) {
    return errorEnvelope(requestKind, 'INVALID_DIALOG_RESPONSE');
  }
  if (result.canceled) return envelope('cancelled', requestKind);
  if (result.filePaths.length === 0 || result.filePaths.length > definition.maximum) {
    return errorEnvelope(requestKind, 'INVALID_DIALOG_RESPONSE');
  }
  const absolutePaths = result.filePaths.map(normalizeAbsolutePath);
  if (absolutePaths.some((value) => value === null) || new Set(absolutePaths).size !== absolutePaths.length) {
    return errorEnvelope(requestKind, 'INVALID_DIALOG_RESPONSE');
  }
  return envelope('selected', requestKind, absolutePaths.map((absolutePath) => Object.freeze({
    kind: definition.kind,
    absolute_path: absolutePath
  })));
}

function createNexaLocalResourcePathController() {
  return Object.freeze({
    start: async () => undefined,
    stop: async () => undefined,
    getSnapshot: () => Object.freeze({
      contractVersion: PATH_BRIDGE_CONTRACT_VERSION,
      mode: 'PATH_ONLY',
      authority: 'USER_INTENT_ONLY'
    }),
    execute: async () => {
      const error = new Error('Local resource paths are available only through user-intent IPC handlers');
      error.code = 'UNSUPPORTED_COMMAND';
      throw error;
    }
  });
}

function createNexaLocalResourcePathIpcHandlers(options = {}) {
  const showOpenDialog = options.showOpenDialog;
  const lstat = options.lstat;

  async function select(event, request) {
    const requestKind = request?.request_kind;
    const definition = pickerDefinition(requestKind);
    if (!definition) return errorEnvelope('unknown', 'INVALID_REQUEST_KIND');
    if (typeof showOpenDialog !== 'function') return errorEnvelope(requestKind, 'PATH_PICKER_UNAVAILABLE');
    try {
      const result = await showOpenDialog(event, { properties: [...definition.properties] });
      return projectPickerResult(requestKind, definition, result);
    } catch {
      return errorEnvelope(requestKind, 'PATH_PICKER_FAILED');
    }
  }

  async function resolveDrop(_event, candidatePaths) {
    if (!Array.isArray(candidatePaths) || candidatePaths.length === 0 ||
        candidatePaths.length > MAX_RESOURCE_COUNT || typeof lstat !== 'function') {
      return errorEnvelope(REQUEST_KINDS.EXPLORER_DROP, 'INVALID_DROP_RESOURCES');
    }
    const absolutePaths = candidatePaths.map(normalizeAbsolutePath);
    if (absolutePaths.some((value) => value === null) || new Set(absolutePaths).size !== absolutePaths.length) {
      return errorEnvelope(REQUEST_KINDS.EXPLORER_DROP, 'INVALID_DROP_RESOURCES');
    }
    try {
      const resources = [];
      for (const absolutePath of absolutePaths) {
        const metadata = await lstat(absolutePath);
        const kind = metadata?.isFile?.() ? 'file' : metadata?.isDirectory?.() ? 'directory' : null;
        if (!kind) return errorEnvelope(REQUEST_KINDS.EXPLORER_DROP, 'UNSUPPORTED_DROP_RESOURCE');
        resources.push(Object.freeze({ kind, absolute_path: absolutePath }));
      }
      return envelope('selected', REQUEST_KINDS.EXPLORER_DROP, resources);
    } catch {
      return errorEnvelope(REQUEST_KINDS.EXPLORER_DROP, 'DROP_RESOURCE_UNAVAILABLE');
    }
  }

  return Object.freeze({
    'nexa:local-resource-path:select': select,
    'nexa:local-resource-path:resolve-drop': resolveDrop
  });
}

module.exports = {
  NEXA_LOCAL_RESOURCE_PATH_BRIDGE_V0_1,
  NEXA_LOCAL_RESOURCE_PATH_DESCRIPTOR,
  PATH_BRIDGE_CONTRACT_VERSION,
  REQUEST_KINDS,
  createNexaLocalResourcePathController,
  createNexaLocalResourcePathIpcHandlers
};
