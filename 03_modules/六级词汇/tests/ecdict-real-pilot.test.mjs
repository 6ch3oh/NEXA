import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  VocabularySourceClassification,
  createEcdictPilotQualityReport,
  createEcdictPilotSourceManifest,
  createEcdictExpansionQualityTierReport,
  createEcdictExpansionSourceManifest,
  createInMemoryVocabularyStore,
  createLocalStudyCenterDiagnostics,
  createLocalVocabularyLibrary,
  createVocabularyImportWorkflow,
  mapEcdictPilotStaging,
  mapQualifiedEcdictExpansionStaging,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = JSON.parse(await readFile(join(moduleRoot, 'staging', 'ecdict-1.0.28', 'cet6-pilot.raw.json'), 'utf8'));
const normalized = JSON.parse(await readFile(join(moduleRoot, 'staging', 'ecdict-1.0.28', 'cet6-pilot.normalized.json'), 'utf8'));
const sourceManifest = JSON.parse(await readFile(join(moduleRoot, 'staging', 'ecdict-1.0.28', 'source-manifest.json'), 'utf8'));
const expansionRaw = JSON.parse(await readFile(join(moduleRoot, 'staging', 'ecdict-1.0.28', 'source', 'cet6-audit-expansion.raw.json'), 'utf8'));

test('ECDICT source manifest is fixed-revision THIRD_PARTY evidence and never OFFICIAL', () => {
  const entries = mapEcdictPilotStaging(staging);
  const manifest = createEcdictPilotSourceManifest(staging, entries);
  assert.deepEqual(manifest, sourceManifest);
  assert.equal(manifest.repositoryRevision, '1.0.28');
  assert.equal(manifest.repositoryCommit, '8defb76');
  assert.equal(manifest.sourceSha256, 'ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6');
  assert.equal(manifest.originalEntryCount, 3_402_564);
  assert.equal(manifest.cet6CandidateCount, 5_407);
  assert.equal(manifest.pilotEntryCount, 100);
  assert.equal(manifest.classification, 'THIRD_PARTY');
  assert.equal(manifest.official, false);
  assert.equal(manifest.redistributionStatus, 'REDISTRIBUTION_NOT_ESTABLISHED');
  assert.equal(manifest.localPilotStatus, 'LOCAL_PRIVATE_PILOT');
  assert.ok(manifest.knownLimitations.some((item) => item.startsWith('TAG_SEMANTICS_LIMITATION')));
});

test('raw staging maps only explicit CET6 source tags and preserves missing source fields', () => {
  assert.equal(staging.rows.length, 100);
  assert.ok(staging.rows.every((row) => row.tag.toLowerCase().split(/\s+/u).includes('cet6')));
  assert.equal(staging.selection.aiSelection, false);
  const entries = mapEcdictPilotStaging(staging);
  assert.deepEqual(entries, normalized);
  assert.ok(entries.every((entry) => entry.tags.includes('ecdict') && entry.tags.includes('third-party')));
  assert.ok(entries.every((entry) => entry.sourceRefs.some((ref) => ref.startsWith('ecdict:source-tags:'))));
  assert.ok(entries.every((entry) => entry.pronunciations.ipaUs === null));
  assert.ok(entries.every((entry) => entry.senses.every((sense) => sense.examples.length === 0)));
});

test('real pilot quality report is truthful about gaps, duplicates and coverage', () => {
  const quality = createEcdictPilotQualityReport(staging, mapEcdictPilotStaging(staging));
  assert.equal(quality.pilotTotal, 100);
  assert.equal(quality.valid, 100);
  assert.equal(quality.invalid, 0);
  assert.equal(quality.duplicateWordCount, 0);
  assert.equal(quality.duplicateIdentityCount, 0);
  assert.equal(quality.missing.usPhonetic, 100);
  assert.equal(quality.missing.phrases, 100);
  assert.equal(quality.missing.examples, 100);
  assert.equal(quality.sourceCoverageRate, 100);
  assert.equal(quality.fabricatedFieldCount, 0);
});

test('full ECDICT raw audit freezes truthful A/B/C/D tiers and structural dispositions', () => {
  const report = createEcdictExpansionQualityTierReport(expansionRaw, { historicalPilotEntries: normalized });
  assert.equal(report.totalRaw, 5_407);
  assert.equal(report.rawValid, 5_405);
  assert.equal(report.structuralInvalid, 2);
  assert.equal(report.missingPhonetic, 25);
  assert.equal(report.missingPos, 78);
  assert.equal(report.exactDuplicate, 0);
  assert.equal(report.normalizedDuplicate, 0);
  assert.deepEqual(report.counts, { A: 4_593, B: 717, C: 96, D: 1 });
  assert.equal(report.unclassifiedCount, 0);
  assert.equal(report.qualifiedLearnableCount, 5_311);
  assert.equal(report.legacyPilotCIncludedCount, 1);
  assert.equal(report.structuralInvalidDispositions.length, 2);
  assert.ok(report.structuralInvalidDispositions.some((item) => item.word === 'i.e.'
    && item.disposition === 'D_ISOLATED_NO_SOURCE_MUTATION'));
  assert.ok(report.structuralInvalidDispositions.some((item) => item.word === 'striking'
    && item.disposition === 'B_ADAPTER_OMIT_OPTIONAL_DEFINITION_EN'));
});

