'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { readWindowsGenericCredentials } = require('../../src/shared/windowsCredentialManager');

test('Windows credential reader returns only requested generic credential values', () => {
  const stored = {
    'NEXA/DNSPod/SecretId': 'id-value',
    'NEXA/DNSPod/SecretKey': 'key-value'
  };
  const encoded = Buffer.from(JSON.stringify(stored), 'utf8').toString('base64');
  const result = readWindowsGenericCredentials(Object.keys(stored), {
    platform: 'win32',
    spawn: (_file, args) => {
      assert.equal(args.includes('id-value'), false);
      assert.equal(args.includes('key-value'), false);
      return { status: 0, stdout: Buffer.from(encoded), stderr: Buffer.alloc(0) };
    }
  });

  assert.deepEqual(result, stored);
});

test('Windows credential reader fails closed outside Windows and on missing targets', () => {
  assert.equal(readWindowsGenericCredentials(['target'], { platform: 'linux' }), null);
  assert.equal(readWindowsGenericCredentials(['target'], {
    platform: 'win32',
    spawn: () => ({ status: 3, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
  }), null);
});
