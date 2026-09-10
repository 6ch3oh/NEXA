import {
  DEFAULT_PRONUNCIATION_ACCENT,
  PronunciationAccent,
} from '../adapters/pronunciation-contract.mjs';

export const PRONUNCIATION_PLAYBACK_VERSION = '0.1';

export const PronunciationPlaybackSource = Object.freeze({
  LOCAL_AUDIO: 'LOCAL_AUDIO',
  LOCAL_TTS_FALLBACK: 'LOCAL_TTS_FALLBACK',
  UNAVAILABLE: 'UNAVAILABLE',
});

export function createPronunciationCapability(pronunciationSet, accent = DEFAULT_PRONUNCIATION_ACCENT) {
  if (!Object.values(PronunciationAccent).includes(accent)) throw new TypeError(`unsupported accent: ${accent}`);
  const pronunciation = pronunciationSet?.entries?.[accent];
  if (!pronunciation) throw new TypeError(`pronunciation entry missing: ${accent}`);
  const hasLocalAudio = pronunciation.audioSource === 'local_asset' && pronunciation.localAssetRef !== null;
  const hasLocalTtsCache = pronunciation.audioSource === 'local_tts_cache' && pronunciation.localAssetRef !== null;
  const canUseLocalTtsFallback = pronunciation.ttsFallbackAllowed === true;
  const preferredSource = hasLocalAudio
    ? PronunciationPlaybackSource.LOCAL_AUDIO
    : hasLocalTtsCache || canUseLocalTtsFallback
      ? PronunciationPlaybackSource.LOCAL_TTS_FALLBACK
      : PronunciationPlaybackSource.UNAVAILABLE;
  return Object.freeze({
    playbackVersion: PRONUNCIATION_PLAYBACK_VERSION,
    accent,
    phonetic: pronunciation.phonetic,
    preferredSource,
    hasLocalAudio,
    hasLocalTtsCache,
    localAssetRef: pronunciation.localAssetRef,
    canUseLocalTtsFallback,
    localTtsRuntimeAvailable: false,
    onlinePlaybackAllowed: false,
  });
}

export function createPronunciationPlaybackRequest({ pronunciationSet, word, accent = DEFAULT_PRONUNCIATION_ACCENT }) {
  if (typeof word !== 'string' || word.trim() === '') throw new TypeError('word required');
  const capability = createPronunciationCapability(pronunciationSet, accent);
  return Object.freeze({
    playbackVersion: PRONUNCIATION_PLAYBACK_VERSION,
    word,
    accent,
    source: capability.preferredSource,
    localAssetRef: capability.localAssetRef,
    cacheGeneratedTts: capability.canUseLocalTtsFallback,
    requiresOnlineService: false,
    executableNow: capability.hasLocalAudio || capability.hasLocalTtsCache,
  });
}
