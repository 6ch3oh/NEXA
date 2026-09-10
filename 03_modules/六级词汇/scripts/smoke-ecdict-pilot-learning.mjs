import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ReviewRating,
  createCet6StudyMvpRuntime,
  createFsrsSchedulerAdapter,
  createInMemoryVocabularyStore,
  createLocalFilePersistenceAdapter,
  createLocalRestorePointManager,
  createLocalVocabularyLibrary,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  getLocalStudyCenterStatistics,
  restoreLearnerData,
  saveLearnerData,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDirectory = join(moduleRoot, 'data', 'ecdict-pilot');
const library = createLocalVocabularyLibrary({ filePath: join(dataDirectory, 'vocabulary-library.json') });
const savedLibrary = await library.load();
assert.equal(savedLibrary.entries.length, 100);
assert.equal(savedLibrary.imports.length, 1);
assert.equal(savedLibrary.imports[0].manifest.provenance.classification, 'THIRD_PARTY');
const store = createInMemoryVocabularyStore(savedLibrary.entries);
const learnerFile = join(dataDirectory, 'learner-state.json');
const persistence = createLocalFilePersistenceAdapter({ filePath: learnerFile });
const existing = await restoreLearnerData(persistence);
const fresh = existing.restored
  ? { ...existing, partition: existing.partition }
  : existing;
const fallback = createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
const scheduler = createFsrsSchedulerAdapter({ fallbackScheduler: fallback });
const runtime = createCet6StudyMvpRuntime({
  learnerId: 'ecdict-pilot-learner',
  vocabularyStore: store,
  partition: fresh.partition,
  scheduler,
  clock: () => '2026-08-13T06:30:00.000Z',
});
const plan = runtime.createPlan({ dailyNewLimit: 10, dailyReviewLimit: 20, dailyTotalLimit: 20 });
const initialQueue = runtime.queue.build({ now: '2026-08-14T06:30:00.000Z', plan });
assert.ok(initialQueue.total >= 10);
assert.ok(initialQueue.items.every((item) => store.getById(item.entryId).tags.includes('real-pilot')));
const untouched = initialQueue.items.filter((item) => runtime.progressStore.get(item.entryId) === null).slice(0, 3);
assert.equal(untouched.length, 3);
const [againEntry, fsrsEntry, masteredEntry] = untouched.map((item) => store.getById(item.entryId));

const card = runtime.card.load(againEntry.entryId, { queueReason: untouched[0].queueReason });
assert.equal(card.word, againEntry.headword);
assert.equal(card.usPhonetic, null);
assert.equal(card.ukPhonetic, againEntry.pronunciations.ipaUk);
assert.equal(card.examples.length, 0);
assert.equal(card.phrases.length, 0);
assert.ok(card.definitions.length > 0);

const relearning = runtime.session.rate(againEntry.entryId, ReviewRating.AGAIN, {
  at: '2026-08-14T06:31:00.000Z', durationMs: 1_200,
});
assert.equal(relearning.schedule.phase, 'relearning');
const advanced = runtime.session.advanceRelearning(againEntry.entryId, { at: '2026-08-14T06:32:00.000Z' });
assert.equal(advanced.stepIndex, 1);
const fsrs = runtime.session.rate(fsrsEntry.entryId, ReviewRating.GOOD, {
  at: '2026-08-14T06:33:00.000Z', durationMs: 900,
});
assert.equal(fsrs.schedule.schedulerType, 'fsrs');
runtime.session.start(masteredEntry.entryId, { at: '2026-08-14T06:34:00.000Z' });
const mastered = runtime.session.master(masteredEntry.entryId, { at: '2026-08-14T06:35:00.000Z' });
assert.equal(mastered.progress.stage, 'mastered');
runtime.session.setUnknown(againEntry.entryId, true, { at: '2026-08-14T06:36:00.000Z' });
runtime.session.setFavorite(fsrsEntry.entryId, true, { at: '2026-08-14T06:37:00.000Z' });

const saved = await saveLearnerData(persistence, fresh.partition, {
  createdAt: existing.snapshot?.createdAt ?? '2026-08-13T06:30:00.000Z',
  updatedAt: '2026-08-14T06:38:00.000Z',
});
const restored = await restoreLearnerData(persistence);
assert.equal(restored.restored, true);
assert.equal(
  restored.partition.openLearner('ecdict-pilot-learner').progressStore.listStates().length,
  runtime.progressStore.listStates().length,
);
const restoreManager = createLocalRestorePointManager({ directoryPath: join(dataDirectory, 'restore-points') });
let restorePointResult;
if ((await restoreManager.listRestorePoints()).some((item) => item.restorePointId === 'ecdict-pilot-v1')) {
  restorePointResult = await restoreManager.restoreFromPoint('ecdict-pilot-v1');
} else {
  await restoreManager.createRestorePoint({
    restorePointId: 'ecdict-pilot-v1', createdAt: '2026-08-14T06:39:00.000Z', snapshot: saved.snapshot,
  });
  restorePointResult = await restoreManager.restoreFromPoint('ecdict-pilot-v1');
}
assert.ok(restorePointResult.partition.openLearner('ecdict-pilot-learner').progressStore.listStates().length >= 3);

const restoredRuntime = createCet6StudyMvpRuntime({
  learnerId: 'ecdict-pilot-learner', vocabularyStore: store, partition: restored.partition, scheduler,
});
const statistics = getLocalStudyCenterStatistics(store, {
  learnerId: 'ecdict-pilot-learner',
  progressStore: restoredRuntime.progressStore,
  reviewRecordStore: restoredRuntime.reviewRecordStore,
  day: '2026-08-14',
  dailyPlan: plan,
  importRecords: savedLibrary.imports,
});
assert.equal(statistics.totalVocabulary, 100);
assert.equal(statistics.realThirdPartyCount, 100);
assert.equal(statistics.syntheticCount, 0);
assert.ok(statistics.mastered >= 1);
assert.ok(statistics.reviewing >= 2);
assert.ok(statistics.unknown >= 1);
assert.ok(statistics.favorite >= 1);
await mkdir(dataDirectory, { recursive: true });
const result = {
  status: 'PASS',
  source: 'ECDICT',
  classification: 'THIRD_PARTY',
  queue: { total: initialQueue.total, allRealPilot: true },
  card: { word: card.word, usPhonetic: card.usPhonetic, ukPhonetic: card.ukPhonetic, phrases: 0, examples: 0 },
  relearning: { phase: relearning.schedule.phase, advancedStep: advanced.stepIndex },
  fsrs: { schedulerType: fsrs.schedule.schedulerType, implementation: scheduler.implementation },
  mastered: mastered.progress.stage,
  persistence: { saved: true, restored: true, restorePoint: true, learnerFile },
  statistics,
};
await writeFile(join(dataDirectory, 'learning-chain-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result)}\n`);
