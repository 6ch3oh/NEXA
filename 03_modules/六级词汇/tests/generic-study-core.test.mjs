import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CET6_STUDY_COLLECTION_ID,
  DEFAULT_PRONUNCIATION_ACCENT,
  DEFAULT_RELEARNING_STEPS_MS,
  DEFAULT_STUDY_PLAN_LIMITS,
  LearningStage,
  MILLISECONDS_PER_MINUTE,
  PronunciationAccent,
  ReviewCardType,
  ReviewRating,
  StudyAction,
  StudyCollectionType,
  StudyContentType,
  createCollectionStudyPlan,
  createContentTypeRegistry,
  createGenericTodayStudyQueue,
  createInMemoryLearningProgressStore,
  createInMemoryVocabularyStore,
  createPronunciationSet,
  createReviewCard,
  createReviewScheduler,
  createRelearningPolicy,
  createSimpleSchedulerAdapter,
  createStudyCollection,
  createStudyItem,
  createStudyProgressView,
  createTodayQueueBuilder,
  createVocabularyStudyAdapter,
  validateReviewCardCollection,
  validateReviewRating,
} from '../src/index.mjs';
import {
  SYNTHETIC_GENERIC_STUDY_MARKER,
  SYNTHETIC_SECOND_REVIEW_CARD,
  SYNTHETIC_STUDY_COLLECTION,
  SYNTHETIC_STUDY_PROJECTION,
  SYNTHETIC_VOCABULARY_STUDY_ADAPTER,
} from '../fixtures/synthetic-generic-study.mjs';
import {
  SYNTHETIC_LEARNING_NOW,
  SYNTHETIC_LEARNING_PROGRESS,
} from '../fixtures/synthetic-learning.mjs';
import { SYNTHETIC_TIMESTAMP, SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

test('generic fixture is explicitly TEST / SYNTHETIC', () => {
  assert.equal(SYNTHETIC_GENERIC_STUDY_MARKER, 'TEST / SYNTHETIC');
});

test('StudyCollection validates a vocabulary collection', () => {
  assert.equal(SYNTHETIC_STUDY_COLLECTION.type, StudyCollectionType.VOCABULARY_COLLECTION);
  assert.equal(SYNTHETIC_STUDY_COLLECTION.collectionId, CET6_STUDY_COLLECTION_ID);
  assert.ok(Object.isFrozen(SYNTHETIC_STUDY_COLLECTION));
});

test('StudyCollection rejects an unsupported collection type', () => {
  assert.throws(() => createStudyCollection({
    collectionId: 'bad-collection', type: 'video-course', title: 'Bad', description: null,
    source: 'test:synthetic', createdAt: SYNTHETIC_TIMESTAMP, updatedAt: SYNTHETIC_TIMESTAMP,
  }), (error) => error.code === 'INVALID_COLLECTION_TYPE');
});

test('content type registry is extensible for a second content domain', () => {
  const registry = createContentTypeRegistry([]);
  registry.register('question-answer-v2');
  const item = createStudyItem({
    itemId: 'study-question-1', collectionId: 'question-bank-1', contentType: 'question-answer-v2',
    source: 'test:synthetic', tags: ['test'], authorityRef: { authorityType: 'question', entityId: 'question-1' },
    createdAt: SYNTHETIC_TIMESTAMP, updatedAt: SYNTHETIC_TIMESTAMP,
  }, { contentTypeRegistry: registry });
  assert.equal(item.contentType, 'question-answer-v2');
});

test('unregistered StudyItem content type fails closed', () => {
  assert.throws(() => createStudyItem({
    itemId: 'study-bad', collectionId: 'bad-collection', contentType: 'unsupported-kind',
    source: 'test:synthetic', tags: [], authorityRef: { authorityType: 'test-authority', entityId: 'test-1' },
    createdAt: SYNTHETIC_TIMESTAMP, updatedAt: SYNTHETIC_TIMESTAMP,
  }), (error) => error.code === 'UNREGISTERED_CONTENT_TYPE');
});

test('CET-6 adapter projects VocabularyEntry to a vocabulary StudyItem', () => {
  assert.equal(SYNTHETIC_STUDY_PROJECTION.studyItem.contentType, StudyContentType.VOCABULARY);
  assert.equal(SYNTHETIC_STUDY_PROJECTION.studyItem.authorityRef.entityId, SYNTHETIC_VOCABULARY_ENTRIES[0].entryId);
});

test('StudyItem does not duplicate authoritative vocabulary content', () => {
  for (const key of ['word', 'headword', 'phonetic', 'pronunciations', 'senses', 'definitions', 'examples']) {
    assert.equal(Object.hasOwn(SYNTHETIC_STUDY_PROJECTION.studyItem, key), false, key);
  }
});

test('CET-6 presentation derives word, POS, definitions and examples', () => {
  const { presentation } = SYNTHETIC_STUDY_PROJECTION;
  assert.equal(presentation.word, SYNTHETIC_VOCABULARY_ENTRIES[0].headword);
  assert.equal(presentation.partsOfSpeech[0], SYNTHETIC_VOCABULARY_ENTRIES[0].senses[0].partOfSpeech);
  assert.equal(presentation.definitions.length, 1);
  assert.equal(presentation.examples.length, 1);
});

test('phrase presentation is projected from phrase senses', () => {
  const projection = SYNTHETIC_VOCABULARY_STUDY_ADAPTER.adapt(SYNTHETIC_VOCABULARY_ENTRIES[5]);
  assert.equal(projection.presentation.phrases.length, 1);
  assert.equal(projection.presentation.word, 'break down');
});

test('CET-6 adapter creates a default recognition ReviewCard', () => {
  const [card] = SYNTHETIC_STUDY_PROJECTION.reviewCards;
  assert.equal(card.cardType, ReviewCardType.RECOGNITION);
  assert.equal(card.promptRef.selector, 'headword');
  assert.equal(card.answerRef.selector, 'senses');
});

test('one StudyItem supports multiple ReviewCards', () => {
  const cards = [SYNTHETIC_STUDY_PROJECTION.reviewCards[0], SYNTHETIC_SECOND_REVIEW_CARD];
  assert.equal(validateReviewCardCollection(cards), cards);
  assert.equal(new Set(cards.map((card) => card.itemId)).size, 1);
});

test('duplicate ReviewCard identity is rejected', () => {
  const card = SYNTHETIC_STUDY_PROJECTION.reviewCards[0];
  assert.throws(() => validateReviewCardCollection([card, card]), (error) => error.code === 'DUPLICATE_REVIEW_CARD');
});

for (const rating of Object.values(ReviewRating)) {
  test(`review rating ${rating} is valid`, () => assert.equal(validateReviewRating(rating), rating));
}

test('MASTERED is a study action, not a review rating', () => {
  assert.equal(StudyAction.MASTERED, 'mastered');
  assert.throws(() => validateReviewRating(StudyAction.MASTERED), (error) => error.code === 'INVALID_REVIEW_RATING');
});

test('relearning policy centralizes 1 minute and 10 minute steps', () => {
  assert.deepEqual(DEFAULT_RELEARNING_STEPS_MS, [MILLISECONDS_PER_MINUTE, 10 * MILLISECONDS_PER_MINUTE]);
  const policy = createRelearningPolicy();
  assert.equal(policy.getNextDueAt({ rating: ReviewRating.AGAIN, now: SYNTHETIC_LEARNING_NOW, stepIndex: 0 }), '2026-08-10T12:01:00.000Z');
  assert.equal(policy.getNextDueAt({ rating: ReviewRating.AGAIN, now: SYNTHETIC_LEARNING_NOW, stepIndex: 1 }), '2026-08-10T12:10:00.000Z');
});

test('simple scheduler adapter reuses existing long-term scheduler semantics', () => {
  const scheduler = createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
  assert.equal(scheduler.schedule({ stage: LearningStage.REVIEWING }, ReviewRating.GOOD, SYNTHETIC_LEARNING_NOW).dueAt, '2026-08-13T12:00:00.000Z');
  assert.equal(scheduler.schedule({ stage: LearningStage.REVIEWING }, ReviewRating.HARD, SYNTHETIC_LEARNING_NOW).dueAt, '2026-08-11T12:00:00.000Z');
  assert.equal(scheduler.schedule({ stage: LearningStage.REVIEWING }, ReviewRating.AGAIN, SYNTHETIC_LEARNING_NOW).dueAt, '2026-08-10T12:01:00.000Z');
});

test('generic scheduler exposes replaceable due-date contract', () => {
  const scheduler = createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
  assert.equal(scheduler.getDueAt({ dueAt: SYNTHETIC_LEARNING_NOW }), SYNTHETIC_LEARNING_NOW);
  assert.equal(scheduler.isDue({ dueAt: SYNTHETIC_LEARNING_NOW }, SYNTHETIC_LEARNING_NOW), true);
});

test('StudyProgressView projects existing LearnerProgress without a second state store', () => {
  const view = createStudyProgressView({ itemId: 'study-progress-test', learnerProgress: SYNTHETIC_LEARNING_PROGRESS[3] });
  assert.equal(view.authorityRef.entityId, SYNTHETIC_LEARNING_PROGRESS[3].entryId);
  assert.equal(view.dueAt, SYNTHETIC_LEARNING_PROGRESS[3].nextReviewAt);
});

test('collection study plan has independent new, review and total limits', () => {
  assert.deepEqual(DEFAULT_STUDY_PLAN_LIMITS, { dailyNewLimit: 10, dailyReviewLimit: 10, dailyTotalLimit: 20 });
  const plan = createCollectionStudyPlan({ collectionId: CET6_STUDY_COLLECTION_ID, dailyNewLimit: 1, dailyReviewLimit: 1, dailyTotalLimit: 3 });
  assert.deepEqual(plan, { planVersion: '0.1', collectionId: CET6_STUDY_COLLECTION_ID, dailyNewLimit: 1, dailyReviewLimit: 1, dailyTotalLimit: 3 });
});

test('generic Today Study Queue consumes existing CET-6 queue and preserves limits', () => {
  const vocabularyStore = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const progressStore = createInMemoryLearningProgressStore({ progress: SYNTHETIC_LEARNING_PROGRESS });
  const legacyQueueBuilder = createTodayQueueBuilder({ vocabularyStore, progressStore, reviewScheduler: createReviewScheduler() });
  const queueBuilder = createGenericTodayStudyQueue({ legacyQueueBuilder, vocabularyStore, progressStore, studyAdapter: createVocabularyStudyAdapter() });
  const plan = createCollectionStudyPlan({ collectionId: CET6_STUDY_COLLECTION_ID, dailyNewLimit: 1, dailyReviewLimit: 1, dailyTotalLimit: 3 });
  const queue = queueBuilder.build({ now: SYNTHETIC_LEARNING_NOW, plan });
  assert.equal(queue.totalCount, 3);
  assert.equal(queue.reviewCount, 1);
  assert.ok(queue.todayItems.every((item) => item.studyItem.collectionId === CET6_STUDY_COLLECTION_ID));
});

test('pronunciation contract defaults to US and explicitly supports UK', () => {
  const set = createPronunciationSet({ us: { phonetic: '/us/' }, uk: { phonetic: '/uk/' } });
  assert.equal(DEFAULT_PRONUNCIATION_ACCENT, PronunciationAccent.US);
  assert.equal(set.entries.us.phonetic, '/us/');
  assert.equal(set.entries.uk.phonetic, '/uk/');
  assert.deepEqual(set.playbackPolicy.order, ['local_real_audio', 'local_tts_cache']);
  assert.equal(set.playbackPolicy.onlinePlaybackAllowed, false);
});

test('pronunciation remains adapter capability, not a generic StudyItem field', () => {
  assert.equal(Object.hasOwn(SYNTHETIC_STUDY_PROJECTION.studyItem, 'pronunciation'), false);
  assert.equal(SYNTHETIC_STUDY_PROJECTION.pronunciation.defaultAccent, 'us');
});

test('public API preserves CET-6 exports and exposes generic core', async () => {
  const api = await import('../src/index.mjs');
  for (const name of ['createVocabularyEntry', 'createTodayQueueBuilder', 'createStudyItem', 'createReviewCard', 'createGenericTodayStudyQueue']) {
    assert.equal(typeof api[name], 'function', name);
  }
});
