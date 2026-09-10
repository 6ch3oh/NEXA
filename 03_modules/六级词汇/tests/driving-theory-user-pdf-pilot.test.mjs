import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DRIVING_THEORY_USER_PDF_COLLECTION,
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  DRIVING_THEORY_USER_PDF_PILOT_CONTENTS,
  DRIVING_THEORY_USER_PDF_PILOT_ITEMS,
  DRIVING_THEORY_USER_PDF_PILOT_MANIFEST,
  DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT,
  DRIVING_THEORY_USER_PDF_SHA256,
  ReviewRating,
  calculateStudyContentDigest,
  calculateVocabularyLibraryHash,
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
  createStudyContentPackageManifest,
  evaluateMultipleChoiceAnswer,
} from '../src/index.mjs';
import {
  SYNTHETIC_MULTIPLE_CHOICE_MANIFEST,
  SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT,
} from '../fixtures/synthetic-multiple-choice-validation-pack.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePdf = String.raw`E:\科目一精简500题＋新规题-先看我.pdf`;
const fixedTime = '2026-08-22T00:00:00.000Z';
const fallback = () => createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
const fsrs = () => createFsrsSchedulerAdapter({ fallbackScheduler: fallback() });

test('user PDF source identity and explicit private/unverified provenance are stable', async () => {
  const bytes = await readFile(sourcePdf);
  assert.equal((await stat(sourcePdf)).size, 131_637_851);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), DRIVING_THEORY_USER_PDF_SHA256);
  const manifest = JSON.parse(await readFile(join(moduleRoot, 'staging', 'driving-theory-user-source', 'source-manifest.json'), 'utf8'));
  assert.equal(manifest.sourceSha256, DRIVING_THEORY_USER_PDF_SHA256);
  assert.equal(manifest.actualPageCount, 501);
  assert.equal(manifest.sourceClassification, 'USER_PROVIDED');
  assert.equal(manifest.originClassification, 'THIRD_PARTY_SOURCE_UNVERIFIED');
  assert.equal(manifest.official, false);
  assert.equal(manifest.permissions.redistribution, false);
  assert.equal(manifest.permissions.nexaBundling, false);
  assert.equal(manifest.networkUsed, false);
});

test('20 qualified questions preserve page identity, source type and answer mapping', () => {
  assert.equal(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.length, 20);
  assert.deepEqual(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.map((item) => item.sourcePage), [2,3,5,7,12,15,16,18,24,31,38,46,49,64,66,71,83,116,123,139]);
  assert.equal(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.filter((item) => item.sourceQuestionType === 'TRUE_FALSE').length, 2);
  assert.equal(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.filter((item) => item.sourceQuestionType === 'MC').length, 18);
  for (const item of DRIVING_THEORY_USER_PDF_PILOT_ITEMS) {
    const optionIndex = item.sourceAnswer.charCodeAt(0) - 65;
    assert.equal(item.content.options[optionIndex], item.canonicalCorrectAnswer);
    assert.equal(item.content.correctAnswer, item.canonicalCorrectAnswer);
    assert.equal(item.content.contentType, 'multiple_choice');
    assert.equal(item.extractionStatus, 'PASS');
    assert.match(item.sourceQuestionIdentity, new RegExp(`page:${item.sourcePage}$`, 'u'));
    if (item.sourceQuestionType === 'TRUE_FALSE') assert.deepEqual(item.content.options, ['正确', '错误']);
  }
});

test('16 required question images exist with stable hash, dimensions and provenance', async () => {
  const withMedia = DRIVING_THEORY_USER_PDF_PILOT_ITEMS.filter((item) => item.hasQuestionImage);
  assert.equal(withMedia.length, 16);
  for (const item of withMedia) {
    const media = item.questionImageAsset;
    const file = join(moduleRoot, 'staging', 'driving-theory-user-source', 'derived-media', `page-${String(item.sourcePage).padStart(3, '0')}-question.jpg`);
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), media.derivedAssetSha256);
    assert.deepEqual(jpegDimensions(bytes), { width: media.width, height: media.height });
    assert.equal(media.sourcePdfSha256, DRIVING_THEORY_USER_PDF_SHA256);
    assert.equal(media.sourcePage, item.sourcePage);
    assert.match(media.derivationMethod, /NO_AI/u);
    assert.match(media.derivationMethod, /NO_WATERMARK_REMOVAL/u);
  }
});

