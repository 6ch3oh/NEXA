import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from './credential-provider.mjs';

const taskKeys = new Set([
  'schema_version', 'record_type', 'benchmark_task_id', 'name', 'category', 'task_type',
  'description', 'prompt', 'input_definition', 'prompt_identity', 'expected_output',
  'evaluation_method', 'metrics', 'parameters', 'tags', 'source_class', 'provenance',
  'metadata', 'created_at', 'version',
]);
const categories = new Set(['planning', 'reasoning', 'coding', 'instruction_following', 'long_context', 'cost_efficiency', 'agent']);
const evaluationMethods = new Set(['deterministic', 'exact_match', 'rule_based', 'manual', 'model_judge_future']);
const metricNames = new Set(['correctness', 'instruction_following', 'completion', 'latency', 'token_usage', 'cost']);
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function normalized(value) {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\r\n?/gu, '\n');
  if (Array.isArray(value)) return value.map(normalized);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
}

function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    throw new BenchmarkTaskError('TASK_PATH_ESCAPE', 'Benchmark task path must be a file below rootDir.');
  }
  return target;
}

function uniqueStrings(value, allowed = null) {
  return Array.isArray(value) && value.every(nonEmptyString) && new Set(value).size === value.length && (!allowed || value.every((item) => allowed.has(item)));
}

export class BenchmarkTaskError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BenchmarkTaskError';
    this.code = code;
    this.errors = errors;
  }
}

export function computePromptIdentity(task) {
  assertNoSensitiveData(task, 'Benchmark Task prompt identity input');
  if (!plain(task) || !plain(task.prompt) || !plain(task.input_definition)) {
    throw new BenchmarkTaskError('PROMPT_IDENTITY_INPUT_INVALID', 'Prompt and input_definition are required for identity.');
  }
  const promptVersion = task.prompt_identity?.prompt_version ?? task.version;
  if (!nonEmptyString(promptVersion)) throw new BenchmarkTaskError('PROMPT_VERSION_REQUIRED', 'Prompt version is required.');
  return {
    algorithm: 'sha256',
    prompt_id: `prompt_${sha256({ prompt_version: promptVersion, prompt: task.prompt, input_definition: task.input_definition })}`,
    prompt_version: promptVersion,
  };
}

export function computeTaskIdentity(task) {
  assertNoSensitiveData(task, 'Benchmark Task identity input');
  if (!idPattern.test(task?.benchmark_task_id ?? '') || !versionPattern.test(task?.version ?? '')) {
    throw new BenchmarkTaskError('TASK_IDENTITY_INPUT_INVALID', 'benchmark_task_id and semantic version are required.');
  }
  return { task_id: task.benchmark_task_id, task_version: task.version };
}

export function computeTaskDefinitionSha256(task) {
  assertNoSensitiveData(task, 'Benchmark Task definition');
  return sha256(task);
}

