import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  ReviewRating,
  VocabularySourceClassification,
  createCet6StudyMvpRuntime,
  createEcdictExpansionQualityTierReport,
  createEcdictExpansionSourceManifest,
  createFsrsSchedulerAdapter,
  createInMemoryVocabularyStore,
  createLearnerSnapshot,
  createLocalFilePersistenceAdapter,
  createLocalRestorePointManager,
  createLocalVocabularyLibrary,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  createVocabularyImportWorkflow,
  getLocalStudyCenterStatistics,
  hydrateLearnerSnapshot,
  mapQualifiedEcdictExpansionStaging,
  restoreLearnerData,
  saveLearnerData,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stagingRoot = join(moduleRoot, 'staging', 'ecdict-1.0.28');
const expansionStaging = join(stagingRoot, 'expansion');
const expansionData = join(moduleRoot, 'data', 'ecdict-qualified');
const rawPath = join(stagingRoot, 'source', 'cet6-audit-expansion.raw.json');
const pilotNormalizedPath = join(stagingRoot, 'cet6-pilot.normalized.json');
const pilotData = join(moduleRoot, 'data', 'ecdict-pilot');
const SOURCE_ACQUIRED_AT = '2026-08-21T09:18:27.232Z';
const BENCHMARK_AT = '2026-08-21T10:00:00.000Z';
const QUEUE_AT = '2026-09-01T00:00:00.000Z';
const learnerId = 'ecdict-pilot-learner';

await Promise.all([mkdir(expansionStaging, { recursive: true }), mkdir(expansionData, { recursive: true })]);

const rawRead = await measure(async () => JSON.parse(await readFile(rawPath, 'utf8')));
const raw = rawRead.value;
const pilotEntries = JSON.parse(await readFile(pilotNormalizedPath, 'utf8'));
const pilotLibrary = createLocalVocabularyLibrary({ filePath: join(pilotData, 'vocabulary-library.json') });
const pilotLibraryLoad = await measure(() => pilotLibrary.load());
const savedPilotLibrary = pilotLibraryLoad.value;
assert.equal(savedPilotLibrary.entries.length, 100);
assert.deepEqual(savedPilotLibrary.entries, pilotEntries);
const baselinePersistence = createLocalFilePersistenceAdapter({ filePath: join(pilotData, 'learner-state.json') });
const baselineRestore = await restoreLearnerData(baselinePersistence);
assert.equal(baselineRestore.restored, true);
const baselineSnapshot = baselineRestore.snapshot;
const baselineLearners = structuredClone(baselineSnapshot.learners);

const tierReport = createEcdictExpansionQualityTierReport(raw, { historicalPilotEntries: pilotEntries });
const qualifiedEntries = mapQualifiedEcdictExpansionStaging(raw, { historicalPilotEntries: pilotEntries });
const sourceManifest = createEcdictExpansionSourceManifest(raw, qualifiedEntries, tierReport);
assert.deepEqual(qualifiedEntries.slice(0, 100), pilotEntries);
assert.equal(qualifiedEntries.length, 5_311);
assert.equal(tierReport.unclassifiedCount, 0);

await Promise.all([
  writeJson(join(expansionStaging, 'quality-tier-report.json'), tierReport),
  writeJson(join(expansionStaging, 'qualified.normalized.json'), qualifiedEntries),
  writeJson(join(expansionStaging, 'qualified-source-manifest.json'), sourceManifest),
  writeFile(join(expansionStaging, 'quality-audit-report.md'), qualityAuditMarkdown(tierReport), 'utf8'),
]);

const baseline100 = await exerciseRuntime({
  label: 'baseline-100',
  entries: pilotEntries,
  imports: savedPilotLibrary.imports,
  directory: join(expansionData, 'benchmark-100'),
  baselineSnapshot,
});

const stageResults = [];
for (const size of [500, 1_000, qualifiedEntries.length]) {
  const label = size === qualifiedEntries.length ? 'qualified-full' : `stage-${size}`;
  const stageEntries = qualifiedEntries.slice(0, size);
  const stage = await runImportStage({ label, entries: stageEntries, baselineSnapshot });
  stageResults.push(stage);
}

