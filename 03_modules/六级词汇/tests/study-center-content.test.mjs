import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CET6_STUDY_COLLECTION_ID,
  GenericStudyImportFormat,
  GenericStudySourceClassification,
  ReviewRating,
  StudyCollectionType,
  VocabularySourceClassification,
  calculateVocabularyContentDigest,
  createCollectionStudyPlan,
  createGenericStudyContentImporter,
  createGenericStudyRuntime,
  createInMemoryStudyContentCatalog,
  createInMemoryVocabularyStore,
  createLearnerDataPartition,
  createQuestionAnswerStudyAdapter,
  createSafeVocabularyPackageImporter,
  createSimpleSchedulerAdapter,
  createReviewScheduler,
  createStudyCenterHomeViewModel,
  createStudyCollection,
  createLearnerSnapshot,
  hydrateLearnerSnapshot,
} from '../src/index.mjs';
import { SYNTHETIC_STUDY_CONTENT_TIMESTAMP, SYNTHETIC_STUDY_CONTENTS } from '../fixtures/synthetic-study-content.mjs';
import { SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

const source = {
  classification: GenericStudySourceClassification.SYNTHETIC,
  sourceRef: 'test:synthetic-question-bank',
  importedAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
};
const fallback = () => createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });

test('vocabulary package dry-run verifies digest, quality, rights and zero mutation', () => {
  const store = createInMemoryVocabularyStore();
  const importer = createSafeVocabularyPackageImporter({ store, clock: () => SYNTHETIC_STUDY_CONTENT_TIMESTAMP });
  const input = JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES);
  const manifest = {
    packageId: 'cet6-test-package', packageVersion: '0.1', collectionId: CET6_STUDY_COLLECTION_ID,
    entryCount: 8, contentDigest: calculateVocabularyContentDigest(SYNTHETIC_VOCABULARY_ENTRIES),
    provenance: {
      sourceId: 'synthetic-cet6', classification: VocabularySourceClassification.SYNTHETIC,
      title: 'TEST / SYNTHETIC CET6 fixtures', originUrl: null, licenseId: null, rightsHolder: null,
      evidenceRefs: ['test:synthetic-cet6-fixture'], acquiredAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
      permissions: { localStorage: true, modification: true, redistribution: false }, notes: 'not an official word list',
    }, createdAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
  };
  const preview = importer.dryRun({ input, manifest });
  assert.equal(preview.ok, true); assert.equal(preview.mutationCount, 0); assert.equal(store.count(), 0);
  assert.equal(preview.quality.fixtureIdentity, 'TEST / SYNTHETIC');
  const imported = importer.import({ input, manifest });
  assert.equal(imported.ok, true); assert.equal(imported.receipt.importedCount, 8); assert.equal(store.count(), 8);
});

test('safe vocabulary import refuses forbidden storage, bad digest and conflicts', () => {
  const store = createInMemoryVocabularyStore();
  const importer = createSafeVocabularyPackageImporter({ store });
  const base = {
    packageId:'blocked-test',packageVersion:'0.1',collectionId:CET6_STUDY_COLLECTION_ID,entryCount:8,
    contentDigest:calculateVocabularyContentDigest(SYNTHETIC_VOCABULARY_ENTRIES),createdAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
    provenance:{sourceId:'blocked',classification:'SYNTHETIC',title:'blocked',originUrl:null,licenseId:null,rightsHolder:null,evidenceRefs:[],acquiredAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,permissions:{localStorage:false,modification:false,redistribution:false},notes:null},
  };
  assert.equal(importer.dryRun({ input: JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES), manifest: base }).error.code, 'LOCAL_STORAGE_NOT_PERMITTED');
  const allowed = structuredClone(base); allowed.provenance.permissions.localStorage = true; allowed.contentDigest = '0'.repeat(64);
  assert.equal(importer.dryRun({ input: JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES), manifest: allowed }).error.code, 'MANIFEST_DIGEST_MISMATCH');
});

test('generic JSON, CSV and Markdown importers preview without mutation and import atomically', () => {
  const formats = [
    [GenericStudyImportFormat.JSON, JSON.stringify({ schemaVersion:'0.1', contents:SYNTHETIC_STUDY_CONTENTS })],
    [GenericStudyImportFormat.CSV, 'contentId,contentType,question,answer,createdAt,updatedAt,tags\nqa:test:csv,question_answer,CSV question,CSV answer,2026-08-13T00:00:00.000Z,2026-08-13T00:00:00.000Z,test|synthetic'],
    [GenericStudyImportFormat.MARKDOWN, '## qa:test:markdown\nType: question_answer\nQuestion: Markdown question\nAnswer: Markdown answer\nTags: test|synthetic\nCreatedAt: 2026-08-13T00:00:00.000Z\nUpdatedAt: 2026-08-13T00:00:00.000Z'],
  ];
  for (const [format, input] of formats) {
    const catalog = createInMemoryStudyContentCatalog();
    const importer = createGenericStudyContentImporter({ format, catalog, source });
    assert.equal(importer.preview(input).ok, true); assert.equal(catalog.count(), 0);
    const result = importer.import(input); assert.equal(result.ok, true); assert.equal(catalog.count(), result.importedCount);
  }
});

