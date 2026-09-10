import { deepFreeze } from '../domain/shared.mjs';

export const VOCABULARY_IMPORTER_CONTRACT_VERSION = '0.1';

export const ImportFormat = Object.freeze({
  JSON: 'JSON',
  TXT: 'TXT',
  MARKDOWN: 'MARKDOWN',
  CSV: 'CSV',
  EXCEL: 'EXCEL',
  PDF_TEXT: 'PDF_TEXT',
});

export const ImportErrorCode = Object.freeze({
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_IMPORT_ROOT: 'INVALID_IMPORT_ROOT',
  INVALID_ENTRY: 'INVALID_ENTRY',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  DUPLICATE_IDENTITY: 'DUPLICATE_IDENTITY',
  STORE_REJECTED: 'STORE_REJECTED',
});

export const IMPORTER_METHODS = Object.freeze(['validate', 'preview', 'import']);

export function createImportFailure(code, message, details = undefined) {
  return deepFreeze({
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function assertImporterContract(importer) {
  if (importer === null || typeof importer !== 'object') throw new TypeError('importer object required');
  if (!Object.values(ImportFormat).includes(importer.format)) throw new TypeError('declared importer format required');
  for (const method of IMPORTER_METHODS) {
    if (typeof importer[method] !== 'function') throw new TypeError(`importer.${method}() is required`);
  }
  return importer;
}

export function createUnsupportedImporter(format) {
  const failure = () => createImportFailure(
    ImportErrorCode.UNSUPPORTED_FORMAT,
    `${format} import is declared but not implemented in V0.1`,
    { format },
  );
  return Object.freeze({
    contractVersion: VOCABULARY_IMPORTER_CONTRACT_VERSION,
    format,
    validate: failure,
    preview: failure,
    import: failure,
  });
}
