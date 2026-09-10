import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CET6_STUDY_COLLECTION_ID,
  PartOfSpeech,
  PersonalVocabularyList,
  PronunciationPlaybackSource,
  ReviewRating,
  StudyQueueReason,
  VocabularySourceClassification,
  createCet6StudyMvpRuntime,
  createInMemoryVocabularyStore,
  createLearnerDataPartition,
  createLocalFilePersistenceAdapter,
  createPronunciationCapability,
  createPronunciationPlaybackRequest,
  createSourceClassifiedJsonVocabularyImporter,
  createVocabularyEntry,
  createVocabularySourceDescriptor,
  restoreLearnerData,
  saveLearnerData,
} from '../src/index.mjs';
import {
  SYNTHETIC_LEARNER_ID,
} from '../fixtures/synthetic-learning.mjs';
import {
  SYNTHETIC_PRONUNCIATION_MARKER,
  SYNTHETIC_PRONUNCIATION_SET,
} from '../fixtures/synthetic-pronunciation.mjs';
import {
  SYNTHETIC_VOCABULARY_ENTRIES,
} from '../fixtures/synthetic-vocabulary.mjs';

const T0 = '2026-08-13T08:00:00.000Z';
const T1 = '2026-08-13T08:01:00.000Z';
const T11 = '2026-08-13T08:11:00.000Z';
const ENTRY_ID = SYNTHETIC_VOCABULARY_ENTRIES[0].entryId;

function createHarness(partition = createLearnerDataPartition()) {
  const vocabularyStore = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  return {
    vocabularyStore,
    partition,
    runtime: createCet6StudyMvpRuntime({ learnerId: SYNTHETIC_LEARNER_ID, vocabularyStore, partition }),
  };
}

