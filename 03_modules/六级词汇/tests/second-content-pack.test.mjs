import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ReviewRating,
  StudyCollectionType,
  calculateStudyContentDigest,
  calculateVocabularyLibraryHash,
  createCet6StudyCollection,
  createCollectionStudyPlan,
  createFsrsSchedulerAdapter,
  createGenericStudyContentImportWorkflow,
  createGenericStudyContentPackageImporter,
  createGenericStudyRuntime,
  createInMemoryStudyContentCatalog,
  createLearnerDataPartition,
  createLearnerSnapshot,
  createLocalVocabularyLibrary,
  createLocalVocabularyLibraryRestorePointManager,
  createMultipleChoiceContent,
  createQuestionAnswerStudyAdapter,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  createStudyCenterHomeViewModel,
  createStudyCollection,
  createStudyContentPackageManifest,
  evaluateMultipleChoiceAnswer,
} from '../src/index.mjs';
import {
  MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID,
  MULTIPLE_CHOICE_VALIDATION_MARKER,
  MULTIPLE_CHOICE_VALIDATION_PACK_NAME,
  MULTIPLE_CHOICE_VALIDATION_TIMESTAMP,
  SYNTHETIC_MULTIPLE_CHOICE_COLLECTION,
  SYNTHETIC_MULTIPLE_CHOICE_CONTENTS,
  SYNTHETIC_MULTIPLE_CHOICE_MANIFEST,
  SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT,
} from '../fixtures/synthetic-multiple-choice-validation-pack.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fallback = () => createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
const fsrs = () => createFsrsSchedulerAdapter({ fallbackScheduler: fallback() });

test('second content pack is 24-item TEST / SYNTHETIC content and never official', () => {
  assert.equal(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.length, 24);
  assert.equal(SYNTHETIC_MULTIPLE_CHOICE_MANIFEST.contentType, 'multiple_choice');
  assert.equal(SYNTHETIC_MULTIPLE_CHOICE_MANIFEST.provenance.classification, 'SYNTHETIC');
  assert.equal(SYNTHETIC_MULTIPLE_CHOICE_MANIFEST.provenance.official, false);
  assert.equal(SYNTHETIC_MULTIPLE_CHOICE_MANIFEST.provenance.publicExamAuthority, null);
  assert.ok(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.every((item) => item.question.startsWith(MULTIPLE_CHOICE_VALIDATION_MARKER)));
  assert.deepEqual(new Set(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.map((item) => item.options.length)), new Set([2, 3, 4]));
  assert.ok(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.some((item) => item.explanation === null));
  assert.ok(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS.some((item) => item.explanation !== null));
});

test('multi-collection UI exposes selector, semantic options, textual feedback and independent plans', async () => {
  const [app, html, styles, server] = await Promise.all([
    readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8'),
    readFile(join(moduleRoot, 'ui', 'index.html'), 'utf8'),
    readFile(join(moduleRoot, 'ui', 'styles.css'), 'utf8'),
    readFile(join(moduleRoot, 'ui', 'server.mjs'), 'utf8'),
  ]);
  assert.match(html, /aria-label="学习中心二级导航"/u);
  for (const label of ['学习总览', '今日学习', '我的词汇', '学习统计', '设置']) assert.match(html, new RegExp(label, 'u'));
  assert.match(app, /返回全部 Collections/u);
  for (const marker of ['data-collection-link', 'mc-answer-form', 'type="radio"', '提交答案', '回答正确', '回答错误', '答题结果不会自动决定评分', 'mc-plan-form']) assert.match(app, new RegExp(marker, 'u'));
  assert.match(styles, /\.answer-feedback\.correct/u);
  assert.match(styles, /\.answer-feedback\.incorrect/u);
  assert.match(styles, /focus-visible/u);
  for (const endpoint of ['/api/mc/open', '/api/mc/answer', '/api/mc/rate', '/api/mc/plan']) assert.match(server, new RegExp(endpoint, 'u'));
});

