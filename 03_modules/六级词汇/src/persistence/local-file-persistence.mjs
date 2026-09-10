import {
  open,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { deepFreeze } from '../domain/shared.mjs';
import {
  SnapshotValidationError,
  parseLearnerSnapshot,
  serializeLearnerSnapshot,
  validateLearnerSnapshot,
} from './learner-snapshot.mjs';
import {
  PERSISTENCE_CONTRACT_VERSION,
  PersistenceError,
  assertPersistenceAdapter,
} from './persistence-contract.mjs';
import { SINGLE_WRITER_SCOPE, processLocalSingleWriter } from './single-writer.mjs';

export const LOCAL_FILE_PERSISTENCE_VERSION = '0.1';

function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '' || !isAbsolute(filePath)) {
    throw new PersistenceError('INVALID_PERSISTENCE_PATH', 'filePath must be an explicit absolute path');
  }
  return filePath;
}

export function createLocalFilePersistenceAdapter({
  filePath,
  writerCoordinator = processLocalSingleWriter,
}) {
  const canonicalPath = validateFilePath(filePath);
  if (writerCoordinator === null || typeof writerCoordinator !== 'object'
    || typeof writerCoordinator.run !== 'function') {
    throw new PersistenceError('INVALID_WRITER_COORDINATOR', 'writerCoordinator.run() is required');
  }
  const tempFilePrefix = `.${basename(canonicalPath)}.tmp-`;
  let saveSequence = 0;

  async function exists() {
    try {
      const info = await stat(canonicalPath);
      if (!info.isFile()) {
        throw new PersistenceError('INVALID_PERSISTENCE_PATH', 'persistence path exists but is not a file');
      }
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceError('PERSISTENCE_STAT_FAILED', error.message, { filePath: canonicalPath }, { cause: error });
    }
  }

  function validate(snapshot) {
    return validateLearnerSnapshot(snapshot);
  }

  async function loadRaw() {
    if (!(await exists())) return null;
    let text;
    try {
      text = await readFile(canonicalPath, 'utf8');
    } catch (error) {
      throw new PersistenceError('PERSISTENCE_LOAD_FAILED', error.message, { filePath: canonicalPath }, { cause: error });
    }
    try {
      return deepFreeze(JSON.parse(text));
    } catch (error) {
      throw new SnapshotValidationError('INVALID_JSON', 'snapshot is not valid JSON', undefined, { cause: error });
    }
  }

  async function load() {
    const raw = await loadRaw();
    if (raw === null) return null;
    return parseLearnerSnapshot(JSON.stringify(raw));
  }

  async function save(snapshot) {
    validate(snapshot);
    const serialized = serializeLearnerSnapshot(snapshot);
    return writerCoordinator.run(canonicalPath, async () => {
      await mkdir(dirname(canonicalPath), { recursive: true });
      saveSequence += 1;
      const tempPath = join(
        dirname(canonicalPath),
        `${tempFilePrefix}${process.pid}-${Date.now()}-${saveSequence}`,
      );
      let handle = null;
      let renamed = false;
      try {
        handle = await open(tempPath, 'wx');
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(tempPath, canonicalPath);
        renamed = true;
        return deepFreeze({
          adapterVersion: LOCAL_FILE_PERSISTENCE_VERSION,
          writerScope: SINGLE_WRITER_SCOPE,
          filePath: canonicalPath,
          bytes: Buffer.byteLength(serialized, 'utf8'),
        });
      } catch (error) {
        throw new PersistenceError('PERSISTENCE_SAVE_FAILED', error.message, {
          filePath: canonicalPath,
          tempPath,
        }, { cause: error });
      } finally {
        if (handle !== null) {
          try { await handle.close(); } catch { /* preserve the primary error */ }
        }
        if (!renamed) {
          try { await unlink(tempPath); } catch (error) {
            if (error?.code !== 'ENOENT') {
              // A failed cleanup never replaces the primary save result or touches the final file.
            }
          }
        }
      }
    });
  }

  return assertPersistenceAdapter(Object.freeze({
    contractVersion: PERSISTENCE_CONTRACT_VERSION,
    adapterVersion: LOCAL_FILE_PERSISTENCE_VERSION,
    writerScope: SINGLE_WRITER_SCOPE,
    filePath: canonicalPath,
    tempFilePrefix,
    exists,
    validate,
    loadRaw,
    load,
    save,
  }));
}