test('formal package preview is read-only and import emits validated receipt', () => {
  const catalog = createInMemoryStudyContentCatalog();
  const importer = createGenericStudyContentPackageImporter({ catalog, clock: () => fixedTime });
  const preview = importer.dryRun({ input: DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT, manifest: DRIVING_THEORY_USER_PDF_PILOT_MANIFEST });
  assert.equal(preview.ok, true);
  assert.equal(preview.mutationCount, 0);
  assert.equal(catalog.count(), 0);
  const imported = importer.import({ input: DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT, manifest: DRIVING_THEORY_USER_PDF_PILOT_MANIFEST });
  assert.equal(imported.ok, true);
  assert.equal(imported.receipt.importedCount, 20);
  assert.equal(imported.provenance.classification, 'USER_PROVIDED');
  assert.equal(imported.provenance.official, false);
  assert.equal(catalog.count(), 20);
});

test('answer, AGAIN 1m/10m, FSRS GOOD and mastered flow use the generic runtime', () => {
  const catalog = createInMemoryStudyContentCatalog(DRIVING_THEORY_USER_PDF_PILOT_CONTENTS);
  const partition = createLearnerDataPartition();
  const runtime = createGenericStudyRuntime({ learnerId:'local-default', collection:DRIVING_THEORY_USER_PDF_COLLECTION, catalog, adapter:createQuestionAnswerStudyAdapter({ collectionId:DRIVING_THEORY_USER_PDF_COLLECTION_ID }), partition, scheduler:fsrs() });
  const item = DRIVING_THEORY_USER_PDF_PILOT_ITEMS[0];
  assert.equal(evaluateMultipleChoiceAnswer(item.content, item.content.options.find((option) => option !== item.canonicalCorrectAnswer)).correct, false);
  assert.equal(evaluateMultipleChoiceAnswer(item.content, item.canonicalCorrectAnswer).correct, true);
  const one = runtime.session.rate(item.content.contentId, ReviewRating.AGAIN, { at:fixedTime });
  const ten = runtime.session.rate(item.content.contentId, ReviewRating.AGAIN, { at:'2026-08-22T00:01:00.000Z' });
  const good = runtime.session.rate(item.content.contentId, ReviewRating.GOOD, { at:'2026-08-22T00:11:00.000Z' });
  assert.equal(one.schedule.dueAt, '2026-08-22T00:01:00.000Z');
  assert.equal(ten.schedule.dueAt, '2026-08-22T00:11:00.000Z');
  assert.equal(good.schedule.schedulerType, 'fsrs');
  assert.equal(runtime.session.master(item.content.contentId, { at:'2026-08-22T00:12:00.000Z' }).progress.stage, 'mastered');
  assert.equal(createLearnerSnapshot(partition, { createdAt:fixedTime, updatedAt:fixedTime }).learners[0].reviewRecords.length, 3);
});

