import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  VocabularySourceClassification,
  createInMemoryVocabularyStore,
  createLocalVocabularyLibrary,
  createVocabularyImportWorkflow,
  createWindowsSapiTtsAdapter,
  createLearnerDataPartition,
  createCet6StudyMvpRuntime,
  detectWindowsSapiVoices,
} from '../src/index.mjs';
import { SYNTHETIC_TIMESTAMP, SYNTHETIC_VOCABULARY_ENTRIES } from '../fixtures/synthetic-vocabulary.mjs';

test('Windows SAPI detection maps installed English locale identities without bundling voices', async () => {
  const runner = async () => JSON.stringify([
    { voiceTokenId:'sapi:us', displayName:'Test US', language:'409', gender:'Female', vendor:'Test' },
    { voiceTokenId:'sapi:uk', displayName:'Test UK', language:'809', gender:'Female', vendor:'Test' },
    { voiceTokenId:'sapi:zh', displayName:'Test ZH', language:'804', gender:'Female', vendor:'Test' },
  ]);
  const voices = await detectWindowsSapiVoices({ runner });
  assert.deepEqual(voices.map((voice) => voice.accent), ['us','uk']);
  assert.ok(voices.every((voice) => voice.modelLicense === 'WINDOWS_INSTALLED_COMPONENT'));
  assert.ok(voices.every((voice) => voice.redistribution === 'NOT_BUNDLED'));
});

test('Windows SAPI adapter returns generated WAV metadata through an injectable runner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-sapi-test-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const runner = async (args) => {
    if (args.includes('list')) return JSON.stringify([{ voiceTokenId:'sapi:us', displayName:'Test US', language:'409' }]);
    const outputPath = args.at(args.indexOf('-OutputPath') + 1);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputPath, Buffer.from('RIFFtestWAVE'));
    return JSON.stringify({ ok:true, outputPath, bytes:12 });
  };
  const adapter = await createWindowsSapiTtsAdapter({ runner, clock:() => SYNTHETIC_TIMESTAMP, outputDirectory:directory });
  assert.equal(adapter.supports('us'), true);
  assert.equal(adapter.supports('uk'), false);
  const result = await adapter.synthesize({ word:'test', accent:'us', voiceId:'sapi:us' });
  assert.equal(result.ok, true);
  assert.equal(result.sourceType, 'LOCAL_TTS');
  assert.equal(result.audioMetadata.format, 'wav');
});

test('local import workflow previews with zero mutation, confirms once, and emits receipt', async () => {
  const store = createInMemoryVocabularyStore();
  const workflow = createVocabularyImportWorkflow({ store, clock:() => SYNTHETIC_TIMESTAMP });
  const preview = workflow.preview({
    input: JSON.stringify(SYNTHETIC_VOCABULARY_ENTRIES),
    source: { title:'TEST / SYNTHETIC upload', classification:VocabularySourceClassification.SYNTHETIC },
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.mutationCount, 0);
  assert.equal(store.count(), 0);
  assert.equal(preview.confirmationRequired, true);
  const result = await workflow.confirm(preview.previewId);
  assert.equal(result.receipt.importedCount, 8);
  assert.equal(store.count(), 8);
  assert.equal(workflow.lastImport().receipt.receiptId, result.receipt.receiptId);
  assert.equal((await workflow.confirm(preview.previewId)).error.code, 'PREVIEW_NOT_FOUND');
});

test('local vocabulary library persists canonical entries and import records atomically', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-library-test-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  const filePath = join(directory, 'nested', 'vocabulary.json');
  const library = createLocalVocabularyLibrary({ filePath });
  assert.deepEqual(await library.load(), { version:'0.1', entries:[], imports:[] });
  const saved = await library.save({ entries:SYNTHETIC_VOCABULARY_ENTRIES, imports:[{ receipt:{ receiptId:'test' } }] });
  assert.equal(saved.entryCount, 8);
  const loaded = await library.load();
  assert.equal(loaded.entries.length, 8);
  assert.equal(loaded.imports[0].receipt.receiptId, 'test');
  const raw = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(raw.version, '0.1');
});

test('personal all list includes untouched NEW vocabulary without creating a second state list', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const runtime = createCet6StudyMvpRuntime({ learnerId:'local-default', vocabularyStore:store, partition:createLearnerDataPartition() });
  const result = runtime.personalVocabulary.list('all', { query:'ABAN', page:1, pageSize:50 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].learningState, 'new');
  assert.equal(runtime.progressStore.listStates().length, 0);
});

test('personal vocabulary paging and sorting remain stable without duplicating learner state', () => {
  const store = createInMemoryVocabularyStore(SYNTHETIC_VOCABULARY_ENTRIES);
  const runtime = createCet6StudyMvpRuntime({ learnerId:'local-default', vocabularyStore:store, partition:createLearnerDataPartition() });
  const ascending = runtime.personalVocabulary.list('all', { page:1, pageSize:3, sort:'word-asc' });
  const descending = runtime.personalVocabulary.list('all', { page:1, pageSize:3, sort:'word-desc' });
  const secondPage = runtime.personalVocabulary.list('all', { page:2, pageSize:3, sort:'word-asc' });
  const words = store.list().map((entry) => entry.headword);
  assert.equal(ascending.total, 8);
  assert.equal(ascending.pageCount, 3);
  assert.equal(ascending.sort, 'word-asc');
  assert.deepEqual(descending.items.map((item) => item.word), [...words].sort((a, b) => b.localeCompare(a, 'en')).slice(0, 3));
  assert.deepEqual(secondPage.items.map((item) => item.word), [...words].sort((a, b) => a.localeCompare(b, 'en')).slice(3, 6));
  assert.throws(() => runtime.personalVocabulary.list('all', { sort:'unknown' }), /unsupported personal sort/);
  assert.equal(runtime.progressStore.listStates().length, 0);
});
