'use strict';

const { validateNexaModuleDescriptors } = require('./nexaModuleDescriptor');

function cloneDescriptor(descriptor) {
  return {
    moduleId: descriptor.moduleId,
    contractVersion: descriptor.contractVersion,
    invokeChannels: [...descriptor.invokeChannels],
    pushChannels: [...descriptor.pushChannels]
  };
}

function freezeDescriptor(descriptor) {
  return Object.freeze({
    moduleId: descriptor.moduleId,
    contractVersion: descriptor.contractVersion,
    invokeChannels: Object.freeze([...descriptor.invokeChannels]),
    pushChannels: Object.freeze([...descriptor.pushChannels])
  });
}

function createNexaModuleRegistry(descriptors, context) {
  const validatedDescriptors = validateNexaModuleDescriptors(descriptors, context);
  const moduleById = new Map(
    validatedDescriptors.map((descriptor) => [descriptor.moduleId, freezeDescriptor(descriptor)])
  );
  const moduleIds = Object.freeze([...moduleById.keys()].sort());
  const invokeChannels = Object.freeze(
    validatedDescriptors.flatMap((descriptor) => descriptor.invokeChannels).sort()
  );
  const pushChannels = Object.freeze(
    validatedDescriptors.flatMap((descriptor) => descriptor.pushChannels).sort()
  );

  return Object.freeze({
    has(moduleId) {
      return typeof moduleId === 'string' && moduleById.has(moduleId);
    },

    get(moduleId) {
      if (typeof moduleId !== 'string') return undefined;
      const descriptor = moduleById.get(moduleId);
      return descriptor ? cloneDescriptor(descriptor) : undefined;
    },

    list() {
      return moduleIds.map((moduleId) => cloneDescriptor(moduleById.get(moduleId)));
    },

    listModuleIds() {
      return [...moduleIds];
    },

    getInvokeChannels() {
      return [...invokeChannels];
    },

    getPushChannels() {
      return [...pushChannels];
    }
  });
}

module.exports = { createNexaModuleRegistry };
