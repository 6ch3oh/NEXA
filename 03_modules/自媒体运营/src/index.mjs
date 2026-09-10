import {
  CREATOR_OPS_UI_HOST_STATES,
  CREATOR_OPS_UI_HOST_OWNERSHIP_CONTRACT_VERSION,
  CreatorOpsHostError,
  CreatorOpsUIHostFacade,
  createCreatorOpsController,
  createCreatorOpsUIHost,
} from './core-integration/creatorOpsHostFacade.mjs';
import {
  CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
  CREATOR_OPS_HOME_WIDGET_WINDOWS,
  createCreatorOpsHomeWidgetAdapter,
} from './presentation/creatorOpsHomeWidgetAdapter.mjs';

export const CREATOR_OPS_AUTHORITATIVE_PUBLIC_ENTRYPOINT = 'src/index.mjs';
export const CREATOR_OPS_PUBLIC_API_VERSION = '0.2';
export const CREATOR_OPS_UI_HOST_CONTRACT_VERSION = '1.0';
export const CREATOR_OPS_MODULE_ID = 'creator-ops';
export const CREATOR_OPS_ROUTE_ID = 'creator-ops';
export const CREATOR_OPS_APPLICATION_FACTORY = 'creator_ops.create_creator_ops_application';

export const CREATOR_OPS_MODULE_DESCRIPTOR = Object.freeze({
  contractVersion: 1,
  moduleId: CREATOR_OPS_MODULE_ID,
  invokeChannels: Object.freeze([]),
  pushChannels: Object.freeze([]),
});

export const CREATOR_OPS_INTEGRATION_MANIFEST = Object.freeze({
  contractVersion: 1,
  publicApiVersion: CREATOR_OPS_PUBLIC_API_VERSION,
  moduleId: CREATOR_OPS_MODULE_ID,
  routeId: CREATOR_OPS_ROUTE_ID,
  authoritativeEntrypoint: CREATOR_OPS_AUTHORITATIVE_PUBLIC_ENTRYPOINT,
  applicationFactory: CREATOR_OPS_APPLICATION_FACTORY,
  uiHostFactory: 'createCreatorOpsUIHost',
  uiHostContractVersion: CREATOR_OPS_UI_HOST_CONTRACT_VERSION,
  capabilities: Object.freeze([
    'local-ui', 'dashboard', 'work-queue', 'content-detail', 'health', 'recovery', 'home-widget', 'local-works-v0.1',
  ]),
  homeWidget: Object.freeze({
    contractVersion: CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
    factory: 'createCreatorOpsHomeWidgetAdapter',
    operation: 'getHomeSummary',
    mode: 'READ_ONLY',
    preferredSlot: 'activity',
    defaultWindowDays: 30,
    supportedWindows: CREATOR_OPS_HOME_WIDGET_WINDOWS,
    writeCapability: 'NONE',
  }),
  lifecycle: Object.freeze({
    states: Object.freeze(['CREATED', 'STARTING', 'READY', 'STOPPING', 'STOPPED', 'ERROR']),
    create: 'createCreatorOpsUIHost',
    start: 'start',
    readiness: 'getReadiness',
    stop: 'stop',
  }),
  ownership: Object.freeze({
    contractVersion: CREATOR_OPS_UI_HOST_OWNERSHIP_CONTRACT_VERSION,
    model: 'CREATOR_OPS_UI_HOST_OWNERSHIP_V0_1',
    readiness: 'AUTHENTICATED_OWNER_TOKEN_GENERATION_ENDPOINT',
    shutdown: 'OWNED_CHILD_ONLY',
    portPolicy: 'EXCLUSIVE_FIXED_LOOPBACK',
  }),
  readiness: Object.freeze({
    machineReadable: true,
    requiredFields: Object.freeze([
      'contractVersion', 'state', 'ready', 'errorCode', 'message', 'endpoint',
      'runtimeInstanceCount', 'generation',
    ]),
  }),
  endpoint: Object.freeze({
    policy: 'FACTORY_RETURNED_LOOPBACK',
    defaultHost: '127.0.0.1',
    defaultPort: 8765,
  }),
  securityBoundary: Object.freeze({
    loopbackOnly: true,
    externalNetwork: 'NONE',
    automaticPublishing: 'NONE',
    coreDatabaseAccess: 'NONE',
    coreRepositoryAccess: 'NONE',
    stdoutProtocol: 'NONE',
  }),
});

export {
  CREATOR_OPS_HOME_WIDGET_CONTRACT_VERSION,
  CREATOR_OPS_HOME_WIDGET_WINDOWS,
  CREATOR_OPS_UI_HOST_OWNERSHIP_CONTRACT_VERSION,
  CREATOR_OPS_UI_HOST_STATES,
  CreatorOpsHostError,
  CreatorOpsUIHostFacade,
  createCreatorOpsHomeWidgetAdapter,
  createCreatorOpsController,
  createCreatorOpsUIHost,
};
