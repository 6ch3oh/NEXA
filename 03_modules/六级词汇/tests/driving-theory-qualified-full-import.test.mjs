import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DRIVING_THEORY_FROZEN_DATASET_ID,
  DRIVING_THEORY_FROZEN_DATASET_SHA256,
  DRIVING_THEORY_FROZEN_DATASET_VERSION,
  DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256,
  DRIVING_THEORY_USER_PDF_COLLECTION,
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  DRIVING_THEORY_USER_PDF_PILOT_CONTENTS,
  DRIVING_THEORY_USER_PDF_PILOT_MANIFEST,
  DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT,
  ReviewRating,
  calculateVocabularyLibraryHash,
  createDrivingTheoryQualifiedImportWorkflow,
  createFsrsSchedulerAdapter,
  createGenericStudyContentPackageImporter,
  createGenericStudyRuntime,
  createInMemoryStudyContentCatalog,
  createLearnerDataPartition,
  createLearnerSnapshot,
  createLocalVocabularyLibrary,
  createLocalVocabularyLibraryRestorePointManager,
  createQuestionAnswerStudyAdapter,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  loadDrivingTheoryFrozenV1,
} from '../src/index.mjs';
import {
  SYNTHETIC_MULTIPLE_CHOICE_MANIFEST,
  SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT,
} from '../fixtures/synthetic-multiple-choice-validation-pack.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixedTime = '2026-08-23T00:00:00.000Z';

test('Frozen V1 is an independently verified 500-item private import package', async () => {
  const frozen = await loadDrivingTheoryFrozenV1({ moduleRoot, verifyMedia: true });
  assert.equal(frozen.integrity.status, 'PASS');
  assert.equal(frozen.integrity.datasetSha256, DRIVING_THEORY_FROZEN_DATASET_SHA256);
  assert.equal(frozen.integrity.qaLedgerSha256, DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256);
  assert.equal(frozen.contents.length, 500);
  assert.equal(frozen.dataset.questionTypeCounts.MC, 303);
  assert.equal(frozen.dataset.questionTypeCounts.TRUE_FALSE, 197);
  assert.equal(frozen.media.count, 147);
  assert.equal(frozen.dataset.textOnlyCount, 353);
});

test('protected same-collection upgrade preserves Pilot identities and learner state', async (t) => {
  const harness = await createHarness(t);
  const frozen = harness.frozen;
  const learner = createLearnerDataPartition();
  const runtime = createDrivingRuntime(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS, learner);
  runtime.session.rate(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS[0].contentId, ReviewRating.AGAIN, { at: fixedTime });
  const learnerBefore = createLearnerSnapshot(learner, { createdAt: fixedTime, updatedAt: fixedTime });
  const adapter = createQuestionAnswerStudyAdapter({ collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID });
  const pilotIdentities = DRIVING_THEORY_USER_PDF_PILOT_CONTENTS.map((content) => {
    const projection = adapter.adapt(content);
    return [projection.studyItem.itemId, projection.reviewCards[0].cardId];
  });

  const workflow = harness.workflow();
  const preview = await workflow.preview();
  assert.equal(preview.ok, true);
  assert.equal(preview.mutationCount, 0);
  assert.equal(preview.existingItemCount, 20);
  assert.equal(preview.newItemCount, 480);
  assert.equal(preview.finalItemCount, 500);
  assert.equal((await harness.library.load()).contentCollections, undefined);

  const imported = await workflow.confirm(preview.previewId);
  assert.equal(imported.ok, true);
  assert.equal(imported.finalCollectionCount, 500);
  assert.equal(imported.rollbackSupported, true);
  assert.equal(imported.receipt.SOURCE_DATASET_ID, DRIVING_THEORY_FROZEN_DATASET_ID);
  assert.equal(imported.receipt.SOURCE_DATASET_VERSION, DRIVING_THEORY_FROZEN_DATASET_VERSION);
  assert.equal(imported.receipt.SOURCE_DATASET_SHA256, DRIVING_THEORY_FROZEN_DATASET_SHA256);

  const saved = await harness.library.load();
  assert.equal(saved.entries.length, 5_311);
  assert.deepEqual(saved.contentCollections.map((collection) => [collection.manifest.collectionId, collection.contents.length]), [
    ['multiple-choice-validation-pack', 24],
    [DRIVING_THEORY_USER_PDF_COLLECTION_ID, 500],
  ]);
  const full = saved.contentCollections[1];
  const pilotIds = new Set(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS.map((content) => content.contentId));
  const preservedPilot = full.contents.filter((content) => pilotIds.has(content.contentId));
  assert.deepEqual(preservedPilot, DRIVING_THEORY_USER_PDF_PILOT_CONTENTS);
  assert.deepEqual(preservedPilot.map((content) => {
    const projection = adapter.adapt(content);
    return [projection.studyItem.itemId, projection.reviewCards[0].cardId];
  }), pilotIdentities);
  assert.deepEqual(createLearnerSnapshot(learner, { createdAt: fixedTime, updatedAt: fixedTime }), learnerBefore);

  const fullRuntime = createDrivingRuntime(full.contents, learner, frozen.collection);
  const first = full.contents[0];
  const secondAgain = fullRuntime.session.rate(first.contentId, ReviewRating.AGAIN, { at: '2026-08-23T00:01:00.000Z' });
  const good = fullRuntime.session.rate(first.contentId, ReviewRating.GOOD, { at: '2026-08-23T00:11:00.000Z' });
  assert.equal(secondAgain.schedule.dueAt, '2026-08-23T00:11:00.000Z');
  assert.equal(good.schedule.schedulerType, 'fsrs');
  assert.equal(fullRuntime.session.master(first.contentId, { at: '2026-08-23T00:12:00.000Z' }).progress.stage, 'mastered');
  const queue = fullRuntime.queue.build({ now: '2026-08-23T00:12:00.000Z', plan: fullRuntime.createPlan({ dailyNewLimit: 12, dailyReviewLimit: 8, dailyTotalLimit: 20 }) });
  assert.equal(queue.total, 12);
  assert.equal(queue.items.some((item) => item.contentId === first.contentId), false);
  assert.equal(fullRuntime.getStatistics({ day: '2026-08-23' }).totalItems, 500);
});

