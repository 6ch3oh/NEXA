import { createHash } from 'node:crypto';
import { deepFreeze } from '../domain/shared.mjs';
import { PartOfSpeech, createVocabularyEntry, validateVocabularyCollection } from '../domain/vocabulary-entry.mjs';

export const ECDICT_PILOT_MAPPING_VERSION = '0.1';
export const ECDICT_PILOT_SOURCE_ID = 'ecdict';
export const ECDICT_PILOT_CLASSIFICATION = 'THIRD_PARTY';
export const ECDICT_PILOT_REDISTRIBUTION_STATUS = 'REDISTRIBUTION_NOT_ESTABLISHED';
export const ECDICT_PILOT_LOCAL_STATUS = 'LOCAL_PRIVATE_PILOT';
export const ECDICT_EXPANSION_QUALITY_VERSION = '0.1';
export const EcdictQualityTier = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D' });

const KNOWN_TAGS = new Set(['zk', 'gk', 'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre']);
const POS_MAP = Object.freeze({
  n: PartOfSpeech.NOUN,
  v: PartOfSpeech.VERB,
  vi: PartOfSpeech.VERB,
  vt: PartOfSpeech.VERB,
  j: PartOfSpeech.ADJECTIVE,
  a: PartOfSpeech.ADJECTIVE,
  s: PartOfSpeech.ADJECTIVE,
  r: PartOfSpeech.ADVERB,
  d: PartOfSpeech.ADVERB,
  pron: PartOfSpeech.PRONOUN,
  prep: PartOfSpeech.PREPOSITION,
  conj: PartOfSpeech.CONJUNCTION,
  det: PartOfSpeech.DETERMINER,
  num: PartOfSpeech.NUMERAL,
  int: PartOfSpeech.INTERJECTION,
  aux: PartOfSpeech.AUXILIARY,
});

function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized === '' ? null : normalized;
}

