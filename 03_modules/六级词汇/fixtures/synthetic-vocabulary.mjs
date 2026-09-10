import { PartOfSpeech, createVocabularyEntry } from '../src/index.mjs';

export const SYNTHETIC_FIXTURE_MARKER = 'TEST / SYNTHETIC';
export const SYNTHETIC_TIMESTAMP = '2026-08-10T00:00:00.000Z';

function sense(senseId, partOfSpeech, definitionZh, options = {}) {
  return {
    senseId,
    partOfSpeech,
    definitionZh,
    definitionEn: options.definitionEn ?? null,
    examples: options.examples ?? [],
    synonyms: options.synonyms ?? [],
    antonyms: options.antonyms ?? [],
  };
}

function entry(entryId, headword, senses, extraTags = []) {
  return createVocabularyEntry({
    entryId,
    headword,
    pronunciations: { ipaUk: null, ipaUs: null },
    senses,
    tags: ['test', 'synthetic', ...extraTags],
    sourceRefs: ['test:synthetic-cet6-fixture'],
    createdAt: SYNTHETIC_TIMESTAMP,
    updatedAt: SYNTHETIC_TIMESTAMP,
  });
}

export const SYNTHETIC_VOCABULARY_ENTRIES = Object.freeze([
  entry('cet6:test:abandon', 'abandon', [
    sense('abandon:verb:1', PartOfSpeech.VERB, '测试释义：放弃', {
      examples: [{
        exampleId: 'abandon:example:1',
        sentence: 'The synthetic team abandoned the test plan.',
        translationZh: '这个合成测试团队放弃了测试计划。',
      }],
      synonyms: ['give up'],
    }),
  ], ['example']),
  entry('cet6:test:abstract', 'abstract', [
    sense('abstract:adjective:1', PartOfSpeech.ADJECTIVE, '测试释义：抽象的'),
    sense('abstract:noun:1', PartOfSpeech.NOUN, '测试释义：摘要'),
  ], ['multiple-parts-of-speech']),
  entry('cet6:test:allocate', 'allocate', [
    sense('allocate:verb:1', PartOfSpeech.VERB, '测试释义：分配'),
  ]),
  entry('cet6:test:allocation', 'allocation', [
    sense('allocation:noun:1', PartOfSpeech.NOUN, '测试释义：分配量'),
  ]),
  entry('cet6:test:allow', 'allow', [
    sense('allow:verb:1', PartOfSpeech.VERB, '测试释义：允许'),
  ]),
  entry('cet6:test:break-down', 'break down', [
    sense('break-down:phrase:1', PartOfSpeech.PHRASE, '测试释义：发生故障'),
  ], ['phrase']),
  entry('cet6:test:issue', 'issue', [
    sense('issue:noun:1', PartOfSpeech.NOUN, '测试释义：问题'),
    sense('issue:verb:1', PartOfSpeech.VERB, '测试释义：发布'),
  ], ['multiple-parts-of-speech']),
  entry('cet6:test:robust', 'robust', [
    sense('robust:adjective:1', PartOfSpeech.ADJECTIVE, '测试释义：稳健的'),
  ]),
]);

export const DUPLICATE_IDENTITY_FIXTURE = Object.freeze([
  SYNTHETIC_VOCABULARY_ENTRIES[0],
  createVocabularyEntry({
    ...structuredClone(SYNTHETIC_VOCABULARY_ENTRIES[0]),
    entryId: 'cet6:test:abandon-duplicate',
  }),
]);

export const INVALID_FIELD_FIXTURE = Object.freeze({
  ...structuredClone(SYNTHETIC_VOCABULARY_ENTRIES[0]),
  providerPayload: { synthetic: true },
});
