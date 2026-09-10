export const VOCABULARY_ENRICHMENT_VERSION = '0.1.0';

const MAX_ENTRIES = 6_000;
const MAX_SOURCES = 8;

function fail(path, message) {
  throw new TypeError(`${path} ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function exactKeys(value, keys, path) {
  const actual = Object.keys(object(value, path)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly ${expected.join(', ')}`);
  }
}

function text(value, path, { nullable = false, max = 1_000 } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max) {
    fail(path, `must be a non-empty trimmed string no longer than ${max}`);
  }
  return value;
}

function list(value, path, max, validate) {
  if (!Array.isArray(value) || value.length > max) fail(path, `must be an array with at most ${max} items`);
  value.forEach((item, index) => validate(item, `${path}[${index}]`));
}

function sourceItem(value, path) {
  exactKeys(value, ['sourceId', 'title', 'version', 'originUrl', 'licenseId', 'attribution', 'artifactSha256', 'artifactUrl'], path);
  for (const key of ['sourceId', 'title', 'version', 'originUrl', 'licenseId', 'attribution', 'artifactSha256']) {
    text(value[key], `${path}.${key}`, { max: key === 'attribution' ? 300 : 200 });
  }
  text(value.artifactUrl, `${path}.artifactUrl`, { nullable: true, max: 300 });
  if (!/^[a-f0-9]{64}$/u.test(value.artifactSha256)) fail(`${path}.artifactSha256`, 'must be lowercase SHA-256');
}

function sourcedTerm(value, path, sourceIds) {
  exactKeys(value, ['term', 'senseId', 'sourceId'], path);
  text(value.term, `${path}.term`, { max: 120 });
  text(value.senseId, `${path}.senseId`, { nullable: true, max: 180 });
  if (!sourceIds.has(value.sourceId)) fail(`${path}.sourceId`, 'must reference the source catalog');
}

