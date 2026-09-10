import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HOME_LEARNING_SUMMARY_CONTRACT_VERSION,
  createCet6StudyMvpRuntime,
  createHomeLearningSummaryAdapter,
  createInMemoryVocabularyStore,
  createLearnerDataPartition,
  createLocalVocabularyLibrary,
  validateHomeLearningSummary,
} from '../src/index.mjs';
import { SYNTHETIC_TIMESTAMP, SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function runtimeFor(entries) {
  return createCet6StudyMvpRuntime({
    learnerId: 'local-default',
    vocabularyStore: createInMemoryVocabularyStore(entries),
    partition: createLearnerDataPartition(),
    clock: () => SYNTHETIC_TIMESTAMP,
  });
}

test('HomeLearningSummary projects at most four real queue cards and progress without a second store', () => {
  const runtime = runtimeFor(SYNTHETIC_VOCABULARY_ENTRIES);
  const plan = runtime.createPlan({ dailyNewLimit: 8, dailyReviewLimit: 8, dailyTotalLimit: 8 });
  const adapter = createHomeLearningSummaryAdapter({
    runtime,
    getPlan: () => plan,
    clock: () => SYNTHETIC_TIMESTAMP,
    sourceClassification: () => 'TEST / SYNTHETIC',
  });
  const summary = adapter.getHomeSummary();
  assert.equal(summary.contract_version, HOME_LEARNING_SUMMARY_CONTRACT_VERSION);
  assert.equal(summary.cards.length, 4);
  assert.equal(summary.cards[0].title, SYNTHETIC_VOCABULARY_ENTRIES[0].headword);
  assert.equal(summary.queue_cursor, 0);
  assert.equal(summary.queue_total, 8);
  assert.equal(summary.next_cursor, 4);
  assert.equal(summary.queue_exhausted, false);
  assert.match(summary.cards[0].core_content, /放弃/);
  assert.equal(summary.cards[0].type, 'vocabulary');
  assert.equal(summary.cards[0].handoff.route_id, 'study-center');
  assert.equal(summary.progress_total, SYNTHETIC_VOCABULARY_ENTRIES.length);
  assert.equal(summary.progress_current, 0);
  assert.equal(summary.today_learned, 0);
  assert.equal(summary.due_review, 0);
  assert.equal(summary.updated_at, null);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.cards), true);
  assert.deepEqual(validateHomeLearningSummary(summary), summary);
  const nextPage = adapter.getHomeSummary({ cursor: summary.next_cursor, limit: 4 });
  assert.equal(nextPage.cards.length, 4);
  assert.equal(nextPage.cards[0].title, SYNTHETIC_VOCABULARY_ENTRIES[4].headword);
  assert.equal(nextPage.next_cursor, null);
  assert.equal(nextPage.cards.some((card) => summary.cards.some((first) => first.card_id === card.card_id)), false);
  assert.throws(() => adapter.getHomeSummary({ cursor: -1 }), /cursor/u);
});

test('empty learning content returns an explicit product empty state and route handoff', () => {
  const runtime = runtimeFor([]);
  const adapter = createHomeLearningSummaryAdapter({
    runtime,
    getPlan: () => runtime.createPlan(),
    clock: () => SYNTHETIC_TIMESTAMP,
  });
  const summary = adapter.getHomeSummary();
  assert.equal(summary.availability, 'empty');
  assert.deepEqual(summary.cards, []);
  assert.equal(summary.empty_state.reason, 'NO_LEARNING_CONTENT');
  assert.equal(summary.total_progress, null);
  assert.deepEqual(summary.learning_center_handoff, {
    route_id: 'study-center', action: 'open-learning-center',
  });
});

test('authoritative 5311-entry local library yields bounded non-synthetic knowledge cards', async () => {
  const library = await createLocalVocabularyLibrary({
    filePath: join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json'),
  }).load();
  const formsSidecar = JSON.parse(await readFile(join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'word-forms.json'), 'utf8'));
  assert.equal(library.entries.length, 5311);
  const runtime = runtimeFor(library.entries);
  const adapter = createHomeLearningSummaryAdapter({
    runtime,
    getPlan: () => runtime.createPlan({ dailyNewLimit: 4, dailyReviewLimit: 4, dailyTotalLimit: 4 }),
    clock: () => '2026-09-02T00:30:00.000Z',
    sourceClassification: () => 'PERSISTED_LOCAL_LIBRARY',
    getPronunciationStatus: (accent) => ({ available:true, label:`本地${accent === 'us' ? '美音' : '英音'}` }),
    getWordForms: (entryId) => formsSidecar.formsByEntryId[entryId] ?? [],
  });
  const summary = adapter.getHomeSummary();
  assert.equal(summary.cards.length, 4);
  assert.equal(summary.progress_total, 5311);
  assert.equal(summary.cards[0].title, 'abandon');
  assert.equal(summary.cards[0].source.classification, 'PERSISTED_LOCAL_LIBRARY');
  assert.equal(summary.cards[0].pronunciation.us.available, true);
  assert.equal(summary.cards[0].pronunciation.uk.available, true);
  assert.equal(summary.cards[0].word_forms.some((form) => form.value === 'abandoning'), true);
  assert.equal(summary.cards[0].examples.length, 0);
  assert.equal(summary.cards[0].phrases.length, 0);
  assert.doesNotMatch(JSON.stringify(summary), /TEST \/ SYNTHETIC|等待真实摘要|sourceRefs|[A-Z]:\\/u);
});
