export const CONSUMPTION_MODULE_ID = 'consumption';
export const CONSUMPTION_DESCRIPTOR_CONTRACT_VERSION = 1;

export const CONSUMPTION_IPC_CHANNELS = Object.freeze({
  getSnapshot: 'nexa:consumption:get-snapshot',
  execute: 'nexa:consumption:execute',
});

export const CONSUMPTION_MODULE_DESCRIPTOR = Object.freeze({
  moduleId: CONSUMPTION_MODULE_ID,
  contractVersion: CONSUMPTION_DESCRIPTOR_CONTRACT_VERSION,
  invokeChannels: Object.freeze([
    CONSUMPTION_IPC_CHANNELS.getSnapshot,
    CONSUMPTION_IPC_CHANNELS.execute,
  ]),
  pushChannels: Object.freeze([]),
});
