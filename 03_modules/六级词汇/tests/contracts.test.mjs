import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CET6_CONTRACT_VERSION,
  Cet6ContractError,
  LearningStage,
  PartOfSpeech,
  ReviewMode,
  ReviewResult,
  createLearnerProgress,
  createReviewRecord,
  createVocabularyEntry,
  normalizeHeadword,
  validateLearnerProgress,
  validateReviewRecord,
  validateVocabularyCollection,
  validateVocabularyEntry,
} from '../src/index.mjs';

const CREATED_AT = '2026-08-10T12:00:00.000Z';

function vocabularyInput(overrides = {}) {
  return {
    entryId: 'cet6:abandon',
    headword: 'Abandon',
    pronunciations: { ipaUk: '/əˈbændən/', ipaUs: '/əˈbændən/' },
    senses: [{
      senseId: 'abandon:verb:1',
      partOfSpeech: PartOfSpeech.VERB,
      definitionZh: '放弃；抛弃',
      definitionEn: 'to leave a place, thing, or person permanently',
      examples: [{
        exampleId: 'abandon:example:1',
        sentence: 'They had to abandon the experiment.',
        translationZh: '他们不得不放弃这项实验。',
      }],
      synonyms: ['desert', 'give up'],
      antonyms: ['retain'],
    }],
    tags: ['Core', 'Action'],
    sourceRefs: ['cet6:official-syllabus'],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

test('creates a canonical, deeply immutable CET-6 vocabulary entry', () => {
  const input = vocabularyInput();
  const entry = createVocabularyEntry(input);
  assert.equal(entry.schemaVersion, CET6_CONTRACT_VERSION);
  assert.equal(entry.headword, 'Abandon');
  assert.equal(entry.normalizedHeadword, 'abandon');
  assert.deepEqual(entry.tags, ['core', 'action']);
  assert.equal(validateVocabularyEntry(entry), entry);
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.senses[0].examples[0]));
  assert.throws(() => entry.tags.push('mutate'), TypeError);
  assert.deepEqual(input.tags, ['Core', 'Action']);
});

test('normalizes whitespace, Unicode apostrophe and case for vocabulary identity', () => {
  assert.equal(normalizeHeadword('  Give   Up  '), 'give up');
  assert.equal(normalizeHeadword('Learner’s'), "learner's");
});

test('rejects an invalid headword and unsupported level', () => {
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ headword: '词汇123' })),
    (error) => error instanceof Cet6ContractError && error.code === 'INVALID_HEADWORD',
  );
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ level: 'CET4' })),
    (error) => error.code === 'INVALID_ENUM' && error.path === 'input.level',
  );
});

test('requires a traceable source and canonical timestamp order', () => {
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ sourceRefs: [] })),
    (error) => error.code === 'REQUIRED_VALUE',
  );
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ sourceRefs: ['not-a-source'] })),
    (error) => error.code === 'INVALID_SOURCE_REF',
  );
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ updatedAt: '2026-08-09T12:00:00.000Z' })),
    (error) => error.code === 'INVALID_TIME_ORDER',
  );
});

test('rejects duplicate sense/example identities and semantic relation conflicts', () => {
  const sense = vocabularyInput().senses[0];
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({ senses: [sense, sense] })),
    (error) => error.code === 'DUPLICATE_ID',
  );
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({
      senses: [{ ...sense, synonyms: ['retain'], antonyms: ['Retain'] }],
    })),
    (error) => error.code === 'CONFLICTING_RELATION',
  );
  assert.throws(
    () => createVocabularyEntry(vocabularyInput({
      senses: [{ ...sense, examples: [sense.examples[0], sense.examples[0]] }],
    })),
    (error) => error.code === 'DUPLICATE_ID',
  );
});

test('collection boundary rejects duplicate ids and normalized headwords', () => {
  const first = createVocabularyEntry(vocabularyInput());
  const duplicateHeadword = createVocabularyEntry(vocabularyInput({ entryId: 'cet6:abandon:alternative' }));
  assert.throws(
    () => validateVocabularyCollection([first, duplicateHeadword]),
    (error) => error.code === 'DUPLICATE_HEADWORD',
  );
  const collection = [first];
  assert.equal(validateVocabularyCollection(collection), collection);
});

test('creates an empty learner progress record with explicit new-stage invariants', () => {
  const progress = createLearnerProgress({
    learnerId: 'learner:local',
    entryId: 'cet6:abandon',
    updatedAt: CREATED_AT,
  });
  assert.equal(progress.stage, LearningStage.NEW);
  assert.equal(progress.masteryScore, 0);
  assert.equal(progress.lastReviewedAt, null);
  assert.equal(validateLearnerProgress(progress), progress);
  assert.ok(Object.isFrozen(progress));
});