test('formal package importer verifies manifest, SHA-256, provenance, preview and receipt', () => {
  const catalog = createInMemoryStudyContentCatalog();
  const importer = createGenericStudyContentPackageImporter({ catalog, clock: () => MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const preview = importer.dryRun({ input: SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, manifest: SYNTHETIC_MULTIPLE_CHOICE_MANIFEST });
  assert.equal(preview.ok, true);
  assert.equal(preview.mutationCount, 0);
  assert.equal(catalog.count(), 0);
  assert.equal(preview.contentDigest, SYNTHETIC_MULTIPLE_CHOICE_MANIFEST.contentDigest);
  const result = importer.import({ input: SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, manifest: SYNTHETIC_MULTIPLE_CHOICE_MANIFEST });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.importedCount, 24);
  assert.equal(result.receipt.persisted, false);
  assert.equal(result.provenance.classification, 'SYNTHETIC');
  assert.equal(catalog.count(), 24);
  const bad = { ...SYNTHETIC_MULTIPLE_CHOICE_MANIFEST, contentDigest: '0'.repeat(64) };
  assert.equal(createGenericStudyContentPackageImporter({ catalog: createInMemoryStudyContentCatalog() }).dryRun({ input: SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, manifest: bad }).error.code, 'MANIFEST_DIGEST_MISMATCH');
});

test('answer submission provides textual correct/incorrect feedback without creating rating evidence', () => {
  const content = SYNTHETIC_MULTIPLE_CHOICE_CONTENTS[0];
  const wrong = evaluateMultipleChoiceAnswer(content, content.options.find((item) => item !== content.correctAnswer));
  const correct = evaluateMultipleChoiceAnswer(content, content.correctAnswer);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correctAnswer, content.correctAnswer);
  assert.equal(correct.correct, true);
  assert.equal(correct.explanation, content.explanation);
});

