import {
  CET6_CONTRACT_VERSION,
  assertVersion,
  deepFreeze,
  fail,
  normalizeHeadword,
  normalizeIdentifier,
  normalizeText,
  normalizeUniqueStrings,
  requireArray,
  requireCanonicalIsoDateTime,
  requireCanonicalStringArray,
  requireCanonicalValue,
  requireEnum,
  requireExactKeys,
  requireNullableString,
  requireRequiredKeys,
} from './shared.mjs';

export const VocabularyLevel = Object.freeze({ CET6: 'CET6' });

export const PartOfSpeech = Object.freeze({
  NOUN: 'noun',
  VERB: 'verb',
  ADJECTIVE: 'adjective',
  ADVERB: 'adverb',
  PRONOUN: 'pronoun',
  PREPOSITION: 'preposition',
  CONJUNCTION: 'conjunction',
  DETERMINER: 'determiner',
  NUMERAL: 'numeral',
  INTERJECTION: 'interjection',
  AUXILIARY: 'auxiliary',
  PHRASE: 'phrase',
  OTHER: 'other',
});

const ENTRY_KEYS = [
  'schemaVersion', 'entryId', 'headword', 'normalizedHeadword', 'level', 'pronunciations',
  'senses', 'tags', 'sourceRefs', 'createdAt', 'updatedAt',
];
const PRONUNCIATION_KEYS = ['ipaUk', 'ipaUs'];
const SENSE_KEYS = [
  'senseId', 'partOfSpeech', 'definitionZh', 'definitionEn', 'examples', 'synonyms', 'antonyms',
];
const EXAMPLE_KEYS = ['exampleId', 'sentence', 'translationZh'];

function validatePronunciations(value, path) {
  requireExactKeys(value, PRONUNCIATION_KEYS, path);
  requireRequiredKeys(value, PRONUNCIATION_KEYS, path);
  requireCanonicalValue(value.ipaUk, requireNullableString(value.ipaUk, `${path}.ipaUk`, { max: 160 }), `${path}.ipaUk`);
  requireCanonicalValue(value.ipaUs, requireNullableString(value.ipaUs, `${path}.ipaUs`, { max: 160 }), `${path}.ipaUs`);
}

function validateEnglishTermList(value, path) {
  const terms = normalizeUniqueStrings(value, path, { maxItems: 30, maxLength: 120, lowercase: true });
  terms.forEach((term, index) => normalizeHeadword(term, `${path}[${index}]`));
  return terms;
}

function validateExample(value, path) {
  requireExactKeys(value, EXAMPLE_KEYS, path);
  requireRequiredKeys(value, EXAMPLE_KEYS, path);
  requireCanonicalValue(value.exampleId, normalizeIdentifier(value.exampleId, `${path}.exampleId`), `${path}.exampleId`);
  requireCanonicalValue(value.sentence, normalizeText(value.sentence, `${path}.sentence`, { max: 1_000 }), `${path}.sentence`);
  requireCanonicalValue(
    value.translationZh,
    requireNullableString(value.translationZh, `${path}.translationZh`, { max: 1_000 }),
    `${path}.translationZh`,
  );
}