test('qualified expansion preserves the historical 100 entries and excludes non-grandfathered C/D', () => {
  const tierReport = createEcdictExpansionQualityTierReport(expansionRaw, { historicalPilotEntries: normalized });
  const entries = mapQualifiedEcdictExpansionStaging(expansionRaw, { historicalPilotEntries: normalized });
  const manifest = createEcdictExpansionSourceManifest(expansionRaw, entries, tierReport);
  assert.equal(entries.length, 5_311);
  assert.deepEqual(entries.slice(0, 100), normalized);
  assert.equal(entries.some((entry) => entry.headword === 'i.e.'), false);
  assert.equal(entries.find((entry) => entry.headword === 'striking').senses[0].definitionEn, null);
  assert.ok(entries.find((entry) => entry.headword === 'striking').sourceRefs
    .includes('ecdict:normalization:optional-definition-en-omitted-over-limit'));
  assert.ok(entries.some((entry) => entry.headword === 'accessary'));
  assert.equal(manifest.entryCount, 5_311);
  assert.deepEqual(manifest.qualityTierCounts, { A: 4_593, B: 717, C: 96, D: 1 });
  assert.equal(manifest.classification, 'THIRD_PARTY');
  assert.equal(manifest.official, false);
  assert.equal(manifest.redistributionStatus, 'REDISTRIBUTION_NOT_ESTABLISHED');
});

test('formal workflow previews without write, confirms atomically and restores the pilot library', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-ecdict-pilot-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createInMemoryVocabularyStore();
  const library = createLocalVocabularyLibrary({ filePath: join(directory, 'vocabulary.json') });
  let workflow;
  workflow = createVocabularyImportWorkflow({
    store,
    clock: () => '2026-08-13T06:15:00.000Z',
    onImported: async () => library.save({ entries: store.list(), imports: workflow.listImports() }),
  });
  const preview = workflow.preview({
    input: JSON.stringify(normalized),
    source: {
      sourceId: 'ecdict', packageId: 'ecdict-cet6-pilot-test', packageVersion: '1.0.28-pilot.1',
      title: 'ECDICT 1.0.28 CET6-tagged local private pilot',
      classification: VocabularySourceClassification.THIRD_PARTY,
      originUrl: sourceManifest.releaseUrl,
      licenseId: 'MIT-REPOSITORY-DATA-RIGHTS-LIMITED',
      evidenceRefs: sourceManifest.licenseEvidence,
      permissions: { localStorage: true, modification: true, redistribution: false },
      notes: 'REDISTRIBUTION_NOT_ESTABLISHED',
    },
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.mutationCount, 0);
  assert.equal(store.count(), 0);
  assert.equal(preview.source.classification, 'THIRD_PARTY');
  assert.equal(preview.source.permissions.redistribution, false);
  const confirmed = await workflow.confirm(preview.previewId);
  assert.equal(confirmed.receipt.importedCount, 100);
  assert.equal(confirmed.receipt.classification, 'THIRD_PARTY');
  assert.equal(store.count(), 100);
  assert.equal((await library.load()).entries.length, 100);
});

test('diagnostics separate real THIRD_PARTY content from synthetic and official status', async () => {
  const saved = await createLocalVocabularyLibrary({ filePath: join(moduleRoot, 'data', 'ecdict-pilot', 'vocabulary-library.json') }).load();
  const store = createInMemoryVocabularyStore(saved.entries);
  const importWorkflow = { listImports: () => saved.imports, lastImport: () => saved.imports.at(-1) };
  const diagnostics = await createLocalStudyCenterDiagnostics({
    vocabularyStore: store,
    mode: 'PERSISTED_LOCAL_LIBRARY',
    scheduler: { implementation: { package: 'ts-fsrs' } },
    ttsDescriptor: { runtime: 'WINDOWS_SAPI', available: true, voices: [
      { accent: 'us', voiceId: 'zira', displayName: 'Zira', redistribution: 'NOT_BUNDLED' },
      { accent: 'uk', voiceId: 'hazel', displayName: 'Hazel', redistribution: 'NOT_BUNDLED' },
    ] },
    pronunciationCache: { manifestPath: join(tmpdir(), 'missing-cache.json') },
    persistence: { filePath: join(moduleRoot, 'data', 'ecdict-pilot', 'learner-state.json') },
    vocabularyLibrary: { filePath: join(moduleRoot, 'data', 'ecdict-pilot', 'vocabulary-library.json') },
    importWorkflow,
    queue: { total: 10, counts: { new: 10, relearning: 0, reviewDue: 0 } },
    now: '2026-08-13T06:45:00.000Z',
  });
  assert.equal(diagnostics.content.total, 100);
  assert.equal(diagnostics.content.realThirdPartyCount, 100);
  assert.equal(diagnostics.content.syntheticCount, 0);
  assert.equal(diagnostics.content.realCET6Status, 'CET6_THIRD_PARTY_REAL_PILOT_READY');
  assert.equal(diagnostics.content.officialCET6Status, 'OFFICIAL_CET6_PENDING');
  assert.equal(diagnostics.content.sources[0].redistributionStatus, 'REDISTRIBUTION_NOT_ESTABLISHED');
  assert.ok(!diagnostics.readiness.includes('REAL_CONTENT_PENDING'));
  assert.equal(diagnostics.status, 'READY');
  assert.equal(diagnostics.pronunciation.usStatus, 'LOCAL_US_PRONUNCIATION_READY');
  assert.equal(diagnostics.pronunciation.ukStatus, 'LOCAL_UK_PRONUNCIATION_READY');
  assert.equal(diagnostics.pronunciation.dualAccentStatus, 'DUAL_ACCENT_LOCAL_TTS_READY');
  assert.equal(diagnostics.pronunciation.defaultAccent, 'us');
  assert.equal(diagnostics.pronunciation.networkTts, false);
  assert.equal(diagnostics.runtime.networkDependency, 0);
});