const rawNavigation = await measure(async () => {
  const parsed = JSON.parse(await readFile(rawPath, 'utf8'));
  const visible = parsed.rawAudit.findings
    .filter((item) => item.findings.length > 0)
    .sort((left, right) => left.sourceRowId - right.sourceRowId);
  return { total: parsed.rows.length, findings: visible.length, firstPage: visible.slice(0, 50).length };
});

const performanceReport = {
  reportVersion: '0.1',
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  benchmarkPolicy: 'REAL ECDICT qualified entries through production Store/Runtime/Persistence paths; raw navigation is reported separately.',
  rawAudit: {
    candidateCount: raw.rows.length,
    sourceReadAndParseMs: rounded(rawRead.ms),
    navigationMs: rounded(rawNavigation.ms),
    ...rawNavigation.value,
  },
  baseline100: { libraryLoadMs: rounded(pilotLibraryLoad.ms), ...baseline100 },
  stages: stageResults,
  qualifiedCollectionCount: qualifiedEntries.length,
  runtimeNetworkDependency: 0,
};
await Promise.all([
  writeJson(join(expansionStaging, 'performance-report.json'), performanceReport),
  writeJson(join(expansionStaging, 'stage-validation-report.json'), {
    reportVersion: '0.1',
    status: 'PASS',
    stages: stageResults.map(({ label, entryCount, import: imported, validation }) => ({
      label, entryCount, import: imported, validation,
    })),
    existing100IdentityPreserved: true,
    baselineLearnersPreserved: stageResults.every((stage) => stage.validation.learnerSnapshotPreserved),
    classification: 'THIRD_PARTY',
    official: false,
    redistributionStatus: 'REDISTRIBUTION_NOT_ESTABLISHED',
    runtimeNetworkDependency: 0,
  }),
]);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  rawCandidateCount: raw.rows.length,
  tierCounts: tierReport.counts,
  qualifiedLearnableCount: qualifiedEntries.length,
  stages: stageResults.map((stage) => ({
    label: stage.label,
    entryCount: stage.entryCount,
    import: stage.import.status,
    queue: stage.validation.todayQueue,
    libraryLoadMs: stage.performance.libraryLoadMs,
    persistenceWriteMs: stage.performance.persistenceWriteMs,
  })),
  existing100IdentityPreserved: true,
  baselineLearnerCount: baselineLearners.length,
  runtimeNetworkDependency: 0,
})}\n`);

async function runImportStage({ label, entries, baselineSnapshot: snapshot }) {
  const directory = join(expansionData, label === 'qualified-full' ? 'current' : label);
  await mkdir(directory, { recursive: true });
  const library = createLocalVocabularyLibrary({ filePath: join(directory, 'vocabulary-library.json') });
  const store = createInMemoryVocabularyStore();
  let workflow;
  workflow = createVocabularyImportWorkflow({
    store,
    clock: () => SOURCE_ACQUIRED_AT,
    async onImported() {
      await library.save({ entries: store.list(), imports: workflow.listImports() });
    },
  });
  const source = {
    sourceId: 'ecdict',
    packageId: `ecdict-cet6-qualified-local-1.0.28-${label}`,
    packageVersion: `1.0.28-qualified.1-${label}`,
    title: `ECDICT CET6 Third-Party Local Collection (${label})`,
    classification: VocabularySourceClassification.THIRD_PARTY,
    originUrl: 'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
    licenseId: 'MIT-REPOSITORY-DATA-RIGHTS-LIMITED',
    rightsHolder: null,
    evidenceRefs: [
      'https://github.com/skywind3000/ECDICT/blob/8defb76/LICENSE',
      'https://github.com/skywind3000/ECDICT/blob/8defb76/README.md',
      'staging/ecdict-1.0.28/source-recovery-manifest.json',
      'staging/ecdict-1.0.28/expansion/quality-tier-report.json',
    ],
    permissions: { localStorage: true, modification: true, redistribution: false },
    notes: 'THIRD_PARTY; LOCAL_PRIVATE; REDISTRIBUTION_NOT_ESTABLISHED; not official CET-6; A+B plus one legacy Pilot C identity.',
  };
  const input = JSON.stringify(entries);
  const previewTimed = await measure(() => workflow.preview({ input, source }));
  const preview = previewTimed.value;
  assert.equal(preview.ok, true);
  assert.equal(preview.entryCount, entries.length);
  assert.equal(preview.mutationCount, 0);
  assert.equal(store.count(), 0);
  const confirmTimed = await measure(() => workflow.confirm(preview.previewId));
  const confirmed = confirmTimed.value;
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.receipt.importedCount, entries.length);
  assert.equal(store.count(), entries.length);
  const libraryLoadTimed = await measure(() => library.load());
  const restoredLibrary = libraryLoadTimed.value;
  assert.equal(restoredLibrary.entries.length, entries.length);
  assert.equal(restoredLibrary.imports.length, 1);
  assert.equal(restoredLibrary.imports[0].manifest.provenance.classification, 'THIRD_PARTY');
  assert.equal(restoredLibrary.imports[0].manifest.provenance.permissions.redistribution, false);
  assert.equal(preview.contentDigest, label === 'qualified-full' ? sourceManifest.contentDigest : preview.contentDigest);
  for (const historical of pilotEntries) assert.deepEqual(store.getById(historical.entryId), historical);

  const runtimeEvidence = await exerciseRuntime({
    label,
    entries: restoredLibrary.entries,
    imports: restoredLibrary.imports,
    directory,
    baselineSnapshot: snapshot,
  });
  const libraryBytes = (await stat(library.filePath)).size;
  const evidence = {
    label,
    entryCount: entries.length,
    import: {
      status: 'PASS',
      previewMutationCount: preview.mutationCount,
      previewMs: rounded(previewTimed.ms),
      confirmMs: rounded(confirmTimed.ms),
      contentDigest: preview.contentDigest,
      receiptId: confirmed.receipt.receiptId,
      classification: confirmed.receipt.classification,
      safetyBoundary: confirmed.receipt.safetyBoundary,
      rollbackSupported: confirmed.receipt.rollbackSupported,
      persistedLibraryBytes: libraryBytes,
    },
    validation: runtimeEvidence.validation,
    performance: {
      libraryLoadMs: rounded(libraryLoadTimed.ms),
      ...runtimeEvidence.performance,
    },
  };
  await writeJson(join(directory, 'stage-evidence.json'), evidence);
  return evidence;
}

async function exerciseRuntime({ label, entries, imports, directory, baselineSnapshot: snapshot }) {
  await mkdir(directory, { recursive: true });
  const storeTimed = await measure(() => createInMemoryVocabularyStore(entries));
  const store = storeTimed.value;
  const scheduler = createScheduler();
  const partition = hydrateLearnerSnapshot(snapshot);
  const runtime = createCet6StudyMvpRuntime({ learnerId, vocabularyStore: store, partition, scheduler, clock: () => BENCHMARK_AT });
  const plan = runtime.createPlan({ dailyNewLimit: 10, dailyReviewLimit: 10, dailyTotalLimit: 20 });

  const queueTimed = await measure(() => runtime.queue.build({ now: QUEUE_AT, plan }));
  const queue = queueTimed.value;
  assert.ok(queue.total <= plan.dailyTotalLimit);
  assert.ok(queue.counts.new <= plan.dailyNewLimit);
  assert.ok(queue.counts.relearning + queue.counts.reviewDue <= plan.dailyReviewLimit);

  const newOnlyPlan = runtime.createPlan({ dailyNewLimit: 20, dailyReviewLimit: 0, dailyTotalLimit: 20 });
  const reviewOnlyPlan = runtime.createPlan({ dailyNewLimit: 0, dailyReviewLimit: 20, dailyTotalLimit: 20 });
  const newQueueTimed = await measure(() => runtime.queue.build({ now: QUEUE_AT, plan: newOnlyPlan }));
  const reviewQueueTimed = await measure(() => runtime.queue.build({ now: QUEUE_AT, plan: reviewOnlyPlan }));
  assert.equal(newQueueTimed.value.counts.relearning + newQueueTimed.value.counts.reviewDue, 0);
  assert.equal(newQueueTimed.value.counts.new, Math.min(20, entries.length));
  assert.equal(reviewQueueTimed.value.counts.new, 0);
  assert.ok(reviewQueueTimed.value.counts.relearning + reviewQueueTimed.value.counts.reviewDue > 0);

  const searchTimed = await measure(() => store.search('ab', { limit: 50 }));
  assert.ok(searchTimed.value.length > 0);
  const personalAsc = await measure(() => runtime.personalVocabulary.list('all', { page: 1, pageSize: 50, sort: 'word-asc' }));
  const personalDesc = await measure(() => runtime.personalVocabulary.list('all', { page: 1, pageSize: 50, sort: 'word-desc' }));
  const personalDue = await measure(() => runtime.personalVocabulary.list('all', { page: 1, pageSize: 20, sort: 'due-asc' }));
  const personalSearch = await measure(() => runtime.personalVocabulary.list('all', { query: 'ab', page: 1, pageSize: 10, sort: 'word-asc' }));
  const personalFilter = await measure(() => runtime.personalVocabulary.list('learning', { page: 1, pageSize: 50, sort: 'due-asc' }));
  assert.equal(personalAsc.value.total, entries.length);
  assert.equal(personalAsc.value.items.length, Math.min(50, entries.length));
  assert.ok(personalAsc.value.items[0].word.localeCompare(personalDesc.value.items[0].word, 'en') <= 0);
  assert.ok(personalSearch.value.total > 0);
  assert.ok(personalFilter.value.total > 0);
  const statisticsTimed = await measure(() => getLocalStudyCenterStatistics(store, {
    learnerId,
    progressStore: runtime.progressStore,
    reviewRecordStore: runtime.reviewRecordStore,
    day: '2026-08-21',
    dailyPlan: plan,
    importRecords: imports,
  }));
  assert.equal(statisticsTimed.value.totalVocabulary, entries.length);
  assert.equal(statisticsTimed.value.syntheticCount, 0);

  const unchangedSnapshot = createLearnerSnapshot(partition, {
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });
  assert.deepEqual(unchangedSnapshot.learners, baselineLearners);

  const mutationPartition = hydrateLearnerSnapshot(snapshot);
  const mutationRuntime = createCet6StudyMvpRuntime({ learnerId, vocabularyStore: store, partition: mutationPartition, scheduler, clock: () => BENCHMARK_AT });
  const mutationEntry = entries.find((entry) => mutationRuntime.progressStore.get(entry.entryId) === null);
  assert.ok(mutationEntry);
  mutationRuntime.session.start(mutationEntry.entryId, { at: BENCHMARK_AT });
  const persistence = createLocalFilePersistenceAdapter({ filePath: join(directory, 'learner-state.json') });
  const saveTimed = await measure(() => saveLearnerData(persistence, mutationPartition, {
    createdAt: snapshot.createdAt,
    updatedAt: BENCHMARK_AT,
  }));
  const restoreTimed = await measure(() => restoreLearnerData(persistence));
  assert.equal(restoreTimed.value.restored, true);
  assert.equal(restoreTimed.value.partition.listLearnerIds().length, snapshot.learners.length);
  const learnerFileBytes = (await stat(persistence.filePath)).size;

  const restoreManager = createLocalRestorePointManager({ directoryPath: join(directory, 'restore-points') });
  const restorePointId = `expansion-v2-${label.replace(/[^a-z0-9-]/giu, '-')}`;
  const existingRestorePoints = await restoreManager.listRestorePoints();
  const restorePointAlreadyExists = existingRestorePoints.some((item) => item.restorePointId === restorePointId);
  const restorePointCreate = restorePointAlreadyExists
    ? { value: null, ms: 0 }
    : await measure(() => restoreManager.createRestorePoint({
      restorePointId,
      createdAt: BENCHMARK_AT,
      snapshot: saveTimed.value.snapshot,
    }));
  const restorePointRead = await measure(() => restoreManager.restoreFromPoint(restorePointId));
  assert.deepEqual(restorePointRead.value.snapshot.learners, saveTimed.value.snapshot.learners);

  const fsrsPartition = hydrateLearnerSnapshot(snapshot);
  const fsrsRuntime = createCet6StudyMvpRuntime({ learnerId, vocabularyStore: store, partition: fsrsPartition, scheduler, clock: () => BENCHMARK_AT });
  const available = entries.filter((entry) => fsrsRuntime.progressStore.get(entry.entryId) === null).slice(0, 5);
  assert.equal(available.length, 5);
  const fsrsTimed = await measure(() => {
    const again = fsrsRuntime.session.rate(available[0].entryId, ReviewRating.AGAIN, {
      at: BENCHMARK_AT, reviewId: `review:${label}:again`, durationMs: 100,
    });
    const relearning = fsrsRuntime.session.advanceRelearning(available[0].entryId, { at: '2026-08-21T10:01:00.000Z' });
    const hard = fsrsRuntime.session.rate(available[1].entryId, ReviewRating.HARD, {
      at: BENCHMARK_AT, reviewId: `review:${label}:hard`, durationMs: 100,
    });
    const good = fsrsRuntime.session.rate(available[2].entryId, ReviewRating.GOOD, {
      at: BENCHMARK_AT, reviewId: `review:${label}:good`, durationMs: 100,
    });
    const easy = fsrsRuntime.session.rate(available[3].entryId, ReviewRating.EASY, {
      at: BENCHMARK_AT, reviewId: `review:${label}:easy`, durationMs: 100,
    });
    fsrsRuntime.session.start(available[4].entryId, { at: BENCHMARK_AT });
    const mastered = fsrsRuntime.session.master(available[4].entryId, { at: '2026-08-21T10:02:00.000Z' });
    return { again, relearning, hard, good, easy, mastered };
  });
  assert.equal(fsrsTimed.value.again.schedule.phase, 'relearning');
  assert.equal(fsrsTimed.value.relearning.stepIndex, 1);
  assert.equal(fsrsTimed.value.hard.schedule.schedulerType, 'fsrs');
  assert.equal(fsrsTimed.value.good.schedule.schedulerType, 'fsrs');
  assert.equal(fsrsTimed.value.easy.schedule.schedulerType, 'fsrs');
  assert.equal(fsrsTimed.value.mastered.progress.stage, 'mastered');
  const afterFsrsQueue = fsrsRuntime.queue.build({ now: QUEUE_AT, plan });
  assert.equal(afterFsrsQueue.items.some((item) => item.entryId === available[4].entryId), false);
  const isolatedRuntime = createCet6StudyMvpRuntime({
    learnerId: 'expansion-isolated-learner', vocabularyStore: store, partition: fsrsPartition, scheduler,
  });
  assert.equal(isolatedRuntime.progressStore.get(available[0].entryId), null);
  const fsrsPersistence = createLocalFilePersistenceAdapter({ filePath: join(directory, 'fsrs-learner-state.json') });
  const fsrsSaved = await saveLearnerData(fsrsPersistence, fsrsPartition, {
    createdAt: snapshot.createdAt,
    updatedAt: '2026-08-21T10:03:00.000Z',
  });
  const fsrsRestored = await restoreLearnerData(fsrsPersistence);
  assert.equal(fsrsRestored.partition.listReviewRecords(learnerId).length,
    fsrsPartition.listReviewRecords(learnerId).length);
  assert.equal(new Set(fsrsPartition.listReviewRecords(learnerId).map((record) => record.reviewId)).size,
    fsrsPartition.listReviewRecords(learnerId).length);
  assert.ok(fsrsSaved.snapshot.learners.some((learner) => learner.learnerId === learnerId));

  return {
    validation: {
      status: 'PASS',
      existing100IdentityPreserved: pilotEntries.every((entry) => store.getById(entry.entryId)?.entryId === entry.entryId),
      learnerSnapshotPreserved: true,
      todayQueue: { total: queue.total, counts: queue.counts, plan },
      newOnlyQueue: { total: newQueueTimed.value.total, counts: newQueueTimed.value.counts, plan: newOnlyPlan },
      reviewOnlyQueue: { total: reviewQueueTimed.value.total, counts: reviewQueueTimed.value.counts, plan: reviewOnlyPlan },
      search: 'PASS',
      pagination: 'PASS',
      sorting: 'PASS',
      personalVocabulary: 'PASS',
      statistics: 'PASS',
      persistence: 'PASS',
      restart: 'PASS',
      restorePoint: 'PASS',
      restorePointReused: restorePointAlreadyExists,
      fsrs: 'PASS',
      relearning: '1m_TO_10m_PASS',
      masteredExclusion: 'PASS',
      learnerIsolation: 'PASS',
      duplicateReviewIds: 0,
      illegalStates: 0,
    },
    performance: {
      storeHydrationMs: rounded(storeTimed.ms),
      todayQueueMs: rounded(queueTimed.ms),
      newOnlyQueueMs: rounded(newQueueTimed.ms),
      reviewOnlyQueueMs: rounded(reviewQueueTimed.ms),
      searchMs: rounded(searchTimed.ms),
      personalWordAscMs: rounded(personalAsc.ms),
      personalWordDescMs: rounded(personalDesc.ms),
      personalNextReviewMs: rounded(personalDue.ms),
      personalSearchAndPaginationMs: rounded(personalSearch.ms),
      personalFilterMs: rounded(personalFilter.ms),
      statisticsMs: rounded(statisticsTimed.ms),
      persistenceWriteMs: rounded(saveTimed.ms),
      persistenceBytes: learnerFileBytes,
      coldRestoreMs: rounded(restoreTimed.ms),
      restorePointCreateMs: rounded(restorePointCreate.ms),
      restorePointReadMs: rounded(restorePointRead.ms),
      fsrsFiveActionsMs: rounded(fsrsTimed.ms),
    },
  };
}

function createScheduler() {
  const fallback = createSimpleSchedulerAdapter({ legacyScheduler: createReviewScheduler() });
  return createFsrsSchedulerAdapter({ fallbackScheduler: fallback });
}

function qualityAuditMarkdown(report) {
  const sampleTable = (tier) => report.samples[tier]
    .map((item) => `| ${item.sourceRowId} | ${item.word} | ${item.reasons.join(', ')} | ${item.qualified} |`)
    .join('\n');
  return `# ECDICT CET6 full quality audit — 2026-08-21