function validateSense(value, path) {
  requireExactKeys(value, SENSE_KEYS, path);
  requireRequiredKeys(value, SENSE_KEYS, path);
  requireCanonicalValue(value.senseId, normalizeIdentifier(value.senseId, `${path}.senseId`), `${path}.senseId`);
  requireEnum(value.partOfSpeech, PartOfSpeech, `${path}.partOfSpeech`);
  requireCanonicalValue(
    value.definitionZh,
    normalizeText(value.definitionZh, `${path}.definitionZh`, { max: 1_000 }),
    `${path}.definitionZh`,
  );
  requireCanonicalValue(
    value.definitionEn,
    requireNullableString(value.definitionEn, `${path}.definitionEn`, { max: 1_000 }),
    `${path}.definitionEn`,
  );
  requireArray(value.examples, `${path}.examples`);
  const exampleIds = new Set();
  value.examples.forEach((example, index) => {
    validateExample(example, `${path}.examples[${index}]`);
    if (exampleIds.has(example.exampleId)) fail('DUPLICATE_ID', `${path}.examples`, `duplicate exampleId ${example.exampleId}`);
    exampleIds.add(example.exampleId);
  });
  const synonyms = validateEnglishTermList(value.synonyms, `${path}.synonyms`);
  const antonyms = validateEnglishTermList(value.antonyms, `${path}.antonyms`);
  requireCanonicalStringArray(value.synonyms, synonyms, `${path}.synonyms`);
  requireCanonicalStringArray(value.antonyms, antonyms, `${path}.antonyms`);
  const antonymSet = new Set(antonyms);
  if (synonyms.some((term) => antonymSet.has(term))) {
    fail('CONFLICTING_RELATION', path, 'the same term cannot be both a synonym and an antonym');
  }
}

function validateSourceRef(value, path) {
  if (!/^[a-z][a-z0-9+.-]*:.+/iu.test(value)) {
    fail('INVALID_SOURCE_REF', path, 'absolute URI or namespaced source reference required');
  }
}

export function validateVocabularyEntry(value) {
  requireExactKeys(value, ENTRY_KEYS, 'entry');
  requireRequiredKeys(value, ENTRY_KEYS, 'entry');
  assertVersion(value.schemaVersion, 'entry.schemaVersion');
  requireCanonicalValue(value.entryId, normalizeIdentifier(value.entryId, 'entry.entryId'), 'entry.entryId');
  const canonicalHeadword = normalizeText(value.headword, 'entry.headword', { max: 120 }).replace(/[’]/gu, "'");
  requireCanonicalValue(value.headword, canonicalHeadword, 'entry.headword');
  const normalizedHeadword = normalizeHeadword(value.headword, 'entry.headword');
  if (value.normalizedHeadword !== normalizedHeadword) {
    fail('HEADWORD_MISMATCH', 'entry.normalizedHeadword', `must equal ${normalizedHeadword}`);
  }
  requireEnum(value.level, VocabularyLevel, 'entry.level');
  validatePronunciations(value.pronunciations, 'entry.pronunciations');
  requireArray(value.senses, 'entry.senses', { min: 1 });
  const senseIds = new Set();
  value.senses.forEach((sense, index) => {
    validateSense(sense, `entry.senses[${index}]`);
    if (senseIds.has(sense.senseId)) fail('DUPLICATE_ID', 'entry.senses', `duplicate senseId ${sense.senseId}`);
    senseIds.add(sense.senseId);
  });
  const tags = normalizeUniqueStrings(value.tags, 'entry.tags', { maxItems: 30, maxLength: 64, lowercase: true });
  requireCanonicalStringArray(value.tags, tags, 'entry.tags');
  const sourceRefs = normalizeUniqueStrings(value.sourceRefs, 'entry.sourceRefs', {
    maxItems: 20,
    maxLength: 500,
    validate: validateSourceRef,
  });
  requireCanonicalStringArray(value.sourceRefs, sourceRefs, 'entry.sourceRefs');
  if (value.sourceRefs.length === 0) fail('REQUIRED_VALUE', 'entry.sourceRefs', 'at least one source reference required');
  requireCanonicalIsoDateTime(value.createdAt, 'entry.createdAt');
  requireCanonicalIsoDateTime(value.updatedAt, 'entry.updatedAt');
  if (value.updatedAt < value.createdAt) fail('INVALID_TIME_ORDER', 'entry.updatedAt', 'must not be earlier than createdAt');
  return value;
}

function createExample(input, path) {
  requireExactKeys(input, EXAMPLE_KEYS, path);
  return {
    exampleId: normalizeIdentifier(input.exampleId, `${path}.exampleId`),
    sentence: normalizeText(input.sentence, `${path}.sentence`, { max: 1_000 }),
    translationZh: requireNullableString(input.translationZh ?? null, `${path}.translationZh`, { max: 1_000 }),
  };
}

