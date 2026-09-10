import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VocabularySourceClassification,
  createEcdictPilotQualityReport,
  createEcdictPilotSourceManifest,
  createInMemoryVocabularyStore,
  createLocalVocabularyLibrary,
  createVocabularyImportWorkflow,
  mapEcdictPilotStaging,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const stagingDirectory = join(moduleRoot, 'staging', 'ecdict-1.0.28');
const dataDirectory = join(moduleRoot, 'data', 'ecdict-pilot');
const rawPath = join(stagingDirectory, 'cet6-pilot.raw.json');
const staging = JSON.parse(await readFile(rawPath, 'utf8'));
const entries = mapEcdictPilotStaging(staging);
const sourceManifest = createEcdictPilotSourceManifest(staging, entries);
const sourceQuality = createEcdictPilotQualityReport(staging, entries);
const store = createInMemoryVocabularyStore();
const vocabularyLibrary = createLocalVocabularyLibrary({ filePath: join(dataDirectory, 'vocabulary-library.json') });
const IMPORTED_AT = '2026-08-13T06:15:00.000Z';
let workflow;
workflow = createVocabularyImportWorkflow({
  store,
  clock: () => IMPORTED_AT,
  async onImported() {
    await vocabularyLibrary.save({ entries: store.list(), imports: workflow.listImports() });
  },
});
const preview = workflow.preview({
  input: JSON.stringify(entries),
  source: {
    sourceId: 'ecdict',
    packageId: 'ecdict-cet6-pilot-1.0.28',
    packageVersion: '1.0.28-pilot.1',
    title: 'ECDICT 1.0.28 CET6-tagged local private pilot',
    classification: VocabularySourceClassification.THIRD_PARTY,
    originUrl: 'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
    licenseId: 'MIT-REPOSITORY-DATA-RIGHTS-LIMITED',
    rightsHolder: null,
    evidenceRefs: sourceManifest.licenseEvidence,
    permissions: { localStorage: true, modification: true, redistribution: false },
    notes: 'THIRD_PARTY; LOCAL_PRIVATE_PILOT; REDISTRIBUTION_NOT_ESTABLISHED; TAG_SEMANTICS_LIMITATION; not official CET-6.',
  },
});
assert.equal(preview.ok, true);
assert.equal(preview.source.classification, 'THIRD_PARTY');
assert.equal(preview.source.permissions.redistribution, false);
assert.equal(preview.entryCount, 100);
assert.equal(preview.mutationCount, 0);
assert.equal(store.count(), 0, 'preview must not mutate the formal pilot store');
const confirmed = await workflow.confirm(preview.previewId);
assert.equal(confirmed.ok, true);
assert.equal(confirmed.receipt.classification, 'THIRD_PARTY');
assert.equal(confirmed.receipt.importedCount, 100);
assert.equal(store.count(), 100);
const restored = await vocabularyLibrary.load();
assert.equal(restored.entries.length, 100);
assert.equal(restored.imports.length, 1);

const previewArtifact = {
  ok: preview.ok,
  stage: 'PREVIEW_BEFORE_CONFIRM',
  preparedToAdd: preview.entryCount,
  skipped: 0,
  duplicates: preview.duplicates.length,
  invalid: 0,
  missing: sourceQuality.missing,
  sourceClassification: preview.source.classification,
  official: false,
  storeCountBefore: preview.storeCountBefore,
  mutationCount: preview.mutationCount,
  confirmationRequired: preview.confirmationRequired,
  contentDigest: preview.contentDigest,
};
const receiptArtifact = {
  ...confirmed.receipt,
  restorableVocabularyLibrary: true,
  vocabularyLibraryEntryCountAfterReload: restored.entries.length,
  sourceManifest: 'source-manifest.json',
};

await mkdir(stagingDirectory, { recursive: true });
await mkdir(dataDirectory, { recursive: true });
await Promise.all([
  writeJson(join(stagingDirectory, 'cet6-pilot.normalized.json'), entries),
  writeJson(join(stagingDirectory, 'source-manifest.json'), sourceManifest),
  writeJson(join(stagingDirectory, 'quality-report.json'), sourceQuality),
  writeJson(join(stagingDirectory, 'import-preview.json'), previewArtifact),
  writeJson(join(dataDirectory, 'import-receipt.json'), receiptArtifact),
]);
process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  raw: staging.rows.length,
  normalized: entries.length,
  previewMutation: preview.mutationCount,
  imported: confirmed.receipt.importedCount,
  restored: restored.entries.length,
  classification: preview.source.classification,
  official: false,
  redistribution: sourceManifest.redistributionStatus,
})}\n`);

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
