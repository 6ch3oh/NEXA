import { deepFreeze } from '../domain/shared.mjs';
import { createJsonVocabularyImporter } from './json-vocabulary-importer.mjs';
import { ImportErrorCode, createImportFailure } from './importer-contract.mjs';

export const VOCABULARY_SOURCE_CLASSIFICATION_VERSION = '0.1';

export const VocabularySourceClassification = Object.freeze({
  OFFICIAL: 'OFFICIAL',
  THIRD_PARTY: 'THIRD_PARTY',
  USER_PROVIDED: 'USER_PROVIDED',
  SYNTHETIC: 'SYNTHETIC',
  UNKNOWN_SOURCE: 'UNKNOWN_SOURCE',
});

export function createVocabularySourceDescriptor({ classification, evidenceRef = null }) {
  if (!Object.values(VocabularySourceClassification).includes(classification)) {
    throw new TypeError(`unsupported source classification: ${classification}`);
  }
  if (evidenceRef !== null && (typeof evidenceRef !== 'string' || evidenceRef.trim() === '')) {
    throw new TypeError('evidenceRef must be a non-empty string or null');
  }
  if (classification === VocabularySourceClassification.OFFICIAL && evidenceRef === null) {
    throw new TypeError('OFFICIAL source requires evidenceRef');
  }
  return Object.freeze({
    sourceVersion: VOCABULARY_SOURCE_CLASSIFICATION_VERSION,
    classification,
    evidenceRef,
    officialEvidenceProvided: classification === VocabularySourceClassification.OFFICIAL,
  });
}

export function createSourceClassifiedJsonVocabularyImporter(store, descriptorInput) {
  const source = createVocabularySourceDescriptor(descriptorInput);
  const delegate = createJsonVocabularyImporter(store);

  function rejectFalseOfficial(preview) {
    if (!preview.ok || source.classification !== VocabularySourceClassification.OFFICIAL) return null;
    const containsSynthetic = preview.entries.some((entry) => (
      entry.tags.includes('synthetic')
      || entry.tags.includes('test')
      || entry.sourceRefs.some((ref) => ref.startsWith('test:') || ref.includes('synthetic'))
    ));
    return containsSynthetic
      ? createImportFailure(ImportErrorCode.INVALID_ENTRY, 'synthetic or test vocabulary cannot be classified as OFFICIAL', {
        sourceCode: 'FALSE_OFFICIAL_CLASSIFICATION',
      })
      : null;
  }

  function withSource(result) {
    return result.ok ? deepFreeze({ ...result, source }) : result;
  }

  return Object.freeze({
    ...delegate,
    source,
    validate(input) {
      const preview = delegate.preview(input);
      const rejected = rejectFalseOfficial(preview);
      if (rejected) return rejected;
      if (!preview.ok) return preview;
      return withSource(delegate.validate(input));
    },
    preview(input) {
      const preview = delegate.preview(input);
      const rejected = rejectFalseOfficial(preview);
      return rejected ?? withSource(preview);
    },
    import(input) {
      const preview = delegate.preview(input);
      const rejected = rejectFalseOfficial(preview);
      if (rejected) return rejected;
      if (!preview.ok) return preview;
      return withSource(delegate.import(input));
    },
  });
}
