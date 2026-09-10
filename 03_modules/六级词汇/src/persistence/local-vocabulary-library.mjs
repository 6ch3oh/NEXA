import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { deepFreeze } from '../domain/shared.mjs';
import { createJsonVocabularyImporter } from '../import/json-vocabulary-importer.mjs';
import { createInMemoryVocabularyStore } from '../store/vocabulary-store.mjs';
import { validateStudyContentLibraryCollection } from '../import/study-content-package-contract.mjs';

export const LOCAL_VOCABULARY_LIBRARY_VERSION = '0.1';

export function createLocalVocabularyLibrary({ filePath }) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new TypeError('absolute filePath required');
  let sequence = 0;

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed.version !== LOCAL_VOCABULARY_LIBRARY_VERSION || !Array.isArray(parsed.entries) || !Array.isArray(parsed.imports)
        || (parsed.contentCollections !== undefined && !Array.isArray(parsed.contentCollections))) {
        throw new TypeError('invalid local vocabulary library');
      }
      const validationStore = createInMemoryVocabularyStore();
      const preview = createJsonVocabularyImporter(validationStore).preview(parsed.entries);
      if (!preview.ok) throw new TypeError(`invalid persisted vocabulary: ${preview.error.code}`);
      const contentCollections = parsed.contentCollections?.map(validateStudyContentLibraryCollection);
      return deepFreeze({ version: parsed.version, entries: preview.entries, imports: parsed.imports, ...(contentCollections === undefined ? {} : { contentCollections }) });
    } catch (error) {
      if (error?.code === 'ENOENT') return deepFreeze({ version: LOCAL_VOCABULARY_LIBRARY_VERSION, entries: [], imports: [] });
      throw error;
    }
  }

  async function save({ entries, imports = [], contentCollections = undefined }) {
    const validationStore = createInMemoryVocabularyStore();
    const preview = createJsonVocabularyImporter(validationStore).preview(entries);
    if (!preview.ok) throw new TypeError(`invalid vocabulary library write: ${preview.error.code}`);
    if (!Array.isArray(imports)) throw new TypeError('imports array required');
    if (contentCollections !== undefined && !Array.isArray(contentCollections)) throw new TypeError('contentCollections array required');
    const canonicalCollections = contentCollections?.map(validateStudyContentLibraryCollection);
    if (canonicalCollections && new Set(canonicalCollections.map((item) => item.manifest.collectionId)).size !== canonicalCollections.length) throw new TypeError('duplicate content collectionId');
    const document = { version: LOCAL_VOCABULARY_LIBRARY_VERSION, entries: preview.entries, imports, ...(canonicalCollections === undefined ? {} : { contentCollections: canonicalCollections }) };
    const payload = `${JSON.stringify(document, null, 2)}\n`;
    await mkdir(dirname(filePath), { recursive: true });
    sequence += 1;
    const temp = join(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}-${sequence}`);
    let handle = null;
    try {
      handle = await open(temp, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temp, filePath);
    } finally {
      if (handle) await handle.close();
      try { await unlink(temp); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    return deepFreeze({ version: LOCAL_VOCABULARY_LIBRARY_VERSION, filePath, entryCount: preview.entryCount, importCount: imports.length, contentCollectionCount: canonicalCollections?.length ?? 0 });
  }

  return Object.freeze({ version: LOCAL_VOCABULARY_LIBRARY_VERSION, filePath, load, save });
}
