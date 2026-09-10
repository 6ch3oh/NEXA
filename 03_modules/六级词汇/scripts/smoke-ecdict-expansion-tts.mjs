import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createLocalPronunciationCache,
  createPronunciationPlaybackService,
  createWindowsSapiTtsAdapter,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDirectory = join(moduleRoot, 'data', 'ecdict-qualified');
const library = JSON.parse(await readFile(join(dataDirectory, 'current', 'vocabulary-library.json'), 'utf8'));
assert.equal(library.entries.length, 5_311);
const words = library.entries.slice(100).filter((entry) => /^[a-z][a-z -]{3,12}$/iu.test(entry.headword)).slice(0, 2).map((entry) => entry.headword);
assert.equal(words.length, 2);

const outputDirectory = join(tmpdir(), `nexa-ecdict-expansion-sapi-${process.pid}`);
const adapter = await createWindowsSapiTtsAdapter({ outputDirectory });
const usVoice = adapter.descriptor.voices.find((voice) => voice.accent === 'us');
const ukVoice = adapter.descriptor.voices.find((voice) => voice.accent === 'uk');
assert.ok(usVoice, 'installed en-US Windows SAPI voice required');
assert.ok(ukVoice, 'installed en-GB Windows SAPI voice required');

const cacheDirectory = join(dataDirectory, 'tts-smoke', `run-${process.pid}`);
await mkdir(cacheDirectory, { recursive: true });
const cache = createLocalPronunciationCache({ directoryPath: cacheDirectory });
const service = createPronunciationPlaybackService({
  cache,
  ttsAdapter: adapter,
  localAudioResolver: () => null,
  voiceSelector: ({ accent }) => {
    const voice = adapter.descriptor.voices.find((candidate) => candidate.accent === accent);
    return voice ? { voiceId: voice.voiceId, voiceVersion: voice.voiceVersion } : null;
  },
});

const cases = [];
for (const word of words) {
  const byAccent = {};
  for (const accent of ['us', 'uk']) {
    const first = await service.resolve({ word, accent });
    const second = await service.resolve({ word, accent });
    assert.equal(first.ok, true);
    assert.equal(first.source, 'LOCAL_TTS_GENERATED');
    assert.equal(second.source, 'LOCAL_TTS_CACHE');
    const wav = await readFile(first.localAssetRef);
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.ok(wav.length > 44);
    byAccent[accent] = { bytes: wav.length, firstSource: first.source, secondSource: second.source, cacheKey: first.cacheKey };
  }
  assert.notEqual(byAccent.us.cacheKey, byAccent.uk.cacheKey);
  cases.push({ word, ...byAccent });
}

const result = {
  status: 'PASS',
  collectionCount: library.entries.length,
  testedWordsOutsideOriginalPilot: words,
  defaultAccent: 'us',
  usVoice: usVoice.displayName,
  ukVoice: ukVoice.displayName,
  onDemandGeneration: 'PASS',
  cacheHit: 'PASS',
  accentSeparatedCacheKeys: 'PASS',
  batchPreGeneration: false,
  networkTts: false,
  cases,
  cache: await cache.inspect(),
};
await writeFile(join(dataDirectory, 'tts-expansion-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result)}\n`);