function sourceTags(row) {
  return (text(row.tag) ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
}

function primaryPartOfSpeech(value) {
  if (text(value) === null) return PartOfSpeech.OTHER;
  const candidates = value.split('/').map((item, index) => {
    const [sourceCode, weightText] = item.trim().toLowerCase().split(':');
    const weight = Number(weightText);
    return { sourceCode, weight: Number.isFinite(weight) ? weight : 0, index };
  }).sort((left, right) => right.weight - left.weight || left.index - right.index);
  return POS_MAP[candidates[0]?.sourceCode] ?? PartOfSpeech.OTHER;
}

function requirePilotEnvelope(staging) {
  if (!staging || typeof staging !== 'object' || Array.isArray(staging)) throw new TypeError('ECDICT staging object required');
  if (staging.stagingVersion !== '0.1') throw new TypeError('unsupported ECDICT staging version');
  if (staging.sourceId !== ECDICT_PILOT_SOURCE_ID) throw new TypeError('ECDICT sourceId required');
  if (!Array.isArray(staging.rows)) throw new TypeError('ECDICT staging rows required');
  if (staging.rows.length < 50 || staging.rows.length > 100) throw new TypeError('ECDICT pilot must contain 50-100 rows');
  if (staging.selection?.requiredTag !== 'cet6' || staging.selection?.aiSelection !== false) {
    throw new TypeError('explicit non-AI CET6 tag selection evidence required');
  }
}

function requireExpansionEnvelope(staging) {
  if (!staging || typeof staging !== 'object' || Array.isArray(staging)) throw new TypeError('ECDICT staging object required');
  if (staging.stagingVersion !== '0.1' || staging.mode !== 'AUDIT_EXPANSION') {
    throw new TypeError('ECDICT AUDIT_EXPANSION staging required');
  }
  if (staging.sourceId !== ECDICT_PILOT_SOURCE_ID || staging.sourceRevision !== '1.0.28'
    || staging.repositoryCommit !== '8defb76') {
    throw new TypeError('fixed ECDICT 1.0.28 source identity required');
  }
  if (!Array.isArray(staging.rows) || staging.rows.length !== staging.sourceAudit?.cet6CandidateCount) {
    throw new TypeError('complete ECDICT expansion rows required');
  }
  if (staging.selection?.requiredTag !== 'cet6' || staging.selection?.explicitFullMode !== true
    || staging.selection?.aiSelection !== false) {
    throw new TypeError('explicit non-AI full CET6 tag selection evidence required');
  }
  if (staging.pipelineBoundary?.sourceOnly !== true || staging.pipelineBoundary?.directStoreWrite !== false
    || staging.pipelineBoundary?.formalImportRequired !== true) {
    throw new TypeError('source-only expansion pipeline boundary required');
  }
  if (staging.sourceArchiveSha256 !== 'ea01f76a3b3351021ce47077e89234465cc9441c8793054495320d06c0c3f3f6') {
    throw new TypeError('matched ECDICT source archive identity required');
  }
  if (!staging.rawAudit || staging.rawAudit.auditedRowCount !== staging.rows.length) {
    throw new TypeError('complete raw audit evidence required');
  }
}

function positiveSourceSignal(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function expansionEntryId(row) {
  return `cet6:ecdict:28:${row.id}`;
}

function expansionFindingByRow(staging) {
  return new Map(staging.rawAudit.findings.map((finding) => [finding.sourceRowId, finding]));
}

function classifyExpansionRow(row, finding, historicalPilotEntryIds) {
  const entryId = expansionEntryId(row);
  const missingPhonetic = text(row.phonetic) === null;
  const missingPos = text(row.pos) === null;
  const rawStructuralReason = finding?.rejectionReason ?? null;
  const duplicate = finding?.findings?.includes('EXACT_DUPLICATE')
    || finding?.findings?.includes('NORMALIZED_DUPLICATE');
  const repairableOptionalEnglishDefinition = rawStructuralReason === 'DEFINITION_TOO_LONG'
    && text(row.translation) !== null;
  let tier;
  let reasons;
  if (duplicate || (rawStructuralReason !== null && !repairableOptionalEnglishDefinition)) {
    tier = EcdictQualityTier.D;
    reasons = [duplicate ? 'DUPLICATE_IDENTITY' : rawStructuralReason];
  } else if (missingPhonetic || missingPos) {
    tier = EcdictQualityTier.C;
    reasons = [missingPhonetic ? 'MISSING_PHONETIC' : null, missingPos ? 'MISSING_POS' : null].filter(Boolean);
  } else {
    const usableEnglishDefinition = text(row.definition) !== null && text(row.definition).length <= 1_000;
    const exchange = text(row.exchange) !== null;
    const dictionaryOrCorpusSignal = ['collins', 'oxford', 'bnc', 'frq'].some((key) => positiveSourceSignal(row[key]));
    tier = usableEnglishDefinition && exchange && dictionaryOrCorpusSignal
      ? EcdictQualityTier.A
      : EcdictQualityTier.B;
    reasons = tier === EcdictQualityTier.A
      ? ['CORE_COMPLETE', 'ENGLISH_DEFINITION', 'EXCHANGE', 'DICTIONARY_OR_CORPUS_SIGNAL']
      : [repairableOptionalEnglishDefinition ? 'OPTIONAL_ENGLISH_DEFINITION_OVER_LIMIT' : 'LIMITED_ENRICHMENT'];
  }
  const legacyPilotPreserved = tier === EcdictQualityTier.C && historicalPilotEntryIds.has(entryId);
  return {
    sourceRowId: row.id,
    entryId,
    word: text(row.word),
    tier,
    reasons,
    rawStructuralReason,
    missingPhonetic,
    missingPos,
    legacyPilotPreserved,
    qualified: tier === EcdictQualityTier.A || tier === EcdictQualityTier.B || legacyPilotPreserved,
  };
}

export function createEcdictExpansionQualityTierReport(staging, { historicalPilotEntries = [] } = {}) {
  requireExpansionEnvelope(staging);
  validateVocabularyCollection(historicalPilotEntries);
  const historicalPilotEntryIds = new Set(historicalPilotEntries.map((entry) => entry.entryId));
  const findingByRow = expansionFindingByRow(staging);
  const classifications = staging.rows.map((row) => classifyExpansionRow(
    row,
    findingByRow.get(row.id),
    historicalPilotEntryIds,
  ));
  const counts = Object.fromEntries(Object.values(EcdictQualityTier).map((tier) => [tier,
    classifications.filter((item) => item.tier === tier).length]));
  const qualified = classifications.filter((item) => item.qualified);
  const structuralInvalidDispositions = classifications
    .filter((item) => item.rawStructuralReason !== null)
    .map((item) => {
      const row = staging.rows.find((candidate) => candidate.id === item.sourceRowId);
      const repairable = item.rawStructuralReason === 'DEFINITION_TOO_LONG';
      return {
        sourceRowId: item.sourceRowId,
        word: row.word,
        rawReason: item.rawStructuralReason,
        originalField: repairable ? 'definition' : 'word',
        originalValue: repairable ? row.definition : row.word,
        normalizedValue: repairable ? null : null,
        disposition: repairable
          ? 'B_ADAPTER_OMIT_OPTIONAL_DEFINITION_EN'
          : 'D_ISOLATED_NO_SOURCE_MUTATION',
        sourceMutated: false,
      };
    });
  const sample = (tier, limit = 10) => classifications
    .filter((item) => item.tier === tier)
    .slice(0, limit)
    .map(({ sourceRowId, entryId, word, reasons, qualified: isQualified, legacyPilotPreserved }) => ({
      sourceRowId, entryId, word, reasons, qualified: isQualified, legacyPilotPreserved,
    }));
  return deepFreeze({
    reportVersion: ECDICT_EXPANSION_QUALITY_VERSION,
    identity: 'REAL / THIRD_PARTY / LOCAL_PRIVATE_EXPANSION_AUDIT',
    sourceId: ECDICT_PILOT_SOURCE_ID,
    sourceRevision: staging.sourceRevision,
    repositoryCommit: staging.repositoryCommit,
    sourceArchiveSha256: staging.sourceArchiveSha256,
    classification: ECDICT_PILOT_CLASSIFICATION,
    official: false,
    redistributionStatus: ECDICT_PILOT_REDISTRIBUTION_STATUS,
    totalRaw: staging.rows.length,
    rawValid: staging.rows.length - staging.rawAudit.counts.STRUCTURAL_INVALID,
    structuralInvalid: staging.rawAudit.counts.STRUCTURAL_INVALID,
    missingWord: staging.rawAudit.counts.MISSING_WORD,
    invalidWord: staging.rawAudit.counts.INVALID_WORD,
    missingDefinition: staging.rawAudit.counts.MISSING_DEFINITION,
    unusableDefinition: structuralInvalidDispositions.filter((item) => item.rawReason === 'DEFINITION_TOO_LONG').length,
    missingPhonetic: staging.rawAudit.counts.MISSING_PHONETIC,
    missingPos: staging.rawAudit.counts.MISSING_POS,
    exactDuplicate: staging.rawAudit.counts.EXACT_DUPLICATE,
    normalizedDuplicate: staging.rawAudit.counts.NORMALIZED_DUPLICATE,
    suspiciousEntry: staging.rawAudit.counts.SUSPICIOUS_ENTRY,
    rejectedEntry: counts.D,
    tierRules: {
      A: 'Domain-usable word and Chinese definition; phonetic and source POS present; usable English definition, exchange, and a positive dictionary/corpus signal.',
      B: 'Domain-usable word and Chinese definition; phonetic and source POS present; enrichment below A, including explicit omission of an over-limit optional English definition.',
      C: 'Domain-mappable basic entry with missing phonetic or source POS; excluded unless an existing Pilot identity must be preserved.',
      D: 'Unsafe Domain identity, required-definition failure, duplicate, or non-repairable structural anomaly; isolated from the collection.',
    },
    counts,
    unclassifiedCount: staging.rows.length - Object.values(counts).reduce((sum, count) => sum + count, 0),
    qualifiedRule: 'A + B + existing Pilot C identities preserved for learner-history safety; all other C and every D are excluded.',
    qualifiedLearnableCount: qualified.length,
    legacyPilotCIncludedCount: qualified.filter((item) => item.legacyPilotPreserved).length,
    structuralInvalidDispositions,
    samples: {
      A: sample(EcdictQualityTier.A),
      B: sample(EcdictQualityTier.B),
      C: sample(EcdictQualityTier.C),
      D: sample(EcdictQualityTier.D, counts.D),
    },
    classifications,
    enrichmentGaps: {
      missingUkPhoneticRaw: staging.rawAudit.counts.MISSING_PHONETIC,
      missingSourcePosRaw: staging.rawAudit.counts.MISSING_POS,
      missingUsSpecificPhoneticQualified: qualified.length,
      sourceExamplesUnavailableQualified: qualified.length,
      sourcePhraseEnrichmentUnavailableQualified: qualified.length,
      sourceSynonymAntonymUnavailableQualified: qualified.length,
      recordedAudioUnavailableQualified: qualified.length,
      aiGeneratedEnrichment: 0,
      networkEnrichment: 0,
    },
  });
}

function mapExpansionRow(staging, row, classification) {
  const tags = sourceTags(row);
  const definitionZh = text(row.translation);
  if (definitionZh === null) throw new TypeError(`ECDICT row ${row.id} lacks Chinese translation`);
  const sourceTagEvidence = tags.join('.');
  const rawDefinitionEn = text(row.definition);
  const definitionEn = rawDefinitionEn !== null && rawDefinitionEn.length <= 1_000 ? rawDefinitionEn : null;
  return createVocabularyEntry({
    schemaVersion: '0.1',
    entryId: classification.entryId,
    headword: text(row.word),
    normalizedHeadword: text(row.word)?.toLowerCase(),
    level: 'CET6',
    pronunciations: { ipaUk: text(row.phonetic), ipaUs: null },
    senses: [{
      senseId: `sense:ecdict:28:${row.id}:1`,
      partOfSpeech: primaryPartOfSpeech(row.pos),
      definitionZh,
      definitionEn,
      examples: [],
      synonyms: [],
      antonyms: [],
    }],
    tags: [...new Set([...tags, 'ecdict', 'third-party', 'real-expansion', `quality-tier-${classification.tier.toLowerCase()}`])],
    sourceRefs: [
      'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
      `ecdict:row:${row.id}`,
      `ecdict:source-tags:${sourceTagEvidence}`,
      `ecdict:quality-tier:${classification.tier}`,
      ...(rawDefinitionEn !== definitionEn ? ['ecdict:normalization:optional-definition-en-omitted-over-limit'] : []),
    ],
    createdAt: staging.retrievedAt,
    updatedAt: staging.retrievedAt,
  });
}

export function mapQualifiedEcdictExpansionStaging(staging, { historicalPilotEntries = [] } = {}) {
  const report = createEcdictExpansionQualityTierReport(staging, { historicalPilotEntries });
  const historicalById = new Map(historicalPilotEntries.map((entry) => [entry.entryId, entry]));
  const classificationById = new Map(report.classifications.map((item) => [item.entryId, item]));
  const entries = staging.rows.flatMap((row) => {
    const classification = classificationById.get(expansionEntryId(row));
    if (!classification.qualified) return [];
    const historical = historicalById.get(classification.entryId);
    return [historical ?? mapExpansionRow(staging, row, classification)];
  });
  validateVocabularyCollection(entries);
  if (entries.length !== report.qualifiedLearnableCount) throw new TypeError('qualified expansion count mismatch');
  return deepFreeze(entries);
}

export function createEcdictExpansionSourceManifest(staging, entries, tierReport) {
  requireExpansionEnvelope(staging);
  validateVocabularyCollection(entries);
  if (tierReport?.reportVersion !== ECDICT_EXPANSION_QUALITY_VERSION
    || tierReport.qualifiedLearnableCount !== entries.length) {
    throw new TypeError('matching ECDICT quality tier report required');
  }
  return deepFreeze({
    manifestVersion: '0.1',
    packageId: 'ecdict-cet6-qualified-local-1.0.28',
    packageVersion: '1.0.28-qualified.1',
    collectionId: 'cet6-vocabulary',
    collectionTitle: 'ECDICT CET6 Third-Party Local Collection',
    entryCount: entries.length,
    contentDigest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    sourceName: 'ECDICT',
    sourceVersion: staging.sourceRevision,
    repositoryCommit: staging.repositoryCommit,
    sourceArchiveSha256: staging.sourceArchiveSha256,
    rawCandidateCount: staging.rows.length,
    qualityTierCounts: tierReport.counts,
    qualifiedRule: tierReport.qualifiedRule,
    classification: ECDICT_PILOT_CLASSIFICATION,
    official: false,
    redistributionStatus: ECDICT_PILOT_REDISTRIBUTION_STATUS,
    permissions: { localStorage: true, modification: true, redistribution: false },
    runtimeNetworkDependency: 0,
  });
}

export function mapEcdictPilotStaging(staging) {
  requirePilotEnvelope(staging);
  const entries = staging.rows.map((row) => {
    const tags = sourceTags(row);
    if (!tags.includes('cet6')) throw new TypeError(`ECDICT row ${row.id} lacks explicit cet6 tag`);
    const definitionZh = text(row.translation);
    if (definitionZh === null) throw new TypeError(`ECDICT row ${row.id} lacks Chinese translation`);
    const sourceTagEvidence = tags.join('.');
    return createVocabularyEntry({
      schemaVersion: '0.1',
      entryId: `cet6:ecdict:28:${row.id}`,
      headword: text(row.word),
      normalizedHeadword: text(row.word)?.toLowerCase(),
      level: 'CET6',
      pronunciations: {
        ipaUk: text(row.phonetic),
        ipaUs: null,
      },
      senses: [{
        senseId: `sense:ecdict:28:${row.id}:1`,
        partOfSpeech: primaryPartOfSpeech(row.pos),
        definitionZh,
        definitionEn: text(row.definition),
        examples: [],
        synonyms: [],
        antonyms: [],
      }],
      tags: [...new Set([...tags, 'ecdict', 'third-party', 'real-pilot'])],
      sourceRefs: [
        'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
        `ecdict:row:${row.id}`,
        `ecdict:source-tags:${sourceTagEvidence}`,
      ],
      createdAt: staging.retrievedAt,
      updatedAt: staging.retrievedAt,
    });
  });
  validateVocabularyCollection(entries);
  return deepFreeze(entries);
}

export function createEcdictPilotQualityReport(staging, entries) {
  requirePilotEnvelope(staging);
  validateVocabularyCollection(entries);
  const identities = new Set();
  const entryIds = new Set();
  let duplicateWordCount = 0;
  let duplicateIdentityCount = 0;
  const missing = {
    phonetic: 0,
    definitions: 0,
    partOfSpeech: 0,
    usPhonetic: entries.filter((entry) => entry.pronunciations.ipaUs === null).length,
    ukPhonetic: entries.filter((entry) => entry.pronunciations.ipaUk === null).length,
    phrases: entries.filter((entry) => !entry.senses.some((sense) => sense.partOfSpeech === PartOfSpeech.PHRASE)).length,
    examples: entries.filter((entry) => entry.senses.every((sense) => sense.examples.length === 0)).length,
  };
  const unknownTags = new Set();
  for (const [index, row] of staging.rows.entries()) {
    const wordIdentity = text(row.word)?.toLowerCase();
    if (identities.has(wordIdentity)) duplicateWordCount += 1;
    identities.add(wordIdentity);
    if (entryIds.has(entries[index].entryId)) duplicateIdentityCount += 1;
    entryIds.add(entries[index].entryId);
    if (text(row.phonetic) === null) missing.phonetic += 1;
    if (text(row.translation) === null && text(row.definition) === null) missing.definitions += 1;
    if (text(row.pos) === null) missing.partOfSpeech += 1;
    sourceTags(row).filter((tag) => !KNOWN_TAGS.has(tag)).forEach((tag) => unknownTags.add(tag));
  }
  return deepFreeze({
    reportVersion: '0.1',
    identity: 'REAL / THIRD_PARTY / LOCAL_PRIVATE_PILOT',
    pilotTotal: staging.rows.length,
    valid: entries.length,
    invalid: staging.rows.length - entries.length,
    duplicateWordCount,
    duplicateIdentityCount,
    missing,
    unknownOrMalformedTags: [...unknownTags].sort(),
    sourceCoverageCount: entries.filter((entry) => entry.sourceRefs.some((ref) => ref.startsWith('ecdict:row:'))).length,
    sourceCoverageRate: entries.length === 0 ? 0 : 100,
    sourceFieldsNotProvided: ['US_PHONETIC', 'PHRASES', 'EXAMPLES', 'US_RECORDED_AUDIO', 'UK_RECORDED_AUDIO'],
    fabricatedFieldCount: 0,
  });
}

export function createEcdictPilotSourceManifest(staging, entries) {
  requirePilotEnvelope(staging);
  validateVocabularyCollection(entries);
  return deepFreeze({
    manifestVersion: '0.1',
    sourceId: ECDICT_PILOT_SOURCE_ID,
    sourceName: 'ECDICT',
    classification: ECDICT_PILOT_CLASSIFICATION,
    official: false,
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    releaseUrl: 'https://github.com/skywind3000/ECDICT/releases/tag/1.0.28',
    repositoryRevision: staging.sourceRevision,
    repositoryCommit: staging.repositoryCommit,
    retrievedAt: staging.retrievedAt,
    license: 'MIT (repository); underlying data rights are not established by the repository license alone',
    licenseEvidence: [
      'https://github.com/skywind3000/ECDICT/blob/8defb76/LICENSE',
      'https://github.com/skywind3000/ECDICT/blob/8defb76/README.md',
    ],
    redistributionStatus: ECDICT_PILOT_REDISTRIBUTION_STATUS,
    localPilotStatus: ECDICT_PILOT_LOCAL_STATUS,
    originalEntryCount: staging.sourceAudit.originalEntryCount,
    cet6CandidateCount: staging.sourceAudit.cet6CandidateCount,
    pilotEntryCount: entries.length,
    sourceSha256: staging.sourceArchiveSha256,
    sourceArchiveName: 'ecdict-sqlite-28.zip',
    sourceArchiveBytes: 216_765_132,
    sourceDatabaseName: 'stardict.db',
    sourceDatabaseBytes: 851_288_064,
    upstreamAssetUrl: 'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip',
    mappingVersion: ECDICT_PILOT_MAPPING_VERSION,
    contentDigest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    tagEvidenceRule: 'Only rows containing the exact, space-delimited ECDICT tag token cet6 were selected.',
    knownLimitations: [
      'TAG_SEMANTICS_LIMITATION: ECDICT describes exam tags, but this is not official CET-6 authority evidence.',
      'REDISTRIBUTION_NOT_ESTABLISHED: repository MIT terms do not establish uniform rights for all underlying dictionary data.',
      'ECDICT phonetic is documented as mainly British; it is mapped only to ipaUk and never inferred as ipaUs.',
      'Missing phrases, examples, accent-specific recordings, and US phonetics remain missing.',
      'POS is reduced to the highest-weight ECDICT pos code; unmapped or absent source POS becomes domain value other and remains counted as a source-quality limitation.',
      'Pilot artifacts are for local private evaluation and are not an official or redistributable CET-6 word list.',
    ],
  });
}
