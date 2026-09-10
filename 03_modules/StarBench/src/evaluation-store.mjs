import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from './credential-provider.mjs';
import { validateCanonicalEvaluation } from './raw-result-importer.mjs';

export class EvaluationStoreError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'EvaluationStoreError';
    this.code = code;
  }
}

function boundedPath(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new EvaluationStoreError('STORE_PATH_ESCAPE', 'Store path must be a file below rootDir.');
  return target;
}

export class EvaluationStore {
  constructor({ filePath, rootDir = process.cwd() }) {
    this.rootDir = resolve(rootDir);
    this.filePath = boundedPath(this.rootDir, filePath);
  }

  async readAll() {
    let text;
    try { text = await readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new EvaluationStoreError('STORE_READ_FAILED', 'Evaluation store read failed safely.', error);
    }
    return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try {
        const value = JSON.parse(line);
        assertNoSensitiveData(value, 'Persisted Evaluation');
        const checked = validateCanonicalEvaluation(value);
        if (!checked.valid) throw new Error('Canonical validation failed.');
        return value;
      } catch (error) {
        throw new EvaluationStoreError('STORE_RECORD_INVALID', `Evaluation store line ${index + 1} is invalid.`, error);
      }
    });
  }

  async write(evaluation) {
    assertNoSensitiveData(evaluation, 'Canonical Evaluation');
    const checked = validateCanonicalEvaluation(evaluation);
    if (!checked.valid) throw new EvaluationStoreError('EVALUATION_INVALID', 'Canonical Evaluation validation failed.');
    const existing = (await this.readAll()).find((item) => item.evaluation_id === evaluation.evaluation_id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(evaluation)) throw new EvaluationStoreError('EVALUATION_ID_COLLISION', 'evaluation_id already exists with different content.');
      return { status: 'duplicate_skipped', evaluation_id: evaluation.evaluation_id };
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(evaluation)}\n`, { encoding: 'utf8' });
    return { status: 'written', evaluation_id: evaluation.evaluation_id };
  }

  async queryByRunId(runId) { return (await this.readAll()).filter((item) => item.run_id === runId); }
  async queryByProvider(provider) { return (await this.readAll()).filter((item) => item.provider === provider); }
  async queryByModel(model) { return (await this.readAll()).filter((item) => item.model === model); }
  async queryByBenchmarkTask(task) { return (await this.readAll()).filter((item) => item.benchmark_task === task); }
}
