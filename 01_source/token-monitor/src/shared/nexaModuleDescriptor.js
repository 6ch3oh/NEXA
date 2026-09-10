'use strict';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CHANNEL_ACTION_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*(?::[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)*$/;
const DESCRIPTOR_KEYS = ['contractVersion', 'invokeChannels', 'moduleId', 'pushChannels'];
const CHANNEL_FIELDS = ['invokeChannels', 'pushChannels'];

class NexaModuleDescriptorValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NexaModuleDescriptorValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NexaModuleDescriptorValidationError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateContext(context) {
  if (!isPlainObject(context) || !Array.isArray(context.reservedChannels)) {
    fail('INVALID_VALIDATION_CONTEXT', 'validation context must explicitly provide a reservedChannels array');
  }

  const reservedChannels = new Set();
  for (const channel of context.reservedChannels) {
    if (typeof channel !== 'string' || channel.length === 0 || channel.trim() !== channel) {
      fail('INVALID_VALIDATION_CONTEXT', 'reservedChannels must contain non-empty untrimmed strings');
    }
    if (reservedChannels.has(channel)) {
      fail('INVALID_VALIDATION_CONTEXT', `reservedChannels contains a duplicate channel: ${channel}`);
    }
    reservedChannels.add(channel);
  }
  return reservedChannels;
}

function validateDescriptorShape(descriptor) {
  if (!isPlainObject(descriptor)) {
    fail('INVALID_DESCRIPTOR', 'descriptor must be a plain object');
  }

  const keys = Object.keys(descriptor).sort();
  if (keys.length !== DESCRIPTOR_KEYS.length || keys.some((key, index) => key !== DESCRIPTOR_KEYS[index])) {
    fail('INVALID_DESCRIPTOR', `descriptor fields must be exactly: ${DESCRIPTOR_KEYS.join(', ')}`);
  }

  if (typeof descriptor.moduleId !== 'string' || !MODULE_ID_PATTERN.test(descriptor.moduleId)) {
    fail('INVALID_MODULE_ID', 'moduleId must match ^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$');
  }

  if (descriptor.contractVersion !== 1) {
    fail('INVALID_CONTRACT_VERSION', 'contractVersion must be the integer 1');
  }

  for (const field of CHANNEL_FIELDS) {
    if (!Array.isArray(descriptor[field])) {
      fail('INVALID_DESCRIPTOR', `${field} must be an array`);
    }
  }
}

function validateChannel(channel, moduleId, reservedChannels) {
  if (typeof channel !== 'string' || channel.length === 0 || channel.trim() !== channel) {
    fail('INVALID_CHANNEL', 'channels must be non-empty untrimmed strings');
  }
  if (reservedChannels.has(channel)) {
    fail('RESERVED_CHANNEL_COLLISION', `channel is reserved: ${channel}`);
  }
  if (!channel.startsWith('nexa:')) {
    fail('INVALID_CHANNEL', `channel must use the nexa namespace: ${channel}`);
  }

  const expectedPrefix = `nexa:${moduleId}:`;
  if (!channel.startsWith(expectedPrefix)) {
    fail('CHANNEL_PREFIX_MISMATCH', `channel must use prefix ${expectedPrefix}: ${channel}`);
  }

  const action = channel.slice(expectedPrefix.length);
  if (!CHANNEL_ACTION_PATTERN.test(action)) {
    fail('INVALID_CHANNEL', `channel action is invalid: ${channel}`);
  }
}

function validateDescriptorWithReservedChannels(descriptor, reservedChannels) {
  validateDescriptorShape(descriptor);

  const seenChannels = new Set();
  for (const field of CHANNEL_FIELDS) {
    for (const channel of descriptor[field]) {
      if (typeof channel === 'string' && seenChannels.has(channel)) {
        fail('DUPLICATE_CHANNEL', `descriptor contains a duplicate channel: ${channel}`);
      }
      validateChannel(channel, descriptor.moduleId, reservedChannels);
      seenChannels.add(channel);
    }
  }

  return {
    moduleId: descriptor.moduleId,
    contractVersion: descriptor.contractVersion,
    invokeChannels: [...descriptor.invokeChannels],
    pushChannels: [...descriptor.pushChannels]
  };
}

function validateNexaModuleDescriptor(descriptor, context) {
  const reservedChannels = validateContext(context);
  return validateDescriptorWithReservedChannels(descriptor, reservedChannels);
}

function validateNexaModuleDescriptors(descriptors, context) {
  const reservedChannels = validateContext(context);
  if (!Array.isArray(descriptors)) {
    fail('INVALID_DESCRIPTOR_SET', 'descriptors must be an array');
  }

  const moduleIds = new Set();
  const channels = new Set();
  for (const descriptor of descriptors) {
    validateDescriptorShape(descriptor);
    if (moduleIds.has(descriptor.moduleId)) {
      fail('DUPLICATE_MODULE_ID', `duplicate moduleId: ${descriptor.moduleId}`);
    }
    moduleIds.add(descriptor.moduleId);

    for (const field of CHANNEL_FIELDS) {
      for (const channel of descriptor[field]) {
        if (typeof channel === 'string' && channels.has(channel)) {
          fail('DUPLICATE_CHANNEL', `duplicate channel across descriptors: ${channel}`);
        }
        if (typeof channel === 'string') channels.add(channel);
      }
    }
  }

  return descriptors.map((descriptor) => validateDescriptorWithReservedChannels(descriptor, reservedChannels));
}

module.exports = {
  NexaModuleDescriptorValidationError,
  validateNexaModuleDescriptor,
  validateNexaModuleDescriptors
};
