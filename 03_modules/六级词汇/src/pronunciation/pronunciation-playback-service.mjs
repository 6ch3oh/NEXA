import { isAbsolute } from 'node:path';
import { DEFAULT_PRONUNCIATION_ACCENT, PronunciationAccent } from '../adapters/pronunciation-contract.mjs';
import { createPronunciationCacheKey } from './pronunciation-cache.mjs';

export const PRONUNCIATION_PLAYBACK_SERVICE_VERSION = '0.1';

export function createPronunciationPlaybackService({ cache, ttsAdapter, localAudioResolver = () => null, voiceSelector }) {
  if (typeof cache?.lookup !== 'function' || typeof cache?.put !== 'function') throw new TypeError('pronunciation cache required');
  if (typeof ttsAdapter?.synthesize !== 'function' || typeof ttsAdapter?.supports !== 'function') throw new TypeError('local TTS adapter required');
  if (typeof localAudioResolver !== 'function' || typeof voiceSelector !== 'function') throw new TypeError('resolver functions required');

  async function resolve({ word, accent = DEFAULT_PRONUNCIATION_ACCENT }) {
    requireRequest(word, accent);
    const localAssetRef = await localAudioResolver({ word, accent });
    if (localAssetRef !== null) {
      if (typeof localAssetRef !== 'string' || !isAbsolute(localAssetRef)) throw new TypeError('local audio resolver must return an absolute path or null');
      return Object.freeze({ ok: true, source: 'LOCAL_REAL_AUDIO', word, accent, localAssetRef, generated: false });
    }
    const voice = voiceSelector({ word, accent });
    if (!voice) return unavailable(word, accent, 'LOCAL_TTS_VOICE_UNAVAILABLE');
    const identity = { word, accent, voiceId: voice.voiceId, voiceVersion: voice.voiceVersion };
    const cached = await cache.lookup(identity);
    if (cached) return Object.freeze({ ok: true, source: 'LOCAL_TTS_CACHE', word, accent, localAssetRef: cached.localAssetRef, generated: false, cacheKey: cached.key });
    if (!ttsAdapter.supports(accent)) return unavailable(word, accent, 'LOCAL_TTS_RUNTIME_UNAVAILABLE');
    const generated = await ttsAdapter.synthesize({ word, accent, voiceId: voice.voiceId });
    if (!generated.ok) return generated;
    const record = await cache.put(identity, {
      sourcePath: generated.localAssetRef,
      createdAt: generated.createdAt,
      sourceType: generated.sourceType ?? 'LOCAL_TTS',
      audioMetadata: generated.audioMetadata ?? {},
    });
    return Object.freeze({ ok: true, source: 'LOCAL_TTS_GENERATED', word, accent, localAssetRef: record.localAssetRef, generated: true, cacheKey: createPronunciationCacheKey(identity) });
  }
  return Object.freeze({ serviceVersion: PRONUNCIATION_PLAYBACK_SERVICE_VERSION, resolve });
}

function requireRequest(word, accent) {
  if (typeof word !== 'string' || word.trim() === '') throw new TypeError('word required');
  if (!Object.values(PronunciationAccent).includes(accent)) throw new TypeError('supported accent required');
}
function unavailable(word, accent, code) {
  return Object.freeze({ ok: false, word, accent, source: 'UNAVAILABLE', onlineFallback: false, error: { code, message: 'no licensed local pronunciation source is available' } });
}
