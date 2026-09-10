'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLocalSpeechToTextProvider } = require('../../src/electron/localSpeechToTextProvider');

test('missing local STT stays provider-ready without cloud fallback or download', async () => {
  const provider = createLocalSpeechToTextProvider();
  assert.deepEqual(provider.getState().status, 'provider_ready_gap');
  assert.equal(provider.getState().local_only, true);
  assert.equal(provider.getState().cloud_allowed, false);
  await assert.rejects(provider.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' }), (error) => error.code === 'STT_PROVIDER_UNAVAILABLE');
});

test('local provider returns a bounded editable transcript', async () => {
  const provider = createLocalSpeechToTextProvider({ engine: 'fixture-local', transcribeImpl: async () => ' 打开设备中心 ' });
  assert.deepEqual(await provider.transcribe({ bytes: new Uint8Array([1, 2]), mimeType: 'audio/webm' }), { transcript: '打开设备中心', engine: 'fixture-local', local_only: true });
});
