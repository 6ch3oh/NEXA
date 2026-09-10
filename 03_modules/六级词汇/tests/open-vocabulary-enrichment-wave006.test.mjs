import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeVocabularyCardEnrichment,
  validateVocabularyEnrichmentIndex,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const enrichmentPath = join(moduleRoot, 'data', 'ecdict-qualified', 'current', 'vocabulary-enrichment-wave006.json');

async function loadIndex() {
  return validateVocabularyEnrichmentIndex(JSON.parse(await readFile(enrichmentPath, 'utf8')));
}

test('Wave 006 open enrichment is bounded, source-catalogued and covers the authoritative 5,311 entries', async () => {
  const [index, file] = await Promise.all([loadIndex(), stat(enrichmentPath)]);
  assert.equal(index.target.entryCount, 5_311);
  assert.equal(Object.keys(index.entriesByEntryId).length, 5_311);
  assert.ok(file.size < 300 * 1024 * 1024);
  assert.deepEqual(index.sources.map((source) => source.licenseId), [
    'CC-BY-4.0+WORDNET-LICENSE',
    'CC-BY-SA-3.0',
    'CC-BY-SA-3.0',
    'CMU-CMUDICT-BSD-LIKE',
  ]);
  assert.equal(index.sources.every((source) => /^[a-f0-9]{64}$/u.test(source.artifactSha256)), true);
});

test('abandon exposes real US IPA, sense-linked examples, phrases and quality-filtered derivatives', async () => {
  const index = await loadIndex();
  const record = index.entriesByEntryId['cet6:ecdict:28:16425'];
  assert.equal(record.pronunciations.ipaUs, 'əbˈændən');
  assert.equal(record.pronunciations.sourceId, 'cmudict-7479086');
  assert.ok(record.definitions.length >= 5);
  assert.ok(record.examples.some((value) => value.sentence === 'We abandoned the old car in the empty parking lot'));
  assert.ok(record.phrases.some((value) => value.text === 'give up'));
  assert.ok(record.derivatives.some((value) => value.term === 'abandonment'));
  assert.equal(record.derivatives.some((value) => value.term === 'abandonly'), false);
  assert.equal(record.definitions.every((value) => value.sourceRef.startsWith('oewn:synset:')), true);
});

test('card enrichment is additive and preserves field-level source identity without inventing Chinese text', async () => {
  const index = await loadIndex();
  const card = mergeVocabularyCardEnrichment({
    entryId: 'cet6:ecdict:28:16425',
    word: 'abandon',
    usPhonetic: null,
    ukPhonetic: "ә'bændәn",
    definitions: [{ partOfSpeech: 'verb', definitionZh: '放弃', definitionEn: null }],
    phrases: [], examples: [], synonyms: [], antonyms: [],
  }, index.entriesByEntryId['cet6:ecdict:28:16425'], {
    wordForms: [{ code: 'i', label: '现在分词', value: 'abandoning' }],
    sources: index.sources,
  });
  assert.equal(card.usPhonetic, 'əbˈændən');
  assert.equal(card.definitions[0].definitionZh, '放弃');
  assert.equal(card.definitions.slice(1).every((value) => value.definitionZh === null), true);
  assert.equal(card.examples[0].sourceId, 'oewn-2025');
  assert.equal(card.wordForms[0].sourceId, 'ecdict-1.0.28');
  assert.equal(card.enrichmentSources.length, 4);
});

test('downloaded artifact identities remain fixed to the audited snapshots', async () => {
  const expected = new Map([
    ['english-wordnet-2025-json.zip', '7d749f6e2c39e6970e4997839dcf6e42fd281f3c2fae0171d2192bae8cfa4b51'],
    ['unimorph-eng.tsv', '20a191cefdc7cad6fa74b00f49d6f658684f17b14541aae372e5a3d5a8c15c67'],
    ['unimorph-eng-derivations.tsv', '743fff8ddb3ff26ae413af1fa859806106ffff69628be4cb7ed4d34f677deed2'],
    ['cmudict.dict', '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22'],
  ]);
  for (const [name, digest] of expected) {
    const bytes = await readFile(join(moduleRoot, 'staging', 'open-data-wave006', 'source', name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
  }
});