function createSense(input, path) {
  requireExactKeys(input, SENSE_KEYS, path);
  const synonyms = validateEnglishTermList(input.synonyms ?? [], `${path}.synonyms`);
  const antonyms = validateEnglishTermList(input.antonyms ?? [], `${path}.antonyms`);
  return {
    senseId: normalizeIdentifier(input.senseId, `${path}.senseId`),
    partOfSpeech: requireEnum(input.partOfSpeech, PartOfSpeech, `${path}.partOfSpeech`),
    definitionZh: normalizeText(input.definitionZh, `${path}.definitionZh`, { max: 1_000 }),
    definitionEn: requireNullableString(input.definitionEn ?? null, `${path}.definitionEn`, { max: 1_000 }),
    examples: requireArray(input.examples ?? [], `${path}.examples`).map((example, index) => (
      createExample(example, `${path}.examples[${index}]`)
    )),
    synonyms,
    antonyms,
  };
}

export function createVocabularyEntry(input) {
  requireExactKeys(input, ENTRY_KEYS, 'input');
  const headword = normalizeText(input.headword, 'input.headword', { max: 120 }).replace(/[’]/gu, "'");
  const normalizedHeadword = normalizeHeadword(headword, 'input.headword');
  if (input.schemaVersion !== undefined) assertVersion(input.schemaVersion, 'input.schemaVersion');
  if (input.normalizedHeadword !== undefined && input.normalizedHeadword !== normalizedHeadword) {
    fail('HEADWORD_MISMATCH', 'input.normalizedHeadword', `must equal ${normalizedHeadword}`);
  }
  const pronunciations = input.pronunciations ?? {};
  requireExactKeys(pronunciations, PRONUNCIATION_KEYS, 'input.pronunciations');
  const entry = {
    schemaVersion: CET6_CONTRACT_VERSION,
    entryId: normalizeIdentifier(input.entryId, 'input.entryId'),
    headword,
    normalizedHeadword,
    level: requireEnum(input.level ?? VocabularyLevel.CET6, VocabularyLevel, 'input.level'),
    pronunciations: {
      ipaUk: requireNullableString(pronunciations.ipaUk ?? null, 'input.pronunciations.ipaUk', { max: 160 }),
      ipaUs: requireNullableString(pronunciations.ipaUs ?? null, 'input.pronunciations.ipaUs', { max: 160 }),
    },
    senses: requireArray(input.senses, 'input.senses', { min: 1 }).map((sense, index) => (
      createSense(sense, `input.senses[${index}]`)
    )),
    tags: normalizeUniqueStrings(input.tags ?? [], 'input.tags', { maxItems: 30, maxLength: 64, lowercase: true }),
    sourceRefs: normalizeUniqueStrings(input.sourceRefs, 'input.sourceRefs', {
      maxItems: 20,
      maxLength: 500,
      validate: validateSourceRef,
    }),
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'input.createdAt'),
    updatedAt: requireCanonicalIsoDateTime(input.updatedAt, 'input.updatedAt'),
  };
  validateVocabularyEntry(entry);
  return deepFreeze(entry);
}

export function validateVocabularyCollection(entries) {
  requireArray(entries, 'entries');
  const entryIds = new Set();
  const headwords = new Set();
  entries.forEach((entry, index) => {
    validateVocabularyEntry(entry);
    if (entryIds.has(entry.entryId)) fail('DUPLICATE_ID', `entries[${index}].entryId`, 'entryId must be unique');
    if (headwords.has(entry.normalizedHeadword)) {
      fail('DUPLICATE_HEADWORD', `entries[${index}].normalizedHeadword`, 'normalized headword must be unique');
    }
    entryIds.add(entry.entryId);
    headwords.add(entry.normalizedHeadword);
  });
  return entries;
}