function validateEntry(value, path, sourceIds) {
  exactKeys(value, [
    'headword', 'pronunciations', 'definitions', 'examples', 'phrases', 'inflections',
    'derivatives', 'synonyms', 'antonyms', 'usageLabels',
  ], path);
  text(value.headword, `${path}.headword`, { max: 120 });
  exactKeys(value.pronunciations, ['ipaUs', 'ipaUsVariants', 'ipaUsDerivation', 'sourceId'], `${path}.pronunciations`);
  text(value.pronunciations.ipaUs, `${path}.pronunciations.ipaUs`, { nullable: true, max: 160 });
  text(value.pronunciations.ipaUsDerivation, `${path}.pronunciations.ipaUsDerivation`, { nullable: true, max: 80 });
  text(value.pronunciations.sourceId, `${path}.pronunciations.sourceId`, { nullable: true, max: 120 });
  if (value.pronunciations.sourceId !== null && !sourceIds.has(value.pronunciations.sourceId)) {
    fail(`${path}.pronunciations.sourceId`, 'must reference the source catalog');
  }
  list(value.pronunciations.ipaUsVariants, `${path}.pronunciations.ipaUsVariants`, 8,
    (item, itemPath) => text(item, itemPath, { max: 160 }));
  list(value.definitions, `${path}.definitions`, 8, (item, itemPath) => {
    exactKeys(item, ['senseId', 'partOfSpeech', 'definitionEn', 'sourceRef', 'sourceId'], itemPath);
    text(item.senseId, `${itemPath}.senseId`, { max: 180 });
    text(item.partOfSpeech, `${itemPath}.partOfSpeech`, { max: 40 });
    text(item.definitionEn, `${itemPath}.definitionEn`, { max: 1_000 });
    text(item.sourceRef, `${itemPath}.sourceRef`, { max: 240 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
  list(value.examples, `${path}.examples`, 6, (item, itemPath) => {
    exactKeys(item, ['sentence', 'senseId', 'sourceRef', 'sourceId'], itemPath);
    text(item.sentence, `${itemPath}.sentence`, { max: 1_000 });
    text(item.senseId, `${itemPath}.senseId`, { max: 180 });
    text(item.sourceRef, `${itemPath}.sourceRef`, { max: 240 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
  list(value.phrases, `${path}.phrases`, 6, (item, itemPath) => {
    exactKeys(item, ['text', 'relation', 'definitionEn', 'sourceRef', 'sourceId'], itemPath);
    text(item.text, `${itemPath}.text`, { max: 120 });
    text(item.relation, `${itemPath}.relation`, { max: 40 });
    text(item.definitionEn, `${itemPath}.definitionEn`, { nullable: true, max: 1_000 });
    text(item.sourceRef, `${itemPath}.sourceRef`, { max: 240 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
  list(value.inflections, `${path}.inflections`, 12, (item, itemPath) => {
    exactKeys(item, ['label', 'value', 'features', 'sourceId'], itemPath);
    text(item.label, `${itemPath}.label`, { max: 40 });
    text(item.value, `${itemPath}.value`, { max: 120 });
    text(item.features, `${itemPath}.features`, { max: 120 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
  list(value.derivatives, `${path}.derivatives`, 16, (item, itemPath) => {
    exactKeys(item, ['term', 'relation', 'affix', 'sourceId'], itemPath);
    text(item.term, `${itemPath}.term`, { max: 120 });
    text(item.relation, `${itemPath}.relation`, { max: 80 });
    text(item.affix, `${itemPath}.affix`, { nullable: true, max: 40 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
  list(value.synonyms, `${path}.synonyms`, 12, (item, itemPath) => sourcedTerm(item, itemPath, sourceIds));
  list(value.antonyms, `${path}.antonyms`, 12, (item, itemPath) => sourcedTerm(item, itemPath, sourceIds));
  list(value.usageLabels, `${path}.usageLabels`, 4, (item, itemPath) => {
    exactKeys(item, ['label', 'sourceRef', 'sourceId'], itemPath);
    text(item.label, `${itemPath}.label`, { max: 120 });
    text(item.sourceRef, `${itemPath}.sourceRef`, { max: 240 });
    if (!sourceIds.has(item.sourceId)) fail(`${itemPath}.sourceId`, 'must reference the source catalog');
  });
}

export function validateVocabularyEnrichmentIndex(value) {
  exactKeys(value, ['version', 'generatedAt', 'target', 'sources', 'entriesByEntryId'], 'enrichment');
  if (value.version !== VOCABULARY_ENRICHMENT_VERSION) fail('enrichment.version', `must equal ${VOCABULARY_ENRICHMENT_VERSION}`);
  text(value.generatedAt, 'enrichment.generatedAt', { max: 40 });
  if (Number.isNaN(Date.parse(value.generatedAt))) fail('enrichment.generatedAt', 'must be an ISO timestamp');
  exactKeys(value.target, ['collectionId', 'entryCount', 'librarySha256'], 'enrichment.target');
  text(value.target.collectionId, 'enrichment.target.collectionId', { max: 120 });
  if (!Number.isSafeInteger(value.target.entryCount) || value.target.entryCount < 0 || value.target.entryCount > MAX_ENTRIES) {
    fail('enrichment.target.entryCount', `must be between 0 and ${MAX_ENTRIES}`);
  }
  if (!/^[a-f0-9]{64}$/u.test(value.target.librarySha256)) fail('enrichment.target.librarySha256', 'must be lowercase SHA-256');
  list(value.sources, 'enrichment.sources', MAX_SOURCES, sourceItem);
  const sourceIds = new Set(value.sources.map((source) => source.sourceId));
  if (sourceIds.size !== value.sources.length) fail('enrichment.sources', 'must have unique sourceId values');
  const entries = Object.entries(object(value.entriesByEntryId, 'enrichment.entriesByEntryId'));
  if (entries.length !== value.target.entryCount || entries.length > MAX_ENTRIES) {
    fail('enrichment.entriesByEntryId', 'must match target.entryCount');
  }
  for (const [entryId, entry] of entries) {
    text(entryId, 'enrichment.entriesByEntryId key', { max: 180 });
    validateEntry(entry, `enrichment.entriesByEntryId.${entryId}`, sourceIds);
  }
  return Object.freeze({
    version: value.version,
    generatedAt: value.generatedAt,
    target: Object.freeze({ ...value.target }),
    sources: Object.freeze(value.sources.map((source) => Object.freeze({ ...source }))),
    entriesByEntryId: value.entriesByEntryId,
  });
}

export function getVocabularyEnrichment(index, entryId) {
  if (!index || index.version !== VOCABULARY_ENRICHMENT_VERSION || typeof entryId !== 'string') return null;
  return index.entriesByEntryId[entryId] ?? null;
}

function uniqueText(values, limit) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const identity = typeof value === 'string' ? value.toLocaleLowerCase('en-US') : '';
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function uniqueObjects(values, identityOf, limit) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const identity = identityOf(value);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

export function mergeVocabularyCardEnrichment(card, enrichment, { wordForms = [], sources = [] } = {}) {
  if (!card || typeof card !== 'object' || !enrichment || typeof enrichment !== 'object') {
    return card && typeof card === 'object' ? { ...card, wordForms } : card;
  }
  const definitions = uniqueObjects([
    ...(Array.isArray(card.definitions) ? card.definitions : []),
    ...enrichment.definitions.map((value) => ({
      partOfSpeech: value.partOfSpeech,
      definitionZh: null,
      definitionEn: value.definitionEn,
      sourceId: value.sourceId,
      sourceRef: value.sourceRef,
    })),
  ], (value) => `${value.partOfSpeech ?? ''}|${value.definitionEn ?? ''}|${value.definitionZh ?? ''}`.toLocaleLowerCase('en-US'), 10);
  const examples = uniqueObjects([
    ...(Array.isArray(card.examples) ? card.examples : []),
    ...enrichment.examples.map((value) => ({
      sentence: value.sentence,
      translationZh: null,
      sourceId: value.sourceId,
      sourceRef: value.sourceRef,
    })),
  ], (value) => value.sentence?.toLocaleLowerCase('en-US'), 6);
  const phrases = uniqueObjects([
    ...(Array.isArray(card.phrases) ? card.phrases : []),
    ...enrichment.phrases.map((value) => ({
      text: value.text,
      definitionZh: null,
      definitionEn: value.definitionEn,
      relation: value.relation,
      sourceId: value.sourceId,
      sourceRef: value.sourceRef,
    })),
  ], (value) => `${value.text ?? ''}|${value.definitionEn ?? ''}`.toLocaleLowerCase('en-US'), 6);
  const mergedForms = uniqueObjects([
    ...wordForms.map((value) => ({ ...value, sourceId: value.sourceId ?? 'ecdict-1.0.28' })),
    ...enrichment.inflections.map((value) => ({
      code: 'um', label: value.label, value: value.value, features: value.features, sourceId: value.sourceId,
    })),
  ], (value) => value.value?.toLocaleLowerCase('en-US'), 16);
  return {
    ...card,
    usPhonetic: card.usPhonetic ?? enrichment.pronunciations.ipaUs,
    definitions,
    examples,
    phrases,
    wordForms: mergedForms,
    synonyms: uniqueText([
      ...(Array.isArray(card.synonyms) ? card.synonyms : []),
      ...enrichment.synonyms.map((value) => value.term),
    ], 12),
    antonyms: uniqueText([
      ...(Array.isArray(card.antonyms) ? card.antonyms : []),
      ...enrichment.antonyms.map((value) => value.term),
    ], 12),
    derivatives: enrichment.derivatives,
    usageLabels: enrichment.usageLabels,
    enrichmentSources: sources,
  };
}