function scaleWord(index) {
  let value = index;
  let suffix = '';
  do {
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return `scaleword${suffix}`;
}

function createScaleEntry(index) {
  const word = scaleWord(index);
  return createVocabularyEntry({
    entryId: `cet6:test:scale:${index}`,
    headword: word,
    pronunciations: { ipaUk: null, ipaUs: null },
    senses: [{
      senseId: `scale:${index}:noun:1`,
      partOfSpeech: PartOfSpeech.NOUN,
      definitionZh: `测试释义：扩展词条 ${index}`,
      definitionEn: null,
      examples: [],
      synonyms: [],
      antonyms: [],
    }],
    tags: ['test', 'synthetic', 'scale'],
    sourceRefs: ['test:synthetic-scale-fixture'],
    createdAt: T0,
    updatedAt: T0,
  });
}

test('formal Study Queue exposes learner/card identity, reason, position and stable order', () => {
  const { runtime } = createHarness();
  const plan = runtime.createPlan({ dailyNewLimit: 3, dailyReviewLimit: 2, dailyTotalLimit: 3 });
  const first = runtime.queue.build({ now: T0, plan });
  const second = runtime.queue.build({ now: T0, plan });
  assert.deepEqual(first, second);
  assert.equal(first.total, 3);
  first.items.forEach((item, index) => {
    assert.equal(item.learnerId, SYNTHETIC_LEARNER_ID);
    assert.equal(item.collectionId, CET6_STUDY_COLLECTION_ID);
    assert.ok(item.itemId && item.cardId);
    assert.equal(item.queueReason, StudyQueueReason.NEW);
    assert.equal(item.position, index + 1);
    assert.equal(item.total, 3);
  });
});

test('more than 1000 eligible entries keep same-day relearning available without refilling the new-word budget', () => {
  const entries = Array.from({ length: 1_001 }, (_, index) => createScaleEntry(index));
  const vocabularyStore = createInMemoryVocabularyStore(entries);
  const runtime = createCet6StudyMvpRuntime({
    learnerId: SYNTHETIC_LEARNER_ID,
    vocabularyStore,
    partition: createLearnerDataPartition(),
  });
  entries.slice(0, 3).forEach((entry, index) => runtime.session.rate(entry.entryId, ReviewRating.AGAIN, {
    at: T0,
    reviewId: `review:scale:again:${index}`,
  }));
  const plan = runtime.createPlan({ dailyNewLimit: 3, dailyReviewLimit: 2, dailyTotalLimit: 4 });
  const queue = runtime.queue.build({ now: T1, plan });
  assert.equal(vocabularyStore.count(), 1_001);
  assert.equal(queue.total, 3);
  assert.deepEqual(queue.counts, { new: 0, relearning: 3, reviewDue: 0 });
  assert.deepEqual(queue.dailyProgress, {
    completed: 3,
    newStarted: 3,
    reviewsCompleted: 0,
    remainingNewLimit: 0,
    remainingReviewLimit: 2,
    remainingTotalLimit: 1,
  });
  assert.deepEqual(queue.plan, plan);
});

test('rating a new word consumes the daily new and total budgets without pulling in a replacement', () => {
  const { runtime } = createHarness();
  const plan = runtime.createPlan({ dailyNewLimit: 2, dailyReviewLimit: 0, dailyTotalLimit: 2 });
  const before = runtime.queue.build({ now: T0, plan });
  assert.deepEqual(before.items.map((item) => item.entryId), SYNTHETIC_VOCABULARY_ENTRIES.slice(0, 2).map((entry) => entry.entryId));
  runtime.session.rate(before.items[0].entryId, ReviewRating.GOOD, { at: T0, reviewId: 'review:daily-budget:good' });
  const after = runtime.queue.build({ now: '2026-08-13T08:00:01.000Z', plan });
  assert.deepEqual(after.items.map((item) => item.entryId), [before.items[1].entryId]);
  assert.equal(after.total, 1);
  assert.deepEqual(after.counts, { new: 1, relearning: 0, reviewDue: 0 });
  assert.deepEqual(after.dailyProgress, {
    completed: 1,
    newStarted: 1,
    reviewsCompleted: 0,
    remainingNewLimit: 1,
    remainingReviewLimit: 0,
    remainingTotalLimit: 1,
  });
});

test('CET6 Study Card is UI-ready and reveals definitions by default', () => {
  const { runtime } = createHarness();
  const card = runtime.card.load(ENTRY_ID, { queueReason: StudyQueueReason.NEW });
  assert.equal(card.word, SYNTHETIC_VOCABULARY_ENTRIES[0].headword);
  assert.equal(card.definitionVisibleByDefault, true);
  assert.equal(card.defaultAccent, 'us');
  assert.equal(card.usPhonetic, null);
  assert.equal(card.ukPhonetic, null);
  assert.ok(Array.isArray(card.definitions));
  assert.ok(Array.isArray(card.phrases));
  assert.ok(Array.isArray(card.examples));
  assert.equal(card.learningState, 'new');
  assert.equal(card.mastered, false);
});

test('pronunciation application contract defaults US and reports local TTS gap truthfully', () => {
  const { runtime } = createHarness();
  const card = runtime.card.load(ENTRY_ID);
  assert.equal(card.pronunciations.us.preferredSource, PronunciationPlaybackSource.LOCAL_TTS_FALLBACK);
  assert.equal(card.pronunciations.us.localTtsRuntimeAvailable, false);
  assert.equal(card.pronunciations.us.onlinePlaybackAllowed, false);
  const request = createPronunciationPlaybackRequest({
    pronunciationSet: runtime.studyAdapter.adapt(SYNTHETIC_VOCABULARY_ENTRIES[0]).pronunciation,
    word: card.word,
  });
  assert.equal(request.accent, 'us');
  assert.equal(request.requiresOnlineService, false);
  assert.equal(request.executableNow, false);
});

test('synthetic pronunciation asset is explicit and supports US and UK local audio', () => {
  assert.equal(SYNTHETIC_PRONUNCIATION_MARKER, 'TEST / SYNTHETIC');
  assert.equal(createPronunciationCapability(SYNTHETIC_PRONUNCIATION_SET, 'us').preferredSource, PronunciationPlaybackSource.LOCAL_AUDIO);
  assert.equal(createPronunciationCapability(SYNTHETIC_PRONUNCIATION_SET, 'uk').preferredSource, PronunciationPlaybackSource.LOCAL_AUDIO);
  assert.match(SYNTHETIC_PRONUNCIATION_SET.entries.us.localAssetRef, /^test:synthetic-audio\//);
});

test('AGAIN enters formal relearning queue after one minute', () => {
  const { runtime } = createHarness();
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:again:1' });
  const before = runtime.queue.build({ now: '2026-08-13T08:00:30.000Z', plan: runtime.createPlan() });
  assert.equal(before.items.some((item) => item.entryId === ENTRY_ID), false);
  const due = runtime.queue.build({ now: T1, plan: runtime.createPlan() });
  const item = due.items.find((candidate) => candidate.entryId === ENTRY_ID);
  assert.equal(item.queueReason, StudyQueueReason.RELEARNING);
  assert.equal(item.dueAt, T1);
});

test('relearning has priority inside an explicit review limit', () => {
  const { runtime } = createHarness();
  const otherEntryId = SYNTHETIC_VOCABULARY_ENTRIES[1].entryId;
  runtime.session.rate(otherEntryId, ReviewRating.GOOD, { at: '2026-08-09T08:00:00.000Z', reviewId: 'review:mvp:old-due' });
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:priority-again' });
  const plan = runtime.createPlan({ dailyNewLimit: 0, dailyReviewLimit: 1, dailyTotalLimit: 1 });
  const queue = runtime.queue.build({ now: T1, plan });
  assert.equal(queue.total, 1);
  assert.equal(queue.items[0].entryId, ENTRY_ID);
  assert.equal(queue.items[0].queueReason, StudyQueueReason.RELEARNING);
});

test('second consecutive AGAIN uses ten-minute relearning step', () => {
  const { runtime } = createHarness();
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:again:1' });
  const result = runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T1, reviewId: 'review:mvp:again:2' });
  assert.equal(result.schedule.relearningStepIndex, 1);
  assert.equal(result.schedule.dueAt, T11);
});

