import {
  Cet6ContractError,
  deepFreeze,
} from '../domain/shared.mjs';
import {
  createVocabularyEntry,
  validateVocabularyCollection,
} from '../domain/vocabulary-entry.mjs';
import {
  VocabularyStoreError,
  assertVocabularyStore,
} from '../store/vocabulary-store.mjs';
import {
  ImportErrorCode,
  ImportFormat,
  VOCABULARY_IMPORTER_CONTRACT_VERSION,
  assertImporterContract,
  createImportFailure,
  createUnsupportedImporter,
} from './importer-contract.mjs';

function parseInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input !== 'string') {
    return createImportFailure(
      ImportErrorCode.INVALID_IMPORT_ROOT,
      'JSON import input must be an array or JSON text encoding an array',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    return createImportFailure(ImportErrorCode.INVALID_JSON, 'input is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    return createImportFailure(ImportErrorCode.INVALID_IMPORT_ROOT, 'JSON import root must be an array');
  }
  return parsed;
}

function domainFailure(error, index = undefined) {
  if (!(error instanceof Cet6ContractError)) {
    return createImportFailure(ImportErrorCode.INVALID_ENTRY, 'entry failed domain validation');
  }
  if (error.code === 'UNSUPPORTED_VERSION') {
    return createImportFailure(ImportErrorCode.UNSUPPORTED_VERSION, error.message, {
      index,
      path: error.path,
      domainCode: error.code,
    });
  }
  if (error.code === 'DUPLICATE_ID' || error.code === 'DUPLICATE_HEADWORD') {
    return createImportFailure(ImportErrorCode.DUPLICATE_IDENTITY, error.message, {
      index,
      path: error.path,
      domainCode: error.code,
    });
  }
  return createImportFailure(ImportErrorCode.INVALID_ENTRY, error.message, {
    index,
    path: error.path,
    domainCode: error.code,
  });
}

function evaluate(input) {
  const parsed = parseInput(input);
  if (!Array.isArray(parsed)) return parsed;
  const entries = [];
  for (const [index, rawEntry] of parsed.entries()) {
    try {
      entries.push(createVocabularyEntry(rawEntry));
    } catch (error) {
      return domainFailure(error, index);
    }
  }
  try {
    validateVocabularyCollection(entries);
  } catch (error) {
    return domainFailure(error);
  }
  return deepFreeze({ ok: true, entries });
}

export function createJsonVocabularyImporter(store) {
  assertVocabularyStore(store);

  const importer = {
    contractVersion: VOCABULARY_IMPORTER_CONTRACT_VERSION,
    format: ImportFormat.JSON,
    validate(input) {
      const evaluated = evaluate(input);
      if (!evaluated.ok) return evaluated;
      return deepFreeze({ ok: true, format: ImportFormat.JSON, entryCount: evaluated.entries.length });
    },
    preview(input) {
      const evaluated = evaluate(input);
      if (!evaluated.ok) return evaluated;
      return deepFreeze({
        ok: true,
        format: ImportFormat.JSON,
        entryCount: evaluated.entries.length,
        entries: evaluated.entries,
      });
    },
    import(input) {
      const evaluated = evaluate(input);
      if (!evaluated.ok) return evaluated;
      try {
        const added = store.addMany(evaluated.entries);
        return deepFreeze({
          ok: true,
          format: ImportFormat.JSON,
          importedCount: added.length,
          entryIds: added.map((entry) => entry.entryId),
        });
      } catch (error) {
        if (error instanceof VocabularyStoreError) {
          const code = error.code.startsWith('DUPLICATE_')
            ? ImportErrorCode.DUPLICATE_IDENTITY
            : ImportErrorCode.STORE_REJECTED;
          return createImportFailure(code, error.message, { storeCode: error.code });
        }
        throw error;
      }
    },
  };
  assertImporterContract(importer);
  return Object.freeze(importer);
}

export function createVocabularyImporter({ format, store }) {
  if (format === ImportFormat.JSON) return createJsonVocabularyImporter(store);
  if (Object.values(ImportFormat).includes(format)) return createUnsupportedImporter(format);
  return createUnsupportedImporter(String(format ?? 'UNKNOWN'));
}
