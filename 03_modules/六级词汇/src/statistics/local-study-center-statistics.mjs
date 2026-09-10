import { deepFreeze } from '../domain/shared.mjs';
import { assertVocabularyStore } from '../store/vocabulary-store.mjs';
import { getCet6StudyStatistics } from './cet6-study-statistics.mjs';

export const LOCAL_STUDY_CENTER_STATISTICS_VERSION = '0.1';

export function getLocalStudyCenterStatistics(vocabularyStore, options) {
  assertVocabularyStore(vocabularyStore);
  const importRecords = options?.importRecords ?? [];
  if (!Array.isArray(importRecords)) throw new TypeError('importRecords array required');
  const learning = getCet6StudyStatistics(vocabularyStore, options);
  const syntheticCount = vocabularyStore.list().filter((entry) => (
    entry.tags.includes('synthetic') || entry.tags.includes('test')
  )).length;
  const realThirdPartyCount = importRecords.filter((record) => (
    record?.manifest?.provenance?.classification === 'THIRD_PARTY'
    && record.manifest.provenance.permissions?.localStorage === true
  )).reduce((sum, record) => sum + record.receipt.importedCount, 0);
  return deepFreeze({
    statisticsVersion: LOCAL_STUDY_CENTER_STATISTICS_VERSION,
    totalVocabulary: vocabularyStore.count(),
    realThirdPartyCount,
    syntheticCount,
    todayPlanned: learning.todayPlan,
    todayCompleted: learning.todayCompleted,
    mastered: learning.stages.mastered,
    reviewing: learning.stages.reviewing,
    unknown: learning.unknownCount,
    favorite: learning.favoriteCount,
    learning,
  });
}