test('controlled isolated failure restores 5311 + 24 + 20, then clean re-import reaches 500', async (t) => {
  const harness = await createHarness(t);
  const learner = createLearnerDataPartition();
  const runtime = createDrivingRuntime(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS, learner);
  runtime.session.rate(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS[1].contentId, ReviewRating.GOOD, { at: fixedTime });
  const learnerBefore = createLearnerSnapshot(learner, { createdAt: fixedTime, updatedAt: fixedTime });
  const before = withBaselines(await harness.library.load(), harness.baselines);
  const beforeHash = calculateVocabularyLibraryHash(before);
  const failing = harness.workflow(async () => { throw Object.assign(new Error('controlled'), { code: 'CONTROLLED_FULL_IMPORT_FAILURE' }); });
  const preview = await failing.preview();
  const failed = await failing.confirm(preview.previewId);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(failed.error.details.causeCode, 'CONTROLLED_FULL_IMPORT_FAILURE');
  assert.equal(calculateVocabularyLibraryHash(await harness.library.load()), beforeHash);
  assert.deepEqual((await harness.library.load()).contentCollections.map((collection) => collection.contents.length), [24, 20]);
  assert.deepEqual(createLearnerSnapshot(learner, { createdAt: fixedTime, updatedAt: fixedTime }), learnerBefore);

  const retry = harness.workflow();
  const retried = await retry.confirm((await retry.preview()).previewId);
  assert.equal(retried.ok, true);
  assert.deepEqual((await harness.library.load()).contentCollections.map((collection) => collection.contents.length), [24, 500]);
});

async function createHarness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-driving-qualified-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const real = await createLocalVocabularyLibrary({ filePath: join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json') }).load();
  const library = createLocalVocabularyLibrary({ filePath: join(directory, 'library.json') });
  await library.save({ version: real.version, entries: real.entries, imports: real.imports });
  const restorePointManager = createLocalVocabularyLibraryRestorePointManager({
    directoryPath: join(directory, 'restore-points'), library,
    libraryIdentity: 'nexa-study-center-library', collectionId: 'all-study-collections',
  });
  const frozen = await loadDrivingTheoryFrozenV1({ moduleRoot, verifyMedia: false });
  const baselines = [
    importedCollection(SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, SYNTHETIC_MULTIPLE_CHOICE_MANIFEST, 'synthetic-baseline-receipt'),
    importedCollection(DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT, DRIVING_THEORY_USER_PDF_PILOT_MANIFEST, 'driving-pilot-baseline-receipt'),
  ];
  const workflow = (postImportValidate) => createDrivingTheoryQualifiedImportWorkflow({
    library, restorePointManager, baselineContentCollections: baselines,
    packageInput: frozen.packageInput, packageManifest: frozen.manifest,
    frozenIdentity: { datasetId: DRIVING_THEORY_FROZEN_DATASET_ID, datasetVersion: DRIVING_THEORY_FROZEN_DATASET_VERSION, datasetSha256: DRIVING_THEORY_FROZEN_DATASET_SHA256 },
    clock: () => fixedTime, ...(postImportValidate ? { postImportValidate } : {}),
  });
  return { directory, library, restorePointManager, frozen, baselines, workflow };
}

function importedCollection(input, manifest, receiptId) {
  const result = createGenericStudyContentPackageImporter({ catalog: createInMemoryStudyContentCatalog(), clock: () => fixedTime }).import({
    input, manifest, receiptId, persisted: true,
  });
  assert.equal(result.ok, true);
  return { manifest: result.manifest, contents: result.contents, receipts: [result.receipt] };
}

function withBaselines(library, baselines) {
  return { ...library, contentCollections: baselines };
}

function createDrivingRuntime(contents, partition, collection = DRIVING_THEORY_USER_PDF_COLLECTION) {
  return createGenericStudyRuntime({
    learnerId: 'local-default', collection,
    catalog: createInMemoryStudyContentCatalog(contents),
    adapter: createQuestionAnswerStudyAdapter({ collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID }),
    partition,
    scheduler: createFsrsSchedulerAdapter({ fallbackScheduler: createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() }) }),
  });
}