test('accepts consistent reviewed progress and rejects inconsistent counters', () => {
  const progress = createLearnerProgress({
    learnerId: 'learner:local',
    entryId: 'cet6:abandon',
    stage: LearningStage.REVIEWING,
    masteryScore: 68,
    reviewCount: 5,
    correctCount: 3,
    incorrectCount: 2,
    streak: 2,
    lapseCount: 1,
    lastReviewedAt: CREATED_AT,
    nextReviewAt: '2026-08-12T12:00:00.000Z',
    updatedAt: CREATED_AT,
  });
  assert.equal(validateLearnerProgress(progress), progress);
  assert.throws(
    () => createLearnerProgress({ ...progress, correctCount: 5, incorrectCount: 2 }),
    (error) => error.code === 'INVALID_COUNT',
  );
});

test('enforces mastered, suspended and non-new stage rules', () => {
  const reviewed = {
    learnerId: 'learner:local',
    entryId: 'cet6:abandon',
    reviewCount: 1,
    correctCount: 1,
    incorrectCount: 0,
    streak: 1,
    lapseCount: 0,
    lastReviewedAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  assert.throws(
    () => createLearnerProgress({ ...reviewed, stage: LearningStage.MASTERED, masteryScore: 79 }),
    (error) => error.code === 'INVALID_MASTERY',
  );
  assert.throws(
    () => createLearnerProgress({
      ...reviewed,
      stage: LearningStage.SUSPENDED,
      masteryScore: 10,
      nextReviewAt: '2026-08-11T12:00:00.000Z',
    }),
    (error) => error.code === 'INVALID_SUSPENSION',
  );
  assert.throws(
    () => createLearnerProgress({
      learnerId: 'learner:local',
      entryId: 'cet6:abandon',
      stage: LearningStage.LEARNING,
      updatedAt: CREATED_AT,
    }),
    (error) => error.code === 'INVALID_REVIEW_STATE',
  );
});

test('creates immutable review evidence across every supported mode', () => {
  for (const [index, mode] of Object.values(ReviewMode).entries()) {
    const review = createReviewRecord({
      reviewId: `review:${index}`,
      learnerId: 'learner:local',
      entryId: 'cet6:abandon',
      mode,
      result: ReviewResult.CORRECT,
      score: 1,
      durationMs: 1_500,
      reviewedAt: CREATED_AT,
    });
    assert.equal(validateReviewRecord(review), review);
    assert.ok(Object.isFrozen(review));
  }
});

test('review result and score must agree', () => {
  const base = {
    reviewId: 'review:1',
    learnerId: 'learner:local',
    entryId: 'cet6:abandon',
    mode: ReviewMode.SPELLING,
    durationMs: 1_500,
    reviewedAt: CREATED_AT,
  };
  assert.throws(
    () => createReviewRecord({ ...base, result: ReviewResult.SKIPPED, score: 0.5 }),
    (error) => error.code === 'INVALID_REVIEW_SCORE',
  );
  assert.throws(
    () => createReviewRecord({ ...base, result: ReviewResult.INCORRECT, score: 1 }),
    (error) => error.code === 'INVALID_REVIEW_SCORE',
  );
  assert.throws(
    () => createReviewRecord({ ...base, result: ReviewResult.CORRECT, score: 0 }),
    (error) => error.code === 'INVALID_REVIEW_SCORE',
  );
});

test('all contracts reject unknown fields and non-canonical timestamps', () => {
  assert.throws(
    () => createVocabularyEntry({ ...vocabularyInput(), providerPayload: {} }),
    (error) => error.code === 'UNKNOWN_FIELD' && error.path === 'input.providerPayload',
  );
  assert.throws(
    () => createReviewRecord({
      reviewId: 'review:1',
      learnerId: 'learner:local',
      entryId: 'cet6:abandon',
      mode: ReviewMode.CONTEXT,
      result: ReviewResult.CORRECT,
      score: 1,
      durationMs: 200,
      reviewedAt: '2026-08-10T20:00:00+08:00',
    }),
    (error) => error.code === 'INVALID_DATETIME',
  );
  const entry = structuredClone(createVocabularyEntry(vocabularyInput()));
  entry.entryId = 'CET6:Abandon';
  assert.throws(
    () => validateVocabularyEntry(entry),
    (error) => error.code === 'NON_CANONICAL_VALUE' && error.path === 'entry.entryId',
  );
  const missingNullableField = structuredClone(createVocabularyEntry(vocabularyInput()));
  delete missingNullableField.pronunciations.ipaUs;
  assert.throws(
    () => validateVocabularyEntry(missingNullableField),
    (error) => error.code === 'MISSING_FIELD' && error.path === 'entry.pronunciations.ipaUs',
  );
});