export function validateBenchmarkTask(task) {
  const errors = [];
  try { assertNoSensitiveData(task, 'Benchmark Task'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(task)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Task must be an object.' }] };
  for (const key of Object.keys(task)) if (!taskKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of taskKeys) if (!(key in task)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (task.schema_version !== '0.1') errors.push({ path: '/schema_version', code: 'const', message: 'Expected 0.1.' });
  if (task.record_type !== 'BENCHMARK_TASK') errors.push({ path: '/record_type', code: 'const', message: 'Expected BENCHMARK_TASK.' });
  if (!idPattern.test(task.benchmark_task_id ?? '')) errors.push({ path: '/benchmark_task_id', code: 'pattern', message: 'Invalid stable task id.' });
  if (!versionPattern.test(task.version ?? '')) errors.push({ path: '/version', code: 'pattern', message: 'Invalid semantic version.' });
  for (const key of ['name', 'description']) if (!nonEmptyString(task[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!categories.has(task.category)) errors.push({ path: '/category', code: 'enum', message: 'Unsupported task category.' });
  if (task.task_type !== 'prompt') errors.push({ path: '/task_type', code: 'enum', message: 'V0.1 supports prompt tasks only.' });
  if (!plain(task.prompt) || !nonEmptyString(task.prompt?.instruction) || !nonEmptyString(task.prompt?.input_template) || Object.keys(task.prompt ?? {}).some((key) => !['instruction', 'input_template'].includes(key))) errors.push({ path: '/prompt', code: 'type', message: 'Prompt requires instruction and input_template only.' });
  if (!plain(task.input_definition)) errors.push({ path: '/input_definition', code: 'type', message: 'input_definition must be an object.' });
  if (!plain(task.expected_output) || !['text', 'code', 'structured'].includes(task.expected_output?.type) || !(task.expected_output?.reference === null || typeof task.expected_output?.reference === 'string') || !uniqueStrings(task.expected_output?.criteria) || Object.keys(task.expected_output ?? {}).some((key) => !['type', 'reference', 'criteria'].includes(key))) errors.push({ path: '/expected_output', code: 'type', message: 'Invalid expected output contract.' });
  if (!plain(task.evaluation_method) || !evaluationMethods.has(task.evaluation_method?.type) || !plain(task.evaluation_method?.config) || Object.keys(task.evaluation_method ?? {}).some((key) => !['type', 'config'].includes(key))) errors.push({ path: '/evaluation_method', code: 'type', message: 'Invalid evaluation method declaration.' });
  if (!uniqueStrings(task.metrics, metricNames) || task.metrics.length === 0) errors.push({ path: '/metrics', code: 'type', message: 'At least one supported metric is required.' });
  if (!plain(task.parameters)) errors.push({ path: '/parameters', code: 'type', message: 'parameters must be an object.' });
  if (!uniqueStrings(task.tags)) errors.push({ path: '/tags', code: 'type', message: 'tags must be unique strings.' });
  if (!['TEST_FIXTURE', 'AUTHORED_DEFINITION'].includes(task.source_class)) errors.push({ path: '/source_class', code: 'enum', message: 'Invalid source class.' });
  if (!plain(task.provenance) || !['LOCAL_AUTHORED', 'AUTHORIZED_IMPORT'].includes(task.provenance?.origin) || !(task.provenance?.source_ref === null || typeof task.provenance?.source_ref === 'string') || Object.keys(task.provenance ?? {}).some((key) => !['origin', 'source_ref'].includes(key))) errors.push({ path: '/provenance', code: 'type', message: 'Invalid provenance.' });
  if (!plain(task.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (!nonEmptyString(task.created_at) || Number.isNaN(Date.parse(task.created_at))) errors.push({ path: '/created_at', code: 'format', message: 'Invalid created_at.' });
  if (!plain(task.prompt_identity) || task.prompt_identity?.algorithm !== 'sha256' || !/^prompt_[a-f0-9]{64}$/u.test(task.prompt_identity?.prompt_id ?? '') || !nonEmptyString(task.prompt_identity?.prompt_version) || Object.keys(task.prompt_identity ?? {}).some((key) => !['algorithm', 'prompt_id', 'prompt_version'].includes(key))) {
    errors.push({ path: '/prompt_identity', code: 'type', message: 'Invalid prompt identity.' });
  } else {
    const computed = computePromptIdentity(task);
    if (JSON.stringify(computed) !== JSON.stringify(task.prompt_identity)) errors.push({ path: '/prompt_identity', code: 'identity_mismatch', message: 'Prompt identity does not match normalized prompt definition.' });
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidBenchmarkTask(task) {
  if (task?.record_type === 'LEGACY_SUMMARY') throw new BenchmarkTaskError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter the Benchmark Task registry.');
  const checked = validateBenchmarkTask(task);
  if (!checked.valid) throw new BenchmarkTaskError('BENCHMARK_TASK_INVALID', 'Benchmark Task validation failed.', checked.errors);
  return task;
}

export async function loadBenchmarkTask(filePath, { rootDir = process.cwd() } = {}) {
  const target = boundedFile(rootDir, filePath);
  let task;
  try { task = JSON.parse(await readFile(target, 'utf8')); } catch (error) {
    throw new BenchmarkTaskError(error instanceof SyntaxError ? 'BENCHMARK_TASK_JSON_INVALID' : 'BENCHMARK_TASK_READ_FAILED', 'Benchmark Task could not be loaded.', [], error);
  }
  assertValidBenchmarkTask(task);
  return structuredClone(task);
}

export function taskReferenceKey(benchmarkTaskId, version) {
  return `${benchmarkTaskId}@${version}`;
}

export class BenchmarkTaskRegistry {
  #tasks = new Map();

  register(task) {
    assertValidBenchmarkTask(task);
    const key = taskReferenceKey(task.benchmark_task_id, task.version);
    if (this.#tasks.has(key)) throw new BenchmarkTaskError('BENCHMARK_TASK_DUPLICATE', `Task ${key} is already registered.`);
    this.#tasks.set(key, structuredClone(task));
    return key;
  }

  has(benchmarkTaskId, version) { return this.#tasks.has(taskReferenceKey(benchmarkTaskId, version)); }

  get(benchmarkTaskId, version) {
    const value = this.#tasks.get(taskReferenceKey(benchmarkTaskId, version));
    return value ? structuredClone(value) : null;
  }

  list() {
    return [...this.#tasks.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, task]) => structuredClone(task));
  }
}