test('formal workflow persists CET6 + synthetic MC + private PDF and rolls back a controlled failure', async (t) => {
  const real = await createLocalVocabularyLibrary({ filePath:join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-library.json') }).load();
  assert.equal(real.entries.length, 5_311);
  const directory = await mkdtemp(join(tmpdir(), 'nexa-driving-user-pdf-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const library = createLocalVocabularyLibrary({ filePath:join(directory, 'library.json') });
  // This Pilot workflow fixture intentionally starts before any generic content
  // collection; the authoritative runtime library may now contain the full pack.
  await library.save({ version: real.version, entries: real.entries, imports: real.imports });
  const manager = createLocalVocabularyLibraryRestorePointManager({ directoryPath:join(directory, 'restore'), library, libraryIdentity:'nexa-study-center-library', collectionId:'all-study-collections' });
  const catalog = createInMemoryStudyContentCatalog();
  const workflow = (clock, postImportValidate) => createGenericStudyContentImportWorkflow({ catalog, library, restorePointManager:manager, clock:() => clock, ...(postImportValidate ? { postImportValidate } : {}) });
  for (const [input, manifest, at] of [[SYNTHETIC_MULTIPLE_CHOICE_PACKAGE_INPUT, SYNTHETIC_MULTIPLE_CHOICE_MANIFEST, fixedTime], [DRIVING_THEORY_USER_PDF_PILOT_PACKAGE_INPUT, DRIVING_THEORY_USER_PDF_PILOT_MANIFEST, '2026-08-22T00:01:00.000Z']]) {
    const current = workflow(at);
    const preview = current.preview({ input, manifest });
    assert.equal(preview.ok, true);
    assert.equal((await library.load()).contentCollections?.length ?? 0, at === fixedTime ? 0 : 1);
    assert.equal((await current.confirm(preview.previewId)).ok, true);
  }
  const before = await library.load();
  assert.equal(before.entries.length, 5_311);
  assert.deepEqual(before.contentCollections.map((entry) => [entry.manifest.collectionId, entry.contents.length]), [['multiple-choice-validation-pack',24], [DRIVING_THEORY_USER_PDF_COLLECTION_ID,20]]);
  const hash = calculateVocabularyLibraryHash(before);
  const sentinel = createMultipleChoiceContent({ contentId:'driving:rollback:sentinel', contentType:'multiple_choice', question:'TEST sentinel?', answer:'yes', options:['yes','no'], correctAnswer:'yes', explanation:null, tags:['test','synthetic'], sourceRef:'test:sentinel', createdAt:fixedTime, updatedAt:fixedTime });
  const manifest = createStudyContentPackageManifest({ packageId:'driving-rollback-sentinel', packageVersion:'0.1', collectionId:'driving-rollback-sentinel', contentType:'multiple_choice', itemCount:1, contentDigest:calculateStudyContentDigest([sentinel]), provenance:{ sourceId:'test:sentinel', classification:'SYNTHETIC', title:'sentinel', official:false, publicExamAuthority:null, originUrl:null, licenseId:null, evidenceRefs:['test'], acquiredAt:fixedTime, permissions:{ localStorage:true, modification:true, redistribution:false }, notes:'TEST / SYNTHETIC' }, createdAt:fixedTime });
  const failing = workflow('2026-08-22T00:02:00.000Z', async () => { throw Object.assign(new Error('controlled'), { code:'CONTROLLED_PILOT_FAILURE' }); });
  const failedPreview = failing.preview({ input:JSON.stringify({ schemaVersion:'0.1', contents:[sentinel] }), manifest });
  const rolledBack = await failing.confirm(failedPreview.previewId);
  assert.equal(rolledBack.error.code, 'IMPORT_ROLLED_BACK');
  assert.equal(rolledBack.error.details.causeCode, 'CONTROLLED_PILOT_FAILURE');
  assert.equal(calculateVocabularyLibraryHash(await library.load()), hash);
  assert.equal(catalog.count(), 44);
});

test('UI exposes an independent private collection, media endpoint and explicit failure state', async () => {
  const [app, server, styles] = await Promise.all(['app.mjs','server.mjs','styles.css'].map((name) => readFile(join(moduleRoot, 'ui', name), 'utf8')));
  for (const marker of ['driving-theory-user-pdf-pilot','/api/driving/open','/api/driving/answer','/api/driving/rate','/api/driving/master','/api/driving/plan','question-media','题图加载失败']) assert.match(`${app}\n${server}`, new RegExp(marker, 'u'));
  assert.match(server, /private-media\/driving-user-pdf/u);
  assert.match(styles, /\.question-media img/u);
  assert.match(styles, /\.question-media\.media-error/u);
});

function jpegDimensions(bytes) {
  let offset = 2;
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8);
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]; offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = bytes.readUInt16BE(offset);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) return { height:bytes.readUInt16BE(offset + 3), width:bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  throw new Error('JPEG dimensions not found');
}
