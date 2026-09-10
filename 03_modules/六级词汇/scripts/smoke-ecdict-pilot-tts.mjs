import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createLocalPronunciationCache,
  createPronunciationPlaybackService,
  createWindowsSapiTtsAdapter,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDirectory = join(moduleRoot, 'data', 'ecdict-pilot');
const normalized = JSON.parse(await readFile(join(moduleRoot, 'staging', 'ecdict-1.0.28', 'cet6-pilot.normalized.json'), 'utf8'));
const normalWords = normalized.filter((entry) => entry.headword.length <= 10).slice(0, 10).map((entry) => entry.headword);
const longWords = normalized.filter((entry) => entry.headword.length >= 13).slice(0, 2).map((entry) => entry.headword);
assert.equal(normalWords.length, 10);
assert.equal(longWords.length, 2);
const words = [...normalWords, ...longWords];
// Windows PowerShell 5.1 can corrupt a non-ASCII output argument. Generate in the ASCII
// system temp path, then copy the verified evidence into this module's local-only data area.
const sapiOutputDirectory = join(tmpdir(), `nexa-ecdict-pilot-sapi-${process.pid}`);
const adapter = await createWindowsSapiTtsAdapter({ outputDirectory: sapiOutputDirectory });
const usVoice = adapter.descriptor.voices.find((voice) => voice.accent === 'us');
const ukVoice = adapter.descriptor.voices.find((voice) => voice.accent === 'uk');
assert.ok(usVoice, 'installed en-US Windows SAPI voice required');
const cache = createLocalPronunciationCache({ directoryPath: join(dataDirectory, 'pronunciation-cache') });
const service = createPronunciationPlaybackService({
  cache,
  ttsAdapter: adapter,
  localAudioResolver: () => null,
  voiceSelector: ({ accent }) => {
    const voice = adapter.descriptor.voices.find((candidate) => candidate.accent === accent);
    return voice ? { voiceId: voice.voiceId, voiceVersion: voice.voiceVersion } : null;
  },
});
const usCases = [];
for (const word of words) {
  const first = await service.resolve({ word, accent: 'us' });
  assert.equal(first.ok, true);
  const wav = await readFile(first.localAssetRef);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.ok(wav.length > 44);
  await mkdir(join(dataDirectory, 'tts-evidence', 'us'), { recursive: true });
  await copyFile(first.localAssetRef, join(dataDirectory, 'tts-evidence', 'us', `${word}.wav`));
  const second = await service.resolve({ word, accent: 'us' });
  assert.equal(second.source, 'LOCAL_TTS_CACHE');
  usCases.push({ word, bytes: wav.length, firstSource: first.source, secondSource: second.source, cacheKey: first.cacheKey });
}
const ukCases = [];
if (ukVoice) {
  for (const word of normalWords) {
    const first = await service.resolve({ word, accent: 'uk' });
    assert.equal(first.ok, true);
    const wav = await readFile(first.localAssetRef);
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.ok(wav.length > 44);
    await mkdir(join(dataDirectory, 'tts-evidence', 'uk'), { recursive: true });
    await copyFile(first.localAssetRef, join(dataDirectory, 'tts-evidence', 'uk', `${word}.wav`));
    const second = await service.resolve({ word, accent: 'uk' });
    assert.equal(second.source, 'LOCAL_TTS_CACHE');
    ukCases.push({ word, bytes: wav.length, firstSource: first.source, secondSource: second.source, cacheKey: first.cacheKey });
  }
  assert.notEqual(usCases[0].cacheKey, ukCases[0].cacheKey);
}
const result = {
  status: 'PASS',
  defaultAccent: 'us',
  voicesEnumeratedAtRuntime: adapter.descriptor.voices,
  us: { status: 'READY', voice: usVoice.displayName, normalWordCount: 10, longWordCount: 2, cases: usCases },
  uk: ukVoice
    ? { status: 'READY', voice: ukVoice.displayName, realWordSmokeCount: ukCases.length, cases: ukCases }
    : { status: 'UK_VOICE_NOT_INSTALLED', realWordSmokeCount: 0, cases: [] },
  cache: await cache.inspect(),
  cacheKeyIncludesAccentAndVoiceIdentity: true,
  accentSeparation: ukCases.length > 0 ? 'PASS' : 'NOT_APPLICABLE',
  dualAccentStatus: usVoice && ukVoice ? 'DUAL_ACCENT_LOCAL_TTS_READY' : 'DUAL_ACCENT_LOCAL_TTS_PARTIAL',
  networkTts: false,
};
await writeFile(join(dataDirectory, 'tts-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result)}\n`);
