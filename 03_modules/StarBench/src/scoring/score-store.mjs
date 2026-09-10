import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidScoreResult, ScoringContractError } from './score-contracts.mjs';

function boundedPath(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new ScoreStoreError('SCORE_STORE_PATH_ESCAPE', 'Score Store path must be a file below rootDir.');
  return target;
}

function semanticValue(score) {
  const value = structuredClone(score);
  delete value.timestamp;
  return JSON.stringify(value);
}

function finiteUnit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }

function recordId(record) {
  if (record.record_type === 'SCORE_RESULT') return record.score_id;
  if (record.record_type === 'TASK_SCORE') return record.task_score_id;
  if (record.record_type === 'SUITE_SCORE') return record.suite_score_id;
  return null;
}

function assertValidAggregateRecord(record) {
  assertNoSensitiveData(record, 'Aggregate Score');
  if (!record || typeof record !== 'object' || record.schema_version !== '0.1') throw new ScoreStoreError('AGGREGATE_SCORE_INVALID', 'Aggregate Score must use Schema V0.1.');
  if (record.record_type === 'TASK_SCORE') {
    if (!/^taskscore_[a-f0-9]{64}$/u.test(record.task_score_id ?? '') || !/^eval_[a-f0-9]{32}$/u.test(record.evaluation_id ?? '') || !/^run_[A-Za-z0-9_-]+$/u.test(record.run_id ?? '') || typeof record.benchmark_task_id !== 'string' || !(record.task_score === null || finiteUnit(record.task_score)) || !finiteUnit(record.weight_coverage) || !['SCORED', 'PARTIAL', 'UNSCORED', 'MANUAL_REQUIRED'].includes(record.status) || !['TEST_FIXTURE', 'RAW_RESULT', 'IMPORTED_REAL_RESULT'].includes(record.source_class) || (record.source_class === 'TEST_FIXTURE') !== (record.metadata?.fixture_only === true)) throw new ScoreStoreError('TASK_SCORE_INVALID', 'Task Score validation failed.');
    return record;
  }
  if (record.record_type === 'SUITE_SCORE') {
    if (!/^suitescore_[a-f0-9]{64}$/u.test(record.suite_score_id ?? '') || typeof record.suite_identity?.suite_id !== 'string' || !(record.suite_score === null || finiteUnit(record.suite_score)) || !finiteUnit(record.task_coverage) || !finiteUnit(record.effective_coverage) || !['SCORED', 'PARTIAL', 'UNSCORED', 'MANUAL_REQUIRED'].includes(record.status) || !['TEST_FIXTURE', 'RAW_RESULT', 'IMPORTED_REAL_RESULT', 'MIXED'].includes(record.source_class) || (record.source_class === 'TEST_FIXTURE') !== (record.metadata?.fixture_only === true)) throw new ScoreStoreError('SUITE_SCORE_INVALID', 'Suite Score validation failed.');
    return record;
  }
  throw new ScoreStoreError('SCORE_RECORD_TYPE_INVALID', 'Score Store accepts Metric, Task, or Suite Score records only.');
}

function assertValidStoredRecord(record) {
  if (record?.record_type === 'SCORE_RESULT') return assertValidScoreResult(record);
  return assertValidAggregateRecord(record);
}

export class ScoreStoreError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScoreStoreError';
    this.code = code;
  }
}

export class ScoreStore {
  constructor({ filePath, rootDir = process.cwd() }) {
    this.rootDir = resolve(rootDir);
    this.filePath = boundedPath(this.rootDir, filePath);
  }

  async readAll() {
    let text;
    try { text = await readFile(this.filePath, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new ScoreStoreError('SCORE_STORE_READ_FAILED', 'Score Store read failed safely.', error);
    }
    return text.split(/\r?\n/u).filter(Boolean).map((line, index) => {
      try {
        const score = JSON.parse(line);
        assertNoSensitiveData(score, 'Persisted Score Result');
        assertValidStoredRecord(score);
        return score;
      } catch (error) {
        throw new ScoreStoreError('SCORE_STORE_RECORD_INVALID', `Score Store line ${index + 1} is invalid.`, error);
      }
    });
  }

  async write(score) {
    try {
      assertNoSensitiveData(score, 'Score Result');
      assertValidStoredRecord(score);
    } catch (error) {
      if (error instanceof ScoringContractError) throw new ScoreStoreError('SCORE_RESULT_INVALID', 'Score Result validation failed.', error);
      if (error instanceof ScoreStoreError) throw error;
      throw error;
    }
    const identity = recordId(score);
    const existing = (await this.readAll()).find((item) => recordId(item) === identity);
    if (existing) {
      if (semanticValue(existing) !== semanticValue(score)) throw new ScoreStoreError('SCORE_ID_COLLISION', 'score_id already exists with different semantic content.');
      return { status: 'duplicate_skipped', score_id: identity };
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(score)}\n`, { encoding: 'utf8' });
    return { status: 'written', score_id: identity };
  }

  async queryByEvaluationId(value) { return (await this.readAll()).filter((score) => score.evaluation_id === value); }
  async queryByRunId(value) { return (await this.readAll()).filter((score) => score.run_id === value); }
  async queryByBenchmarkTaskId(value) { return (await this.readAll()).filter((score) => score.benchmark_task_id === value); }
  async queryBySuiteId(value) { return (await this.readAll()).filter((score) => score.suite_id === value || score.suite_identity?.suite_id === value); }
  async queryByMetricId(value) { return (await this.readAll()).filter((score) => score.metric_id === value); }
  async queryBySourceClass(value) { return (await this.readAll()).filter((score) => score.source_class === value); }
  async queryByRecordType(value) { return (await this.readAll()).filter((score) => score.record_type === value); }
  async queryOfficialScores() { return (await this.readAll()).filter((score) => ['RAW_RESULT', 'IMPORTED_REAL_RESULT'].includes(score.source_class)); }
}