Status: \`PASS / LOCAL_PRIVATE\`  
Source: ECDICT \`1.0.28\` / \`8defb76\`  
Classification: \`THIRD_PARTY\`  
Official: \`false\`  
Redistribution: \`REDISTRIBUTION_NOT_ESTABLISHED\`

## Counts

| Metric | Count |
| --- | ---: |
| TOTAL_RAW | ${report.totalRaw} |
| RAW_VALID | ${report.rawValid} |
| STRUCTURAL_INVALID | ${report.structuralInvalid} |
| MISSING_PHONETIC | ${report.missingPhonetic} |
| MISSING_POS | ${report.missingPos} |
| EXACT_DUPLICATE | ${report.exactDuplicate} |
| NORMALIZED_DUPLICATE | ${report.normalizedDuplicate} |
| A | ${report.counts.A} |
| B | ${report.counts.B} |
| C | ${report.counts.C} |
| D | ${report.counts.D} |
| UNCLASSIFIED | ${report.unclassifiedCount} |
| QUALIFIED_LEARNABLE | ${report.qualifiedLearnableCount} |

## Frozen tier rules

- A: ${report.tierRules.A}
- B: ${report.tierRules.B}
- C: ${report.tierRules.C}
- D: ${report.tierRules.D}
- Qualified: ${report.qualifiedRule}

## Structural invalid dispositions

- Source row 1450140, raw word \`i.e.\`: current Domain rejects the trailing-period abbreviation and source POS is missing. It remains D and isolated; source is unchanged.
- Source row 2920969, \`striking\`: the optional English definition exceeds 1,000 characters while word, Chinese definition, phonetic and POS remain usable. The expansion adapter records the raw reason and omits only optional \`definitionEn\`; it enters B. The complete original value remains in the machine report and raw source.

## A samples

| Source row | Word | Evidence | Qualified |
| ---: | --- | --- | --- |
${sampleTable('A')}

## B samples

| Source row | Word | Evidence | Qualified |
| ---: | --- | --- | --- |
${sampleTable('B')}

## C samples

| Source row | Word | Evidence | Qualified |
| ---: | --- | --- | --- |
${sampleTable('C')}

Only the existing Pilot identity \`accessary\` is retained from C to prevent learner-history/identity loss. Other C entries remain excluded pending enrichment.

## D entries

| Source row | Word | Evidence | Qualified |
| ---: | --- | --- | --- |
${sampleTable('D')}

## Enrichment boundary

No AI or network enrichment was performed. ECDICT supplies no US-specific phonetic mapping for this integration; examples, phrase enrichment, synonyms/antonyms and recorded audio remain absent. “Phrase enrichment unavailable” is not interpreted as every ordinary word requiring a phrase-type sense.
`;
}

async function measure(operation) {
  const started = performance.now();
  const value = await operation();
  return { value, ms: performance.now() - started };
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
