import { createHash } from 'node:crypto';

import { assertNoSensitiveData } from './credential-provider.mjs';

const rawKeys = new Set([
  'schema_version', 'record_type', 'run_id', 'timestamp', 'provider', 'model', 'benchmark_task',
  'task_identity', 'prompt_identity', 'parameters', 'success', 'latency_ms', 'ttft_ms',
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second', 'cost',
  'request_provenance', 'error', 'source_class', 'metadata',
]);

const canonicalKeys = new Set([
  'schema_version', 'evaluation_id', 'run_id', 'timestamp', 'provider', 'model', 'benchmark_task',
  'task_identity', 'success', 'latency_ms', 'ttft_ms', 'prompt_tokens', 'completion_tokens',
  'total_tokens', 'throughput_tokens_per_second', 'cost', 'provenance', 'error',
  'raw_source_identity', 'metadata',
]);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableNumber(value) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function nullableInteger(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hashRecord(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export class RawResultValidationError extends Error {
  constructor(code, message, errors = []) {
    super(message);
    this.name = 'RawResultValidationError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateRawResult(record) {
  const errors = [];
  try {
    assertNoSensitiveData(record, 'RAW_RESULT');
  } catch (error) {
    errors.push({ path: '/', code: error.code ?? 'sensitive', message: error.message });
  }
  if (!plain(record)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Record must be an object.' }] };
  for (const key of Object.keys(record)) if (!rawKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of rawKeys) if (!(key in record)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (record.schema_version !== '0.1') errors.push({ path: '/schema_version', code: 'const', message: 'Expected 0.1.' });
  if (!['RAW_RESULT', 'TEST_FIXTURE'].includes(record.record_type)) errors.push({ path: '/record_type', code: 'enum', message: 'LEGACY_SUMMARY and unknown record types are not importable.' });
  if (!/^run_[A-Za-z0-9_-]+$/u.test(record.run_id ?? '')) errors.push({ path: '/run_id', code: 'pattern', message: 'Invalid run_id.' });
  if (!nonEmptyString(record.timestamp) || Number.isNaN(Date.parse(record.timestamp))) errors.push({ path: '/timestamp', code: 'format', message: 'Invalid timestamp.' });
  for (const key of ['provider', 'model', 'benchmark_task']) if (!nonEmptyString(record[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected a non-empty string.' });
  if (!plain(record.task_identity) || !nonEmptyString(record.task_identity?.task_id)) errors.push({ path: '/task_identity', code: 'type', message: 'task_id is required.' });
  if (!plain(record.prompt_identity) || !nonEmptyString(record.prompt_identity?.prompt_id) || !('prompt_version' in (record.prompt_identity ?? {}))) errors.push({ path: '/prompt_identity', code: 'type', message: 'prompt_id and prompt_version are required.' });
  if (!plain(record.parameters)) errors.push({ path: '/parameters', code: 'type', message: 'parameters must be an object.' });
  if (typeof record.success !== 'boolean') errors.push({ path: '/success', code: 'type', message: 'success must be boolean.' });
  for (const key of ['latency_ms', 'ttft_ms', 'throughput_tokens_per_second']) if (!nullableNumber(record[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-negative number or null.' });
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (!nullableInteger(record[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-negative integer or null.' });
  if (record.cost !== null && (!plain(record.cost) || !nullableNumber(record.cost.amount) || !nonEmptyString(record.cost.currency) || record.cost.source !== 'OBSERVED')) errors.push({ path: '/cost', code: 'type', message: 'Known cost must be observed and complete; otherwise use null.' });
  const provenance = record.request_provenance;
  if (!plain(provenance) || !['provider_identity', 'adapter_identity', 'adapter_version', 'endpoint_class'].every((key) => nonEmptyString(provenance?.[key])) || !(provenance?.request_id === null || typeof provenance?.request_id === 'string') || !plain(provenance?.execution_environment)) errors.push({ path: '/request_provenance', code: 'type', message: 'Request provenance is incomplete.' });
  if (record.success === true && record.error !== null) errors.push({ path: '/error', code: 'semantic', message: 'Successful records must have null error.' });
  if (record.success === false && (!plain(record.error) || !nonEmptyString(record.error?.category) || typeof record.error?.safe_message !== 'string' || !(record.error?.status_code === null || Number.isInteger(record.error?.status_code)) || typeof record.error?.retryable !== 'boolean')) errors.push({ path: '/error', code: 'semantic', message: 'Failed records require a safe structured error.' });
  if (!plain(record.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  const expectedSource = record.record_type === 'TEST_FIXTURE' ? 'TEST_FIXTURE' : record.record_type === 'RAW_RESULT' ? 'PROVIDER_EXECUTION' : null;
  if (record.source_class !== expectedSource) errors.push({ path: '/source_class', code: 'semantic', message: 'source_class does not match record_type.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidRawResult(record) {
  const checked = validateRawResult(record);
  if (!checked.valid) throw new RawResultValidationError('RAW_RESULT_INVALID', 'RAW_RESULT validation failed.', checked.errors);
  return record;
}

export function validateCanonicalEvaluation(evaluation) {
  const errors = [];
  try { assertNoSensitiveData(evaluation, 'Canonical Evaluation'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(evaluation)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Evaluation must be an object.' }] };
  for (const key of Object.keys(evaluation)) if (!canonicalKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of canonicalKeys) if (!(key in evaluation)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (evaluation.schema_version !== '0.1') errors.push({ path: '/schema_version', code: 'const', message: 'Expected 0.1.' });
  if (!/^eval_[a-f0-9]{32}$/u.test(evaluation.evaluation_id ?? '')) errors.push({ path: '/evaluation_id', code: 'pattern', message: 'Invalid evaluation_id.' });
  if (!/^run_[A-Za-z0-9_-]+$/u.test(evaluation.run_id ?? '')) errors.push({ path: '/run_id', code: 'pattern', message: 'Invalid run_id.' });
  if (!nonEmptyString(evaluation.timestamp) || Number.isNaN(Date.parse(evaluation.timestamp))) errors.push({ path: '/timestamp', code: 'format', message: 'Invalid timestamp.' });
  for (const key of ['provider', 'model', 'benchmark_task']) if (!nonEmptyString(evaluation[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!plain(evaluation.task_identity) || !nonEmptyString(evaluation.task_identity?.task_id)) errors.push({ path: '/task_identity', code: 'type', message: 'task_id is required.' });
  if (typeof evaluation.success !== 'boolean') errors.push({ path: '/success', code: 'type', message: 'success must be boolean.' });
  for (const key of ['latency_ms', 'ttft_ms', 'throughput_tokens_per_second']) if (!nullableNumber(evaluation[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected number or null.' });
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (!nullableInteger(evaluation[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected integer or null.' });
  if (evaluation.cost !== null && (!plain(evaluation.cost) || !nullableNumber(evaluation.cost.amount) || !nonEmptyString(evaluation.cost.currency) || evaluation.cost.source !== 'OBSERVED')) errors.push({ path: '/cost', code: 'type', message: 'Known cost must be observed and complete; otherwise use null.' });
  const provenance = evaluation.provenance;
  if (!plain(provenance) || !['provider_identity', 'adapter_identity', 'adapter_version', 'endpoint_class'].every((key) => nonEmptyString(provenance?.[key])) || !(provenance?.request_id === null || typeof provenance?.request_id === 'string') || !plain(provenance?.execution_environment) || !plain(provenance?.parameters) || !plain(provenance?.prompt_identity)) errors.push({ path: '/provenance', code: 'type', message: 'Canonical provenance is incomplete.' });
  if (evaluation.success === true && evaluation.error !== null) errors.push({ path: '/error', code: 'semantic', message: 'Successful evaluations must have null error.' });
  if (evaluation.success === false && (!plain(evaluation.error) || !nonEmptyString(evaluation.error?.category) || typeof evaluation.error?.safe_message !== 'string' || !(evaluation.error?.status_code === null || Number.isInteger(evaluation.error?.status_code)) || typeof evaluation.error?.retryable !== 'boolean')) errors.push({ path: '/error', code: 'semantic', message: 'Failed evaluations require a safe structured error.' });
  if (!plain(evaluation.raw_source_identity) || evaluation.raw_source_identity?.raw_schema_version !== '0.1' || !/^[a-f0-9]{64}$/u.test(evaluation.raw_source_identity?.raw_record_sha256 ?? '') || evaluation.raw_source_identity?.raw_run_id !== evaluation.run_id || !['PROVIDER_EXECUTION', 'TEST_FIXTURE'].includes(evaluation.raw_source_identity?.source_class)) errors.push({ path: '/raw_source_identity', code: 'traceability', message: 'Raw source identity is invalid.' });
  if (!plain(evaluation.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  return { valid: errors.length === 0, errors };
}

export function importRawResult(record) {
  if (record?.record_type === 'LEGACY_SUMMARY') throw new RawResultValidationError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter the Evaluation pipeline.');
  assertValidRawResult(record);
  const rawHash = hashRecord(record);
  const evaluation = {
    schema_version: '0.1',
    evaluation_id: `eval_${rawHash.slice(0, 32)}`,
    run_id: record.run_id,
    timestamp: record.timestamp,
    provider: record.provider,
    model: record.model,
    benchmark_task: record.benchmark_task,
    task_identity: structuredClone(record.task_identity),
    success: record.success,
    latency_ms: record.latency_ms,
    ttft_ms: record.ttft_ms,
    prompt_tokens: record.prompt_tokens,
    completion_tokens: record.completion_tokens,
    total_tokens: record.total_tokens,
    throughput_tokens_per_second: record.throughput_tokens_per_second,
    cost: structuredClone(record.cost),
    provenance: { ...structuredClone(record.request_provenance), parameters: structuredClone(record.parameters), prompt_identity: structuredClone(record.prompt_identity) },
    error: structuredClone(record.error),
    raw_source_identity: {
      raw_schema_version: record.schema_version,
      raw_run_id: record.run_id,
      raw_record_sha256: rawHash,
      source_class: record.source_class,
    },
    metadata: structuredClone(record.metadata),
  };
  const checked = validateCanonicalEvaluation(evaluation);
  if (!checked.valid) throw new RawResultValidationError('CANONICAL_EVALUATION_INVALID', 'Canonical Evaluation validation failed.', checked.errors);
  return evaluation;
}