test('GOOD exits relearning and returns to long-term scheduling', () => {
  const { runtime } = createHarness();
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:again:1' });
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T1, reviewId: 'review:mvp:again:2' });
  const good = runtime.session.rate(ENTRY_ID, ReviewRating.GOOD, { at: T11, reviewId: 'review:mvp:good:1' });
  assert.equal(good.schedule.phase, 'long_term');
  assert.equal(good.schedule.dueAt, '2026-08-16T08:11:00.000Z');
  assert.equal(runtime.card.load(ENTRY_ID).relearning.active, false);
});

test('EASY remains distinct persisted evidence from GOOD', () => {
  const { runtime } = createHarness();
  const good = runtime.session.rate(ENTRY_ID, ReviewRating.GOOD, { at: T0, reviewId: 'review:mvp:good' });
  const easy = runtime.session.rate(ENTRY_ID, ReviewRating.EASY, { at: T1, reviewId: 'review:mvp:easy' });
  assert.equal(good.reviewRecord.score, 0.75);
  assert.equal(easy.reviewRecord.score, 1);
  assert.equal(runtime.card.load(ENTRY_ID).latestRating, ReviewRating.EASY);
});

test('HARD remains a rating with conservative long-term scheduling', () => {
  const { runtime } = createHarness();
  const hard = runtime.session.rate(ENTRY_ID, ReviewRating.HARD, { at: T0, reviewId: 'review:mvp:hard' });
  assert.equal(hard.rating, ReviewRating.HARD);
  assert.equal(hard.schedule.phase, 'long_term');
  assert.equal(hard.schedule.dueAt, '2026-08-14T08:00:00.000Z');
  assert.equal(runtime.card.load(ENTRY_ID).latestRating, ReviewRating.HARD);
});

test('MASTERED is independent and removes item from ordinary queue while preserving history', () => {
  const { runtime } = createHarness();
  runtime.session.rate(ENTRY_ID, ReviewRating.GOOD, { at: T0, reviewId: 'review:mvp:good' });
  const historyCount = runtime.reviewRecordStore.list().length;
  runtime.session.master(ENTRY_ID, { at: T1 });
  assert.equal(runtime.card.load(ENTRY_ID).mastered, true);
  assert.equal(runtime.reviewRecordStore.list().length, historyCount);
  const queue = runtime.queue.build({ now: '2026-08-20T00:00:00.000Z', plan: runtime.createPlan() });
  assert.equal(queue.items.some((item) => item.entryId === ENTRY_ID), false);
  assert.equal(runtime.personalVocabulary.list(PersonalVocabularyList.MASTERED).items[0].entryId, ENTRY_ID);
});

test('favorites and unknown book are state views, not duplicate domains', () => {
  const { runtime } = createHarness();
  runtime.session.setFavorite(ENTRY_ID, true, { at: T0 });
  runtime.session.setUnknown(ENTRY_ID, true, { at: T0 });
  assert.equal(runtime.personalVocabulary.list(PersonalVocabularyList.FAVORITES).total, 1);
  assert.equal(runtime.personalVocabulary.list(PersonalVocabularyList.UNKNOWN).total, 1);
  assert.equal(runtime.card.load(ENTRY_ID).favorite, true);
  assert.equal(runtime.card.load(ENTRY_ID).unknown, true);
});

