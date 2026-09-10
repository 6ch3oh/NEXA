'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  NexaModuleDescriptorValidationError,
  validateNexaModuleDescriptor,
  validateNexaModuleDescriptors
} = require('../../src/shared/nexaModuleDescriptor');

const EMPTY_CONTEXT = Object.freeze({ reservedChannels: Object.freeze([]) });

function descriptor(moduleId = 'example', overrides = {}) {
  return {
    moduleId,
    contractVersion: 1,
    invokeChannels: [`nexa:${moduleId}:get`],
    pushChannels: [],
    ...overrides
  };
}

function expectCode(callback, code) {
  assert.throws(
    callback,
    (error) => error instanceof NexaModuleDescriptorValidationError && error.code === code,
    `expected descriptor validation error code ${code}`
  );
}

test('accepts a minimal v1 descriptor and returns an independent validated copy', () => {
  const input = descriptor();
  const result = validateNexaModuleDescriptor(input, EMPTY_CONTEXT);

  assert.deepEqual(result, input);
  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.invokeChannels, input.invokeChannels);
  assert.notStrictEqual(result.pushChannels, input.pushChannels);
});

test('accepts multiple descriptors and an empty descriptor set', () => {
  assert.deepEqual(validateNexaModuleDescriptors([], EMPTY_CONTEXT), []);

  const inputs = [descriptor('alpha'), descriptor('beta')];
  const results = validateNexaModuleDescriptors(inputs, EMPTY_CONTEXT);
  assert.deepEqual(results, inputs);
  assert.notStrictEqual(results, inputs);
});

test('accepts multiple static invoke and push channels from the contract shape', () => {
  const input = descriptor('usage-view', {
    invokeChannels: [
      'nexa:usage-view:getSnapshot',
      'nexa:usage-view:execute',
      'nexa:usage-view:v2:refresh-now'
    ],
    pushChannels: ['nexa:usage-view:changed']
  });

  assert.deepEqual(validateNexaModuleDescriptor(input, EMPTY_CONTEXT), input);
});

test('rejects malformed descriptor containers and unknown fields', () => {
  for (const input of [null, [], 'example', 1, () => {}]) {
    expectCode(() => validateNexaModuleDescriptor(input, EMPTY_CONTEXT), 'INVALID_DESCRIPTOR');
  }
  expectCode(
    () => validateNexaModuleDescriptor({ ...descriptor(), controller: () => {} }, EMPTY_CONTEXT),
    'INVALID_DESCRIPTOR'
  );
  expectCode(
    () => validateNexaModuleDescriptor({ ...descriptor(), pushChannels: undefined }, EMPTY_CONTEXT),
    'INVALID_DESCRIPTOR'
  );
});

test('moduleId is fail-closed to lowercase ASCII kebab-case', () => {
  const invalidModuleIds = [
    '',
    ' Example',
    'example ',
    'Example',
    'example module',
    'example:module',
    'example/module',
    'example\\module',
    'example..module',
    'example--module',
    '-example',
    'example-',
    '\u0000example',
    42,
    null
  ];

  for (const moduleId of invalidModuleIds) {
    expectCode(() => validateNexaModuleDescriptor(descriptor(moduleId), EMPTY_CONTEXT), 'INVALID_MODULE_ID');
  }
});

test('contractVersion accepts only the integer v1 contract', () => {
  assert.equal(validateNexaModuleDescriptor(descriptor(), EMPTY_CONTEXT).contractVersion, 1);

  for (const contractVersion of [undefined, null, 0, 2, '1', '0.39.0', 1.0 + Number.EPSILON]) {
    expectCode(
      () => validateNexaModuleDescriptor(descriptor('example', { contractVersion }), EMPTY_CONTEXT),
      'INVALID_CONTRACT_VERSION'
    );
  }
});

test('requires explicit invokeChannels and pushChannels arrays', () => {
  const missingInvoke = descriptor();
  delete missingInvoke.invokeChannels;
  expectCode(() => validateNexaModuleDescriptor(missingInvoke, EMPTY_CONTEXT), 'INVALID_DESCRIPTOR');

  const missingPush = descriptor();
  delete missingPush.pushChannels;
  expectCode(() => validateNexaModuleDescriptor(missingPush, EMPTY_CONTEXT), 'INVALID_DESCRIPTOR');

  expectCode(
    () => validateNexaModuleDescriptor(descriptor('example', { invokeChannels: 'nexa:example:get' }), EMPTY_CONTEXT),
    'INVALID_DESCRIPTOR'
  );
});

test('rejects non-nexa channels and channels with the wrong module prefix', () => {
  expectCode(
    () => validateNexaModuleDescriptor(descriptor('example', { invokeChannels: ['settings:get'] }), EMPTY_CONTEXT),
    'INVALID_CHANNEL'
  );
  expectCode(
    () => validateNexaModuleDescriptor(descriptor('example', { invokeChannels: ['nexa:sibling:get'] }), EMPTY_CONTEXT),
    'CHANNEL_PREFIX_MISMATCH'
  );
});