test('collection, StudyItem, ReviewCard, progress, queue and limits remain isolated', () => {
  const sharedContentId = SYNTHETIC_MULTIPLE_CHOICE_CONTENTS[0].contentId;
  const secondCollection = createStudyCollection({ collectionId: 'second-identity-fixture', type: StudyCollectionType.QUESTION_BANK, title: 'Second identity fixture', description: null, source: 'test:synthetic', createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const partition = createLearnerDataPartition();
  const catalogA = createInMemoryStudyContentCatalog(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS);
  const catalogB = createInMemoryStudyContentCatalog([SYNTHETIC_MULTIPLE_CHOICE_CONTENTS[0]]);
  const adapterA = createQuestionAnswerStudyAdapter({ collectionId: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION.collectionId });
  const adapterB = createQuestionAnswerStudyAdapter({ collectionId: secondCollection.collectionId });
  const projectionA = adapterA.adapt(catalogA.get(sharedContentId));
  const projectionB = adapterB.adapt(catalogB.get(sharedContentId));
  assert.notEqual(projectionA.studyItem.itemId, projectionB.studyItem.itemId);
  assert.notEqual(projectionA.reviewCards[0].cardId, projectionB.reviewCards[0].cardId);
  const runtimeA = createGenericStudyRuntime({ learnerId: 'local-default', collection: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION, catalog: catalogA, adapter: adapterA, partition, scheduler: fsrs() });
  const runtimeB = createGenericStudyRuntime({ learnerId: 'local-default', collection: secondCollection, catalog: catalogB, adapter: adapterB, partition, scheduler: fsrs() });
  const planA = runtimeA.createPlan({ dailyNewLimit: 20, dailyReviewLimit: 3, dailyTotalLimit: 20 });
  const planB = runtimeB.createPlan({ dailyNewLimit: 1, dailyReviewLimit: 1, dailyTotalLimit: 1 });
  assert.equal(runtimeA.queue.build({ now: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, plan: planA }).total, 20);
  assert.equal(runtimeB.queue.build({ now: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, plan: planB }).total, 1);
  runtimeA.session.rate(sharedContentId, ReviewRating.AGAIN, { at: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  assert.equal(runtimeA.progressStore.get(projectionA.studyItem.itemId).reviewCount, 1);
  assert.equal(runtimeB.progressStore.get(projectionB.studyItem.itemId), null);
  assert.ok(runtimeA.queue.build({ now: '2026-08-22T00:01:00.000Z', plan: planA }).items.every((item) => item.collectionId === MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID));
});

test('generic rating keeps AGAIN 1m/10m, FSRS GOOD and MASTERED responsibilities separate', () => {
  const catalog = createInMemoryStudyContentCatalog(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS);
  const runtime = createGenericStudyRuntime({ learnerId: 'local-default', collection: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION, catalog, adapter: createQuestionAnswerStudyAdapter({ collectionId: MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID }), partition: createLearnerDataPartition(), scheduler: fsrs() });
  const contentId = SYNTHETIC_MULTIPLE_CHOICE_CONTENTS[0].contentId;
  const first = runtime.session.rate(contentId, ReviewRating.AGAIN, { at: '2026-08-22T00:00:00.000Z' });
  const second = runtime.session.rate(contentId, ReviewRating.AGAIN, { at: '2026-08-22T00:01:00.000Z' });
  const good = runtime.session.rate(contentId, ReviewRating.GOOD, { at: '2026-08-22T00:11:00.000Z' });
  assert.equal(first.schedule.dueAt, '2026-08-22T00:01:00.000Z');
  assert.equal(second.schedule.dueAt, '2026-08-22T00:11:00.000Z');
  assert.equal(good.schedule.schedulerType, 'fsrs');
  assert.ok(good.schedule.dueAt > '2026-08-22T00:11:00.000Z');
  assert.equal(runtime.session.master(contentId, { at: '2026-08-22T00:12:00.000Z' }).progress.stage, 'mastered');
});

test('Study Center discovery and statistics keep CET6 and MC collection breakdown', async () => {
  const real = await createLocalVocabularyLibrary({ filePath: join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json') }).load();
  assert.equal(real.entries.length, 5_311);
  const partition = createLearnerDataPartition();
  const catalog = createInMemoryStudyContentCatalog(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS);
  const mc = createGenericStudyRuntime({ learnerId: 'local-default', collection: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION, catalog, adapter: createQuestionAnswerStudyAdapter({ collectionId: MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID }), partition, scheduler: fallback() });
  const emptyCetQueue = { build: ({ now, plan }) => ({ generatedAt: now, plan, total: Math.min(20, real.entries.length), items: Array.from({ length: Math.min(20, real.entries.length) }, (_, index) => ({ queueReason: 'NEW', index })) }) };
  const cetStats = () => ({ stages: { new: 5_311, learning: 0, reviewing: 0, mastered: 0, suspended: 0 }, completionRate: 0, todayReview: 0 });
  const cetCollection = createCet6StudyCollection({ createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const cetPlan = createCollectionStudyPlan({ collectionId: cetCollection.collectionId, dailyNewLimit: 20, dailyReviewLimit: 20, dailyTotalLimit: 20 });
  const mcPlan = mc.createPlan({ dailyNewLimit: 12, dailyReviewLimit: 8, dailyTotalLimit: 20 });
  const home = createStudyCenterHomeViewModel({ learnerId: 'local-default', collections: [
    { collection: cetCollection, contentType: 'vocabulary', queue: emptyCetQueue, plan: cetPlan, getStatistics: cetStats },
    { collection: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION, contentType: 'multiple_choice', queue: mc.queue, plan: mcPlan, getStatistics: mc.getStatistics },
  ] }).load({ now: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  assert.deepEqual(home.collections.map((item) => [item.collectionId, item.contentType, item.totalItems]), [
    ['cet6-vocabulary', 'vocabulary', 5_311],
    [MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID, 'multiple_choice', 24],
  ]);
});

test('multi-collection library persistence and rollback preserve CET6, MC and learner state', async (t) => {
  const real = await createLocalVocabularyLibrary({ filePath: join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json') }).load();
  const directory = await mkdtemp(join(tmpdir(), 'nexa-multi-collection-library-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = createLocalVocabularyLibrary({ filePath: join(directory, 'study-library.json') });
  // Exercise the historical CET6 -> synthetic MC transition independently from
  // content collections already installed in the authoritative runtime library.
  await library.save({ version: real.version, entries: real.entries, imports: real.imports });
  const manager = createLocalVocabularyLibraryRestorePointManager({ directoryPath: join(directory, 'restore-points'), library, libraryIdentity: 'nexa-study-center-library', collectionId: 'all-study-collections' });
  const catalog = createInMemoryStudyContentCatalog();
  const workflow = createGenericStudyContentImportWorkflow({ catalog, library, restorePointManager: manager, clock: () => MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const preview = workflow.preview({ input: SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, manifest: SYNTHETIC_MULTIPLE_CHOICE_MANIFEST });
  assert.equal(preview.ok, true);
  assert.equal((await library.load()).contentCollections, undefined);
  const imported = await workflow.confirm(preview.previewId);
  assert.equal(imported.ok, true);
  assert.equal(imported.receipt.persisted, true);
  assert.equal(imported.receipt.rollbackCapable, true);
  const combined = await library.load();
  assert.equal(combined.entries.length, 5_311);
  assert.equal(combined.contentCollections.length, 1);
  assert.equal(combined.contentCollections[0].contents.length, 24);
  assert.equal(catalog.count(), 24);

  const partition = createLearnerDataPartition();
  const runtime = createGenericStudyRuntime({ learnerId: 'local-default', collection: SYNTHETIC_MULTIPLE_CHOICE_COLLECTION, catalog, adapter: createQuestionAnswerStudyAdapter({ collectionId: MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID }), partition, scheduler: fallback() });
  runtime.session.rate(SYNTHETIC_MULTIPLE_CHOICE_CONTENTS[0].contentId, ReviewRating.GOOD, { at: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const learnerBefore = createLearnerSnapshot(partition, { createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const libraryHashBefore = calculateVocabularyLibraryHash(combined);

  const sentinel = createMultipleChoiceContent({ contentId: 'mc:rollback:sentinel', contentType: 'multiple_choice', question: `${MULTIPLE_CHOICE_VALIDATION_MARKER}: rollback sentinel?`, answer: 'yes', options: ['yes', 'no'], correctAnswer: 'yes', explanation: null, tags: ['test', 'synthetic'], sourceRef: 'synthetic:rollback-sentinel', createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const sentinelInput = JSON.stringify({ schemaVersion: '0.1', contents: [sentinel] });
  const sentinelManifest = createStudyContentPackageManifest({ packageId: 'rollback-sentinel-v0-1', packageVersion: '0.1', collectionId: 'rollback-sentinel-collection', contentType: 'multiple_choice', itemCount: 1, contentDigest: calculateStudyContentDigest([sentinel]), provenance: { sourceId: 'synthetic:rollback-sentinel', classification: 'SYNTHETIC', title: 'Rollback sentinel', official: false, publicExamAuthority: null, originUrl: null, licenseId: null, evidenceRefs: ['fixture:rollback-sentinel'], acquiredAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, permissions: { localStorage: true, modification: true, redistribution: false }, notes: 'TEST / SYNTHETIC' }, createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP });
  const failing = createGenericStudyContentImportWorkflow({ catalog, library, restorePointManager: manager, clock: () => '2026-08-22T00:01:00.000Z', postImportValidate: async () => { throw Object.assign(new Error('controlled multi-collection failure'), { code: 'CONTROLLED_MULTI_COLLECTION_FAILURE' }); } });
  const failedPreview = failing.preview({ input: sentinelInput, manifest: sentinelManifest });
  const rolledBack = await failing.confirm(failedPreview.previewId);
  assert.equal(rolledBack.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(rolledBack.error.details.causeCode, 'CONTROLLED_MULTI_COLLECTION_FAILURE');
  const restored = await library.load();
  assert.equal(restored.entries.length, 5_311);
  assert.equal(restored.contentCollections.length, 1);
  assert.equal(restored.contentCollections[0].manifest.collectionId, MULTIPLE_CHOICE_VALIDATION_COLLECTION_ID);
  assert.equal(calculateVocabularyLibraryHash(restored), libraryHashBefore);
  assert.equal(catalog.count(), 24);
  assert.deepEqual(createLearnerSnapshot(partition, { createdAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP, updatedAt: MULTIPLE_CHOICE_VALIDATION_TIMESTAMP }), learnerBefore);
});
