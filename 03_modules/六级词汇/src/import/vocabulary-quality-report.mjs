import { deepFreeze } from '../domain/shared.mjs';
import { validateVocabularyCollection } from '../domain/vocabulary-entry.mjs';

export const VOCABULARY_QUALITY_REPORT_VERSION = '0.1';

export function createVocabularyQualityReport(entries) {
  validateVocabularyCollection(entries);
  const missing = {
    partOfSpeech: [],
    definitions: [],
    usPhonetic: [],
    ukPhonetic: [],
    englishDefinition: [],
    examples: [],
    phrases: [],
  };
  let senseCount = 0;
  let exampleCount = 0;
  let phraseSenseCount = 0;
  for (const entry of entries) {
    senseCount += entry.senses.length;
    const entryExamples = entry.senses.flatMap((sense) => sense.examples);
    const entryPhrases = entry.senses.filter((sense) => sense.partOfSpeech === 'phrase');
    exampleCount += entryExamples.length;
    phraseSenseCount += entryPhrases.length;
    if (entry.pronunciations.ipaUs === null) missing.usPhonetic.push(entry.entryId);
    if (entry.pronunciations.ipaUk === null) missing.ukPhonetic.push(entry.entryId);
    if (entry.senses.some((sense) => sense.definitionEn === null)) missing.englishDefinition.push(entry.entryId);
    if (entry.senses.some((sense) => !sense.partOfSpeech)) missing.partOfSpeech.push(entry.entryId);
    if (entry.senses.some((sense) => !sense.definitionZh)) missing.definitions.push(entry.entryId);
    if (entryExamples.length === 0) missing.examples.push(entry.entryId);
    if (entryPhrases.length === 0) missing.phrases.push(entry.entryId);
  }
  const missingCounts = Object.fromEntries(Object.entries(missing).map(([key, ids]) => [key, ids.length]));
  const syntheticFixtureCount = entries.filter((entry) => entry.tags.includes('test') && entry.tags.includes('synthetic')).length;
  return deepFreeze({
    reportVersion: VOCABULARY_QUALITY_REPORT_VERSION,
    entryCount: entries.length,
    senseCount,
    exampleCount,
    phraseSenseCount,
    syntheticFixtureCount,
    fixtureIdentity: entries.length > 0 && syntheticFixtureCount === entries.length ? 'TEST / SYNTHETIC' : null,
    missingCounts,
    missingEntryIds: missing,
    duplicateWordCount: 0,
    duplicateIdentityCount: 0,
    invalidEntryCount: 0,
    sourceCoverageCount: entries.filter((entry) => entry.sourceRefs.length > 0).length,
    sourceCoverageRate: entries.length === 0 ? 0 : 100,
    completeForStudyEngine: entries.length > 0,
    completeForFullContentRelease: Object.values(missingCounts).every((count) => count === 0),
  });
}
