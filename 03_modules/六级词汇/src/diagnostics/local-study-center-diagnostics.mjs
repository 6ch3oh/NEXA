import { stat } from 'node:fs/promises';
import { deepFreeze } from '../domain/shared.mjs';

export const LOCAL_STUDY_CENTER_DIAGNOSTICS_VERSION = '0.1';

async function fileStatus(path) {
  try {
    const info = await stat(path);
    return { exists: info.isFile(), bytes: info.isFile() ? info.size : 0 };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, bytes: 0 };
    return { exists: false, bytes: 0, error: error.message };
  }
}

export async function createLocalStudyCenterDiagnostics({
  vocabularyStore,
  mode,
  scheduler,
  ttsDescriptor,
  pronunciationCache,
  persistence,
  vocabularyLibrary,
  importWorkflow,
  queue,
  now,
}) {
  const entries = vocabularyStore.list();
  const syntheticCount = entries.filter((entry) => entry.tags.includes('synthetic') || entry.tags.includes('test')).length;
  const imports = importWorkflow.listImports();
  const authorizedRealCount = imports.filter((entry) => (
    entry.manifest.provenance.classification !== 'SYNTHETIC'
    && entry.manifest.provenance.permissions.localStorage
  )).reduce((sum, entry) => sum + entry.receipt.importedCount, 0);
  const thirdPartyImports = imports.filter((entry) => (
    entry.manifest.provenance.classification === 'THIRD_PARTY'
    && entry.manifest.provenance.permissions.localStorage
  ));
  const realThirdPartyCount = thirdPartyImports.reduce((sum, entry) => sum + entry.receipt.importedCount, 0);
  const sources = thirdPartyImports.map((entry) => ({
    sourceId: entry.manifest.provenance.sourceId,
    title: entry.manifest.provenance.title,
    classification: entry.manifest.provenance.classification,
    official: false,
    redistributionStatus: entry.manifest.provenance.permissions.redistribution
      ? 'PERMITTED_BY_RECORDED_PROVENANCE'
      : 'REDISTRIBUTION_NOT_ESTABLISHED',
    evidenceRefs: entry.manifest.provenance.evidenceRefs,
  }));
  const voices = ttsDescriptor.voices.map((voice) => ({
    accent: voice.accent, voiceId: voice.voiceId, displayName: voice.displayName,
    sourceType: 'WINDOWS_COMPONENT', redistribution: voice.redistribution,
  }));
  const [learnerFile, vocabularyFile, cacheManifest] = await Promise.all([
    fileStatus(persistence.filePath), fileStatus(vocabularyLibrary.filePath), fileStatus(pronunciationCache.manifestPath),
  ]);
  const readiness = [];
  if (realThirdPartyCount === 0) readiness.push('REAL_CONTENT_PENDING');
  if (!voices.some((voice) => voice.accent === 'us')) readiness.push('US_PRONUNCIATION_UNAVAILABLE');
  if (!voices.some((voice) => voice.accent === 'uk')) readiness.push('UK_PRONUNCIATION_UNAVAILABLE');
  const usReady = voices.some((voice) => voice.accent === 'us');
  const ukReady = voices.some((voice) => voice.accent === 'uk');
  return deepFreeze({
    diagnosticsVersion: LOCAL_STUDY_CENTER_DIAGNOSTICS_VERSION,
    generatedAt: now,
    status: readiness.length === 0 ? 'READY' : 'PARTIAL',
    readiness,
    runtime: { mode, localOnly: true, onlineServices: false, networkDependency: 0, scheduler: scheduler.implementation },
    content: {
      total: entries.length,
      collectionCount: 1,
      syntheticCount,
      authorizedLocalCount: authorizedRealCount,
      realThirdPartyCount,
      realCET6Status: realThirdPartyCount > 100
        ? 'CET6_THIRD_PARTY_REAL_COLLECTION_READY'
        : realThirdPartyCount > 0
          ? 'CET6_THIRD_PARTY_REAL_PILOT_READY'
          : 'REAL_CONTENT_PENDING',
      officialCET6Status: 'OFFICIAL_CET6_PENDING',
      sources,
      importCount: imports.length,
    },
    pronunciation: {
      runtime: ttsDescriptor.runtime,
      available: ttsDescriptor.available,
      defaultAccent: 'us',
      usStatus: usReady ? 'LOCAL_US_PRONUNCIATION_READY' : 'US_VOICE_NOT_INSTALLED',
      ukStatus: ukReady ? 'LOCAL_UK_PRONUNCIATION_READY' : 'UK_VOICE_NOT_INSTALLED',
      dualAccentStatus: usReady && ukReady ? 'DUAL_ACCENT_LOCAL_TTS_READY' : 'DUAL_ACCENT_LOCAL_TTS_PARTIAL',
      networkTts: false,
      voices,
      cache: cacheManifest,
    },
    persistence: { learnerState: learnerFile, vocabularyLibrary: vocabularyFile, singleWriter: true },
    lastImportReceipt: importWorkflow.lastImport()?.receipt ?? null,
    queue: { total: queue.total, counts: queue.counts },
  });
}