test('learner-aware MVP statistics include plan, ratings, stages and personal flags', () => {
  const { runtime } = createHarness();
  const plan = runtime.createPlan({ dailyNewLimit: 5, dailyReviewLimit: 5, dailyTotalLimit: 5 });
  runtime.session.setFavorite(ENTRY_ID, true, { at: T0 });
  runtime.session.setUnknown(ENTRY_ID, true, { at: T0 });
  runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:again' });
  runtime.session.rate(ENTRY_ID, ReviewRating.GOOD, { at: T1, reviewId: 'review:mvp:good' });
  const stats = runtime.getStatistics({ day: '2026-08-13', plan });
  assert.equal(stats.learnerId, SYNTHETIC_LEARNER_ID);
  assert.equal(stats.todayPlan, 5);
  assert.equal(stats.todayCompleted, 1);
  assert.equal(stats.todayRatings.again, 1);
  assert.equal(stats.todayRatings.good, 1);
  assert.equal(stats.favoriteCount, 1);
  assert.equal(stats.unknownCount, 1);
  assert.equal(stats.completionRate, 20);
  assert.ok(Number.isFinite(stats.completionRate));
});

test('Study Home combines selectable plan, queue summary and zero-safe statistics', () => {
  const empty = createCet6StudyMvpRuntime({
    learnerId: SYNTHETIC_LEARNER_ID,
    vocabularyStore: createInMemoryVocabularyStore(),
    partition: createLearnerDataPartition(),
  });
  const plan = empty.createPlan({ dailyNewLimit: 7, dailyReviewLimit: 4, dailyTotalLimit: 9 });
  const home = empty.home({ now: T0, plan });
  assert.equal(home.plan.dailyNewLimit, 7);
  assert.equal(home.today.total, 0);
  assert.equal(home.statistics.completionRate, 0);
  assert.equal(home.statistics.masteryRate, 0);
  assert.ok(Number.isFinite(home.statistics.completionRate));
});

test('MVP learning state, queue reason, history and statistics survive save/restore', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nexa-cet6-mvp-'));
  try {
    const filePath = path.join(directory, 'learner.json');
    const before = createHarness();
    before.runtime.session.rate(ENTRY_ID, ReviewRating.AGAIN, { at: T0, reviewId: 'review:mvp:persisted-again' });
    before.runtime.session.setFavorite(ENTRY_ID, true, { at: T0 });
    const adapter = createLocalFilePersistenceAdapter({ filePath });
    await saveLearnerData(adapter, before.partition, { createdAt: T0, updatedAt: T0 });
    const restored = await restoreLearnerData(adapter);
    const after = createHarness(restored.partition);
    assert.equal(after.runtime.card.load(ENTRY_ID).latestRating, ReviewRating.AGAIN);
    assert.equal(after.runtime.card.load(ENTRY_ID).favorite, true);
    const queue = after.runtime.queue.build({ now: T1, plan: after.runtime.createPlan() });
    assert.equal(queue.items.find((item) => item.entryId === ENTRY_ID).queueReason, StudyQueueReason.RELEARNING);
    assert.equal(after.runtime.getStatistics({ day: '2026-08-13' }).todayRatings.again, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('source classification requires evidence for OFFICIAL and rejects synthetic impersonation', () => {
  assert.throws(
    () => createVocabularySourceDescriptor({ classification: VocabularySourceClassification.OFFICIAL }),
    /requires evidenceRef/,
  );
  const store = createInMemoryVocabularyStore();
  const importer = createSourceClassifiedJsonVocabularyImporter(store, {
    classification: VocabularySourceClassification.OFFICIAL,
    evidenceRef: 'authorization:test-only-proof-placeholder',
  });
  const result = importer.import(SYNTHETIC_VOCABULARY_ENTRIES);
  assert.equal(result.ok, false);
  assert.equal(result.error.details.sourceCode, 'FALSE_OFFICIAL_CLASSIFICATION');
  assert.equal(store.count(), 0);
});

test('source-classified JSON importer preserves validate/preview/import behavior', () => {
  const store = createInMemoryVocabularyStore();
  const importer = createSourceClassifiedJsonVocabularyImporter(store, {
    classification: VocabularySourceClassification.SYNTHETIC,
    evidenceRef: 'test:synthetic-cet6-fixture',
  });
  assert.equal(importer.validate(SYNTHETIC_VOCABULARY_ENTRIES).source.classification, 'SYNTHETIC');
  assert.equal(importer.preview(SYNTHETIC_VOCABULARY_ENTRIES).entryCount, 8);
  assert.equal(store.count(), 0);
  assert.equal(importer.import(SYNTHETIC_VOCABULARY_ENTRIES).importedCount, 8);
  assert.equal(store.count(), 8);
});

test('public API exposes formal CET6 Study MVP capabilities', async () => {
  const api = await import('../src/index.mjs');
  for (const name of [
    'createCet6StudyMvpRuntime', 'createCet6StudySession', 'createCet6StudyQueue',
    'createCet6StudyCardViewModel', 'getCet6StudyStatistics',
    'createSourceClassifiedJsonVocabularyImporter', 'createPronunciationPlaybackRequest',
  ]) assert.equal(typeof api[name], 'function', name);
});
