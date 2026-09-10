'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntimeBundle, defaultWave008RuntimeBundle } = require('../../src/electron/mobileRuntimeBundle');

test('versioned runtime bundle declares hashes and only allowed non-executable resources', () => {
  const bundle = defaultWave008RuntimeBundle();
  assert.equal(bundle.manifest.manifest_version, 1); assert.equal(bundle.manifest.bundle_version, 1);
  assert.equal(bundle.manifest.resources.length, 5);
  for (const item of bundle.manifest.resources) assert.match(item.sha256, /^[a-f0-9]{64}$/u);
});

test('runtime bundle rejects executable and undeclared resource types', () => {
  assert.throws(() => createRuntimeBundle({ version: 1, resources: { 'code/classes.dex': { type: 'LOCAL_DATA', content: 'x' } } }), { code: 'RUNTIME_RESOURCE_REJECTED' });
  assert.throws(() => createRuntimeBundle({ version: 1, resources: { 'data/value.json': { type: 'EXECUTABLE', content: '{}' } } }), { code: 'RUNTIME_RESOURCE_REJECTED' });
});
