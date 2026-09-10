import { createPronunciationSet } from '../src/index.mjs';

export const SYNTHETIC_PRONUNCIATION_MARKER = 'TEST / SYNTHETIC';

export const SYNTHETIC_PRONUNCIATION_SET = createPronunciationSet({
  us: {
    phonetic: '/synthetic-us/',
    audioSource: 'local_asset',
    localAssetRef: 'test:synthetic-audio/us/abandon.wav',
  },
  uk: {
    phonetic: '/synthetic-uk/',
    audioSource: 'local_asset',
    localAssetRef: 'test:synthetic-audio/uk/abandon.wav',
  },
});
