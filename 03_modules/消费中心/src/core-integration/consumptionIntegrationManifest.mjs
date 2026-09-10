import { fileURLToPath } from 'node:url';

import { createConsumptionController } from './consumptionController.mjs';
import {
  CONSUMPTION_MODULE_DESCRIPTOR,
  CONSUMPTION_MODULE_ID,
} from './consumptionModuleDescriptor.mjs';
import {
  CONSUMPTION_RENDERER_GLOBAL,
  CONSUMPTION_RENDERER_METHODS,
  createConsumptionIpcHandlers,
} from './consumptionIpcContract.mjs';

export {
  CONSUMPTION_MODULE_DESCRIPTOR,
  createConsumptionController,
  createConsumptionIpcHandlers,
};

export const CONSUMPTION_INTEGRATION_MANIFEST_VERSION = '0.4';
export const CONSUMPTION_PUBLIC_API_ENTRY = fileURLToPath(new URL('../index.mjs', import.meta.url));
export const CONSUMPTION_INTEGRATION_PACKAGE_ENTRY = fileURLToPath(import.meta.url);

export const CONSUMPTION_INTEGRATION_MANIFEST = Object.freeze({
  manifestVersion: CONSUMPTION_INTEGRATION_MANIFEST_VERSION,
  moduleId: CONSUMPTION_MODULE_ID,
  packageEntry: CONSUMPTION_INTEGRATION_PACKAGE_ENTRY,
  publicApi: Object.freeze({
    entry: CONSUMPTION_PUBLIC_API_ENTRY,
    version: '0.3',
    exportCount: 36,
    loader: 'native-esm-exact-allowlist',
  }),
  descriptor: CONSUMPTION_MODULE_DESCRIPTOR,
  controllerFactory: Object.freeze({
    module: 'src/core-integration/consumptionIntegrationManifest.mjs',
    export: 'createConsumptionController',
    requiredInjection: 'ExpenseRepository',
  }),
  ipcHandlerFactory: Object.freeze({
    module: 'src/core-integration/consumptionIntegrationManifest.mjs',
    export: 'createConsumptionIpcHandlers',
  }),
  ipcChannels: Object.freeze({
    invoke: Object.freeze([...CONSUMPTION_MODULE_DESCRIPTOR.invokeChannels]),
    push: Object.freeze([]),
  }),
  rendererSurface: Object.freeze({
    global: CONSUMPTION_RENDERER_GLOBAL,
    methods: Object.freeze([...CONSUMPTION_RENDERER_METHODS]),
  }),
  requiredCoreCapabilities: Object.freeze([
    'descriptor-validator-v1',
    'static-module-registry-v1',
    'controller-binding-v1',
    'shell-host-v1',
    'esm-public-api-loader-v1',
    'static-ipc-registration-v1',
    'preload-nexa-host-v1',
  ]),
});
