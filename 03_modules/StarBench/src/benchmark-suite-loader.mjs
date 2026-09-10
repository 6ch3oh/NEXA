import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from './credential-provider.mjs';
import { BenchmarkTaskRegistry, taskReferenceKey } from './benchmark-task-loader.mjs';

const suiteKeys = new Set([
  'schema_version', 'record_type', 'suite_id', 'name', 'version', 'description', 'task_references',
  'default_parameters', 'tags', 'source_class', 'provenance', 'metadata', 'created_at',
]);
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function normalized(value) {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/gu, '\n');
  if (Array.isArray(value)) return value.map(normalized);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
}
function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new BenchmarkSuiteError('SUITE_PATH_ESCAPE', 'Benchmark Suite path must be a file below rootDir.');
  return target;
}

export class BenchmarkSuiteError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BenchmarkSuiteError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateBenchmarkSuite(suite) {
  const errors = [];
  try { assertNoSensitiveData(suite, 'Benchmark Suite'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(suite)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Suite must be an object.' }] };
  for (const key of Object.keys(suite)) if (!suiteKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of suiteKeys) if (!(key in suite)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (suite.schema_version !== '0.1') errors.push({ path: '/schema_version', code: 'const', message: 'Expected 0.1.' });
  if (suite.record_type !== 'BENCHMARK_SUITE') errors.push({ path: '/record_type', code: 'const', message: 'Expected BENCHMARK_SUITE.' });
  if (!idPattern.test(suite.suite_id ?? '')) errors.push({ path: '/suite_id', code: 'pattern', message: 'Invalid suite id.' });
  if (!versionPattern.test(suite.version ?? '')) errors.push({ path: '/version', code: 'pattern', message: 'Invalid semantic version.' });
  for (const key of ['name', 'description']) if (!nonEmptyString(suite[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!Array.isArray(suite.task_references) || suite.task_references.length === 0) errors.push({ path: '/task_references', code: 'type', message: 'At least one task reference is required.' });
  const seenKeys = new Set();
  const seenOrders = new Set();
  for (const [index, ref] of (Array.isArray(suite.task_references) ? suite.task_references : []).entries()) {
    if (!plain(ref) || !idPattern.test(ref?.benchmark_task_id ?? '') || !versionPattern.test(ref?.version ?? '') || !Number.isInteger(ref?.order) || ref.order < 0 || Object.keys(ref ?? {}).some((key) => !['benchmark_task_id', 'version', 'order'].includes(key))) {
      errors.push({ path: `/task_references/${index}`, code: 'type', message: 'Invalid task reference.' });
      continue;
    }
    const key = taskReferenceKey(ref.benchmark_task_id, ref.version);
    if (seenKeys.has(key)) errors.push({ path: `/task_references/${index}`, code: 'duplicate_reference', message: `Duplicate task reference ${key}.` });
    if (seenOrders.has(ref.order)) errors.push({ path: `/task_references/${index}/order`, code: 'duplicate_order', message: `Duplicate task order ${ref.order}.` });
    seenKeys.add(key);
    seenOrders.add(ref.order);
  }
  if (!plain(suite.default_parameters)) errors.push({ path: '/default_parameters', code: 'type', message: 'default_parameters must be an object.' });
  if (!Array.isArray(suite.tags) || !suite.tags.every(nonEmptyString) || new Set(suite.tags).size !== suite.tags.length) errors.push({ path: '/tags', code: 'type', message: 'tags must be unique strings.' });
  if (!['TEST_FIXTURE', 'AUTHORED_DEFINITION'].includes(suite.source_class)) errors.push({ path: '/source_class', code: 'enum', message: 'Invalid source class.' });
  if (!plain(suite.provenance) || !['LOCAL_AUTHORED', 'AUTHORIZED_IMPORT'].includes(suite.provenance?.origin) || !(suite.provenance?.source_ref === null || typeof suite.provenance?.source_ref === 'string') || Object.keys(suite.provenance ?? {}).some((key) => !['origin', 'source_ref'].includes(key))) errors.push({ path: '/provenance', code: 'type', message: 'Invalid provenance.' });
  if (!plain(suite.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (!nonEmptyString(suite.created_at) || Number.isNaN(Date.parse(suite.created_at))) errors.push({ path: '/created_at', code: 'format', message: 'Invalid created_at.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidBenchmarkSuite(suite) {
  if (suite?.record_type === 'LEGACY_SUMMARY') throw new BenchmarkSuiteError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter the Benchmark Suite loader.');
  const checked = validateBenchmarkSuite(suite);
  if (!checked.valid) throw new BenchmarkSuiteError('BENCHMARK_SUITE_INVALID', 'Benchmark Suite validation failed.', checked.errors);
  return suite;
}

export function computeSuiteIdentity(suite) {
  assertNoSensitiveData(suite, 'Benchmark Suite identity input');
  assertValidBenchmarkSuite(suite);
  const digest = createHash('sha256').update(JSON.stringify(normalized({
    suite_id: suite.suite_id,
    version: suite.version,
    task_references: [...suite.task_references].sort((left, right) => left.order - right.order),
    default_parameters: suite.default_parameters,
  }))).digest('hex');
  return { suite_id: suite.suite_id, suite_version: suite.version, suite_definition_sha256: digest };
}

export function resolveBenchmarkSuite(suite, registry) {
  assertValidBenchmarkSuite(suite);
  if (!(registry instanceof BenchmarkTaskRegistry)) throw new BenchmarkSuiteError('TASK_REGISTRY_REQUIRED', 'A BenchmarkTaskRegistry is required.');
  const tasks = [...suite.task_references].sort((left, right) => left.order - right.order).map((reference) => {
    const task = registry.get(reference.benchmark_task_id, reference.version);
    if (!task) throw new BenchmarkSuiteError('BENCHMARK_TASK_REFERENCE_MISSING', `Suite references missing task ${taskReferenceKey(reference.benchmark_task_id, reference.version)}.`);
    return { order: reference.order, task };
  });
  return { definition: structuredClone(suite), suite_identity: computeSuiteIdentity(suite), tasks };
}

export async function loadBenchmarkSuite(filePath, { rootDir = process.cwd(), registry } = {}) {
  const target = boundedFile(rootDir, filePath);
  let suite;
  try { suite = JSON.parse(await readFile(target, 'utf8')); } catch (error) {
    throw new BenchmarkSuiteError(error instanceof SyntaxError ? 'BENCHMARK_SUITE_JSON_INVALID' : 'BENCHMARK_SUITE_READ_FAILED', 'Benchmark Suite could not be loaded.', [], error);
  }
  return resolveBenchmarkSuite(suite, registry);
}
