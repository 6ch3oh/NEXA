import {
  assertStudyVersion,
  requireStudyObject,
  studyFail,
} from '../study/study-shared.mjs';

export const PRONUNCIATION_CONTRACT_VERSION = '0.1';

export const PronunciationAccent = Object.freeze({
  US: 'us',
  UK: 'uk',
});

export const DEFAULT_PRONUNCIATION_ACCENT = PronunciationAccent.US;

const ACCENTS = new Set(Object.values(PronunciationAccent));
const AUDIO_SOURCES = new Set(['local_asset', 'local_tts_cache', 'none']);

export function createPronunciation(input) {
  requireStudyObject(input, 'pronunciation');
  assertOnlyKeys(input, [
    'contractVersion',
    'accent',
    'phonetic',
    'audioSource',
    'localAssetRef',
    'ttsFallbackAllowed',
  ]);

  const pronunciation = {
    contractVersion: input.contractVersion ?? PRONUNCIATION_CONTRACT_VERSION,
    accent: input.accent,
    phonetic: input.phonetic ?? null,
    audioSource: input.audioSource ?? 'none',
    localAssetRef: input.localAssetRef ?? null,
    ttsFallbackAllowed: input.ttsFallbackAllowed ?? true,
  };
  validatePronunciation(pronunciation);
  return Object.freeze(pronunciation);
}

export function validatePronunciation(input) {
  requireStudyObject(input, 'pronunciation');
  assertStudyVersion(input.contractVersion, PRONUNCIATION_CONTRACT_VERSION);
  if (!ACCENTS.has(input.accent)) {
    studyFail('INVALID_PRONUNCIATION_ACCENT', 'pronunciation.accent', `Unsupported accent: ${input.accent}`);
  }
  if (input.phonetic !== null && (typeof input.phonetic !== 'string' || !input.phonetic.trim())) {
    studyFail('INVALID_PHONETIC', 'pronunciation.phonetic', 'phonetic must be a non-empty string or null');
  }
  if (!AUDIO_SOURCES.has(input.audioSource)) {
    studyFail('INVALID_AUDIO_SOURCE', 'pronunciation.audioSource', `Unsupported audio source: ${input.audioSource}`);
  }
  if (input.localAssetRef !== null && (typeof input.localAssetRef !== 'string' || !input.localAssetRef.trim())) {
    studyFail('INVALID_LOCAL_ASSET_REF', 'pronunciation.localAssetRef', 'localAssetRef must be a non-empty string or null');
  }
  if (typeof input.ttsFallbackAllowed !== 'boolean') {
    studyFail('INVALID_TTS_POLICY', 'pronunciation.ttsFallbackAllowed', 'ttsFallbackAllowed must be boolean');
  }
  return true;
}

export function createPronunciationSet({ us = {}, uk = {}, defaultAccent = DEFAULT_PRONUNCIATION_ACCENT } = {}) {
  if (!ACCENTS.has(defaultAccent)) {
    studyFail('INVALID_PRONUNCIATION_ACCENT', 'defaultAccent', `Unsupported default accent: ${defaultAccent}`);
  }
  const entries = Object.freeze({
    [PronunciationAccent.US]: createPronunciation({ ...us, accent: PronunciationAccent.US }),
    [PronunciationAccent.UK]: createPronunciation({ ...uk, accent: PronunciationAccent.UK }),
  });
  return Object.freeze({
    contractVersion: PRONUNCIATION_CONTRACT_VERSION,
    defaultAccent,
    entries,
    playbackPolicy: Object.freeze({
      order: Object.freeze(['local_real_audio', 'local_tts_cache']),
      onlinePlaybackAllowed: false,
      generatedTtsMayBeCachedLocally: true,
    }),
  });
}

function assertOnlyKeys(input, allowed) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    studyFail('UNKNOWN_PRONUNCIATION_FIELD', 'pronunciation', `Unknown pronunciation field(s): ${unknown.join(', ')}`);
  }
}
