import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from './credential-provider.mjs';
import { assertValidRawResult } from './raw-result-importer.mjs';

export class RawResultWriterError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RawResultWriterError';
    this.code = code;
  }
}

function boundedPath(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new RawResultWriterError('WRITER_PATH_ESCAPE', 'Writer path must be a file below rootDir.');
  return target;
}

export class RawResultWriter {
  constructor({ filePath, rootDir = process.cwd() }) {
    this.rootDir = resolve(rootDir);
    this.filePath = boundedPath(this.rootDir, filePath);
  }

  async write(record) {
    try {
      assertNoSensitiveData(record, 'RAW_RESULT');
      assertValidRawResult(record);
      await mkdir(dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
      return { status: 'written', run_id: record.run_id, file_path: this.filePath };
    } catch (error) {
      if (error instanceof RawResultWriterError) throw error;
      throw new RawResultWriterError(error.code ?? 'RAW_RESULT_WRITE_FAILED', 'RAW_RESULT write failed safely.', error);
    }
  }

  async readAll() {
    let text;
    try { text = await readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new RawResultWriterError('RAW_RESULT_READ_FAILED', 'RAW_RESULT read failed safely.', error);
    }
    const records = [];
    for (const [index, line] of text.split(/\r?\n/u).filter(Boolean).entries()) {
      try {
        const record = JSON.parse(line);
        assertNoSensitiveData(record, 'Persisted RAW_RESULT');
        assertValidRawResult(record);
        records.push(record);
      } catch (error) {
        throw new RawResultWriterError('RAW_RESULT_PERSISTED_INVALID', `Persisted RAW_RESULT line ${index + 1} is invalid.`, error);
      }
    }
    return records;
  }
}
