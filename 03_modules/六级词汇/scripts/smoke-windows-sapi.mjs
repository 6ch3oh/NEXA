import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLocalPronunciationCache,
  createPronunciationPlaybackService,
  createWindowsSapiTtsAdapter,
} from '../src/index.mjs';

const directory = await mkdtemp(join(tmpdir(), 'nexa-cet6-sapi-smoke-'));
try {
  const adapter = await createWindowsSapiTtsAdapter({ outputDirectory:join(directory, 'generated') });
  const usVoice = adapter.descriptor.voices.find((candidate) => candidate.accent === 'us');
  const ukVoice = adapter.descriptor.voices.find((candidate) => candidate.accent === 'uk');
  assert.ok(usVoice, 'an installed en-US Windows SAPI voice is required');
  const cache = createLocalPronunciationCache({ directoryPath:join(directory, 'cache') });
  const service = createPronunciationPlaybackService({
    cache,
    ttsAdapter:adapter,
    localAudioResolver:() => null,
    voiceSelector:({ accent }) => {
      const voice = adapter.descriptor.voices.find((candidate) => candidate.accent === accent);
      return voice ? { voiceId:voice.voiceId, voiceVersion:voice.voiceVersion } : null;
    },
  });
  const evidence = [];
  for (const word of ['abandon', 'interdisciplinary', 'VOCABULARY']) {
    const generated = await service.resolve({ word, accent:'us' });
    assert.equal(generated.ok, true);
    const audio = await readFile(generated.localAssetRef);
    assert.equal(audio.subarray(0,4).toString('ascii'), 'RIFF');
    assert.equal(audio.subarray(8,12).toString('ascii'), 'WAVE');
    assert.ok(audio.length > 44);
    evidence.push({ word, source:generated.source, bytes:audio.length, cacheKey:generated.cacheKey });
  }
  const cached = await service.resolve({ word:'abandon', accent:'us' });
  assert.equal(cached.source, 'LOCAL_TTS_CACHE');
  const uk = await service.resolve({ word:'abandon', accent:'uk' });
  if (ukVoice) assert.equal(uk.ok, true); else assert.equal(uk.error.code, 'LOCAL_TTS_VOICE_UNAVAILABLE');
  process.stdout.write(`${JSON.stringify({
    status:'PASS',
    defaultAccent:'us',
    us:{ status:'READY', voice:usVoice.displayName, cases:evidence, secondLookup:cached.source },
    uk:ukVoice ? { status:'READY', voice:ukVoice.displayName } : { status:'PENDING', reason:uk.error.code },
    cache:await cache.inspect(),
  })}\n`);
} finally {
  await rm(directory, { recursive:true, force:true });
}