test('generic importer rejects unknown fields, duplicate identities and third-party sources without license evidence', () => {
  const catalog = createInMemoryStudyContentCatalog();
  const importer = createGenericStudyContentImporter({ format:'JSON', catalog, source });
  const unknown = structuredClone(SYNTHETIC_STUDY_CONTENTS[0]); unknown.providerPayload = true;
  assert.equal(importer.preview(JSON.stringify({ schemaVersion:'0.1',contents:[unknown] })).ok, false);
  assert.equal(importer.preview(JSON.stringify({ schemaVersion:'0.1',contents:[SYNTHETIC_STUDY_CONTENTS[0],SYNTHETIC_STUDY_CONTENTS[0]] })).error.code, 'DUPLICATE_CONTENT_ID');
  assert.throws(() => createGenericStudyContentImporter({ format:'JSON', catalog, source:{...source,classification:'THIRD_PARTY'} }), /requires licenseId/);
});

test('QA and multiple-choice run through queue, rating, statistics and shared persistence authority', () => {
  const collection = createStudyCollection({ collectionId:'test-question-bank',type:StudyCollectionType.QUESTION_BANK,title:'TEST / SYNTHETIC Questions',description:null,source:'test:synthetic-question-bank',createdAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,updatedAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP });
  const catalog = createInMemoryStudyContentCatalog(SYNTHETIC_STUDY_CONTENTS);
  const partition = createLearnerDataPartition();
  const runtime = createGenericStudyRuntime({ learnerId:'local-default',collection,catalog,adapter:createQuestionAnswerStudyAdapter({collectionId:collection.collectionId}),partition,scheduler:fallback(),clock:()=>SYNTHETIC_STUDY_CONTENT_TIMESTAMP });
  const plan = runtime.createPlan({dailyNewLimit:2,dailyReviewLimit:2,dailyTotalLimit:2});
  assert.deepEqual(runtime.queue.build({now:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,plan}).items.map(i=>i.presentation.question), SYNTHETIC_STUDY_CONTENTS.map(i=>i.question));
  const result = runtime.session.rate(SYNTHETIC_STUDY_CONTENTS[0].contentId, ReviewRating.GOOD, {at:SYNTHETIC_STUDY_CONTENT_TIMESTAMP});
  assert.equal(result.rating,'good'); assert.equal(runtime.getStatistics({day:'2026-08-13',plan}).todayReview,1);
  assert.equal(partition.listReviewRecords('local-default').length,1);
  const restored=hydrateLearnerSnapshot(createLearnerSnapshot(partition,{createdAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,updatedAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP}));
  const restoredRuntime=createGenericStudyRuntime({learnerId:'local-default',collection,catalog,adapter:createQuestionAnswerStudyAdapter({collectionId:collection.collectionId}),partition:restored,scheduler:fallback()});
  assert.equal(restoredRuntime.getStatistics({day:'2026-08-13',plan}).todayReview,1);
});

test('generic Study Center Home aggregates independent collection runtimes', () => {
  const collection = createStudyCollection({ collectionId:'test-question-bank',type:StudyCollectionType.QUESTION_BANK,title:'Questions',description:null,source:'test:source',createdAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP,updatedAt:SYNTHETIC_STUDY_CONTENT_TIMESTAMP });
  const catalog = createInMemoryStudyContentCatalog(SYNTHETIC_STUDY_CONTENTS);
  const runtime = createGenericStudyRuntime({learnerId:'local-default',collection,catalog,adapter:createQuestionAnswerStudyAdapter({collectionId:collection.collectionId}),partition:createLearnerDataPartition(),scheduler:fallback()});
  const plan=createCollectionStudyPlan({collectionId:collection.collectionId,dailyNewLimit:2,dailyReviewLimit:2,dailyTotalLimit:2});
  const home=createStudyCenterHomeViewModel({learnerId:'local-default',collections:[{collection,queue:runtime.queue,plan,getStatistics:runtime.getStatistics}]}).load({now:SYNTHETIC_STUDY_CONTENT_TIMESTAMP});
  assert.equal(home.collections[0].todayCount,2); assert.equal(home.newTotal,2); assert.equal(home.completionRate,0);
});