test('rejects empty, wildcard, path-like, dotted, trimmed, and non-string channel actions', () => {
  const invalidChannels = [
    'nexa:example:',
    'nexa:example:*',
    'nexa:example:get*',
    'nexa:example:../get',
    'nexa:example:get/path',
    'nexa:example:get\\path',
    'nexa:example:get.value',
    ' nexa:example:get',
    'nexa:example:get ',
    42,
    () => 'nexa:example:get'
  ];

  for (const channel of invalidChannels) {
    expectCode(
      () => validateNexaModuleDescriptor(descriptor('example', { invokeChannels: [channel] }), EMPTY_CONTEXT),
      'INVALID_CHANNEL'
    );
  }
});

test('rejects duplicate channels within and across descriptor channel categories', () => {
  expectCode(
    () => validateNexaModuleDescriptor(descriptor('example', {
      invokeChannels: ['nexa:example:get', 'nexa:example:get']
    }), EMPTY_CONTEXT),
    'DUPLICATE_CHANNEL'
  );
  expectCode(
    () => validateNexaModuleDescriptor(descriptor('example', {
      invokeChannels: ['nexa:example:get'],
      pushChannels: ['nexa:example:get']
    }), EMPTY_CONTEXT),
    'DUPLICATE_CHANNEL'
  );
});

test('requires an explicit, valid validation context', () => {
  expectCode(() => validateNexaModuleDescriptor(descriptor()), 'INVALID_VALIDATION_CONTEXT');
  expectCode(() => validateNexaModuleDescriptor(descriptor(), {}), 'INVALID_VALIDATION_CONTEXT');
  expectCode(
    () => validateNexaModuleDescriptor(descriptor(), { reservedChannels: 'settings:get' }),
    'INVALID_VALIDATION_CONTEXT'
  );
  expectCode(
    () => validateNexaModuleDescriptor(descriptor(), { reservedChannels: ['settings:get', 'settings:get'] }),
    'INVALID_VALIDATION_CONTEXT'
  );
  expectCode(
    () => validateNexaModuleDescriptor(descriptor(), { reservedChannels: [42] }),
    'INVALID_VALIDATION_CONTEXT'
  );
});

test('rejects reserved legacy and NEXA channel collisions', () => {
  expectCode(
    () => validateNexaModuleDescriptor(
      descriptor('example', { invokeChannels: ['settings:get'] }),
      { reservedChannels: ['settings:get'] }
    ),
    'RESERVED_CHANNEL_COLLISION'
  );
  expectCode(
    () => validateNexaModuleDescriptor(
      descriptor('example'),
      { reservedChannels: ['nexa:example:get'] }
    ),
    'RESERVED_CHANNEL_COLLISION'
  );
});

test('set validation rejects malformed sets and items', () => {
  for (const inputs of [null, {}, 'example']) {
    expectCode(() => validateNexaModuleDescriptors(inputs, EMPTY_CONTEXT), 'INVALID_DESCRIPTOR_SET');
  }
  expectCode(() => validateNexaModuleDescriptors([null], EMPTY_CONTEXT), 'INVALID_DESCRIPTOR');
});

test('set validation rejects duplicate moduleId values', () => {
  expectCode(
    () => validateNexaModuleDescriptors([descriptor('example'), descriptor('example')], EMPTY_CONTEXT),
    'DUPLICATE_MODULE_ID'
  );
});

test('set validation rejects duplicate channels across modules before prefix routing', () => {
  expectCode(
    () => validateNexaModuleDescriptors([
      descriptor('alpha'),
      descriptor('beta', { invokeChannels: ['nexa:alpha:get'] })
    ], EMPTY_CONTEXT),
    'DUPLICATE_CHANNEL'
  );
});

test('set validation rejects a module using a sibling module channel prefix', () => {
  expectCode(
    () => validateNexaModuleDescriptors([
      descriptor('alpha', { invokeChannels: ['nexa:beta:inspect'] }),
      descriptor('beta')
    ], EMPTY_CONTEXT),
    'CHANNEL_PREFIX_MISMATCH'
  );
});

test('validation does not mutate descriptors or validation context', () => {
  const input = descriptor('immutable', {
    invokeChannels: ['nexa:immutable:getSnapshot', 'nexa:immutable:execute'],
    pushChannels: ['nexa:immutable:changed']
  });
  const context = { reservedChannels: ['settings:get', 'stats:get'] };
  const inputSnapshot = JSON.stringify(input);
  const contextSnapshot = JSON.stringify(context);

  const validated = validateNexaModuleDescriptor(input, context);
  const validatedSet = validateNexaModuleDescriptors([input], context);

  assert.equal(JSON.stringify(input), inputSnapshot);
  assert.equal(JSON.stringify(context), contextSnapshot);
  assert.deepEqual(validated, input);
  assert.deepEqual(validatedSet, [input]);
});
