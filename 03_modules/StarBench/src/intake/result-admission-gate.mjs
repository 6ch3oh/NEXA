import { assertNoSensitiveData } from '../credential-provider.mjs';
import { validateRawResult } from '../raw-result-importer.mjs';
import { plain, stableSha256 } from '../scoring/score-contracts.mjs';
import { validateProvenanceCompleteness } from './provenance-validator.mjs';

export const RAW_RESULT_FIELD_POLICY = Object.freeze({
  identity_required: ['schema_version', 'record_type', 'run_id', 'timestamp', 'provider', 'model', 'benchmark_task', 'task_identity', 'prompt_identity', 'parameters', 'source_class'],
  execution_outcome_required: ['success', 'latency_ms', 'error'],
  conditionally_optional_nullable: ['ttft_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second', 'cost', 'request_provenance.request_id'],
  unknown_policy: 'Use explicit null/UNAVAILABLE; never synthesize zero.',
});

const incompleteKeys = new Set(['schema_version', 'record_type', 'run_id', 'timestamp', 'provider', 'model', 'benchmark_task', 'task_identity', 'prompt_identity', 'parameters', 'outcome_status', 'success', 'latency_ms', 'ttft_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second', 'cost', 'request_provenance', 'error', 'missing_fields', 'availability', 'source_class', 'metadata']);
const outcomeStatuses = new Set(['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'INVALID']);
const optionalFields = ['latency_ms', 'ttft_ms', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'throughput_tokens_per_second', 'cost'];

function nonEmpty(value) { return typeof value === 'string' && value.length > 0; }
function nullableNumber(value) { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0); }
function nullableInteger(value) { return value === null || (Number.isInteger(value) && value >= 0); }
function safeIdentity(record) { return { schema_version: typeof record?.schema_version === 'string' ? record.schema_version : null, record_type: typeof record?.record_type === 'string' ? record.record_type : null, run_id: typeof record?.run_id === 'string' ? record.run_id : null, provider: typeof record?.provider === 'string' ? record.provider : null, model: typeof record?.model === 'string' ? record.model : null }; }

export function validateIncompleteResult(record) {
  const errors = [];
  try { assertNoSensitiveData(record, 'Incomplete Result'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(record)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Incomplete Result must be an object.' }] };
  for (const key of Object.keys(record)) if (!incompleteKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of incompleteKeys) if (!(key in record)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (record.schema_version !== '0.1' || record.record_type !== 'INCOMPLETE_RESULT') errors.push({ path: '/', code: 'contract', message: 'Expected Incomplete Result V0.1.' });
  if (!/^run_[A-Za-z0-9_-]+$/u.test(record.run_id ?? '') || !nonEmpty(record.timestamp) || Number.isNaN(Date.parse(record.timestamp))) errors.push({ path: '/', code: 'identity', message: 'Invalid run identity or timestamp.' });
  for (const key of ['provider', 'model', 'benchmark_task']) if (!nonEmpty(record[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!plain(record.task_identity) || !nonEmpty(record.task_identity?.task_id) || !('task_version' in (record.task_identity ?? {})) || !plain(record.prompt_identity) || !nonEmpty(record.prompt_identity?.prompt_id) || !('prompt_version' in (record.prompt_identity ?? {})) || !plain(record.parameters)) errors.push({ path: '/', code: 'provenance', message: 'Task, prompt, and parameters are required.' });
  if (!outcomeStatuses.has(record.outcome_status) || !(record.success === null || typeof record.success === 'boolean')) errors.push({ path: '/', code: 'outcome', message: 'Invalid outcome status or success value.' });
  for (const key of ['latency_ms', 'ttft_ms', 'throughput_tokens_per_second']) if (!nullableNumber(record[key])) errors.push({ path: `/${key}`, code: 'range', message: 'Expected non-negative number or null.' });
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) if (!nullableInteger(record[key])) errors.push({ path: `/${key}`, code: 'range', message: 'Expected non-negative integer or null.' });
  if (record.cost !== null && (!plain(record.cost) || !nullableNumber(record.cost.amount) || !nonEmpty(record.cost.currency) || !['provider_reported', 'billing_export', 'locally_calculated'].includes(record.cost.source))) errors.push({ path: '/cost', code: 'cost', message: 'Known cost requires amount, currency, and an explicit source.' });
  const provenance = record.request_provenance;
  if (!plain(provenance) || !['provider_identity', 'adapter_identity', 'adapter_version', 'endpoint_class'].every((key) => nonEmpty(provenance?.[key])) || !(provenance?.request_id === null || typeof provenance?.request_id === 'string') || !plain(provenance?.execution_environment)) errors.push({ path: '/request_provenance', code: 'provenance', message: 'Request provenance is incomplete.' });
  if (!Array.isArray(record.missing_fields) || new Set(record.missing_fields).size !== record.missing_fields.length || !record.missing_fields.every(nonEmpty) || !plain(record.availability) || Object.values(record.availability ?? {}).some((value) => !['OBSERVED', 'UNAVAILABLE', 'NOT_APPLICABLE'].includes(value))) errors.push({ path: '/', code: 'availability', message: 'Invalid missing field or availability declaration.' });
  for (const field of record.missing_fields ?? []) if (!(field in record) || record[field] !== null || record.availability?.[field] !== 'UNAVAILABLE') errors.push({ path: `/missing_fields/${field}`, code: 'missing_field_inconsistent', message: 'Missing observations must be null and explicitly UNAVAILABLE.' });
  for (const field of optionalFields) if (record[field] === null && record.availability?.[field] === 'OBSERVED') errors.push({ path: `/availability/${field}`, code: 'availability_inconsistent', message: 'Null observations cannot be OBSERVED.' });
  if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(record.outcome_status) && (record.success !== false || !plain(record.error))) errors.push({ path: '/error', code: 'outcome_semantic', message: 'Failed, timed out, or cancelled outcomes require success=false and safe error.' });
  if (record.outcome_status === 'PARTIAL' && record.missing_fields?.length === 0) errors.push({ path: '/missing_fields', code: 'partial_without_missing', message: 'PARTIAL must identify at least one missing field.' });
  if (record.outcome_status === 'INVALID') errors.push({ path: '/outcome_status', code: 'invalid_outcome', message: 'INVALID result cannot be admitted.' });
  if (!plain(record.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  if (!['TEST_FIXTURE', 'PROVIDER_EXECUTION'].includes(record.source_class)) errors.push({ path: '/source_class', code: 'source', message: 'Invalid source class.' });
  return { valid: errors.length === 0, errors };
}

export function checkResultIntegrity(record) {
  const failures = [];
  if (!/^run_[A-Za-z0-9_-]+$/u.test(record?.run_id ?? '')) failures.push('RUN_ID_INVALID');
  if (!nonEmpty(record?.timestamp) || Number.isNaN(Date.parse(record.timestamp))) failures.push('TIMESTAMP_INVALID');
  if (!nonEmpty(record?.provider) || !nonEmpty(record?.model)) failures.push('SUBJECT_IDENTITY_MISSING');
  if (!nonEmpty(record?.task_identity?.task_id) || !nonEmpty(record?.prompt_identity?.prompt_id)) failures.push('TASK_OR_PROMPT_IDENTITY_MISSING');
  for (const key of ['latency_ms', 'ttft_ms', 'throughput_tokens_per_second']) if (record?.[key] !== null && (!(typeof record?.[key] === 'number') || !Number.isFinite(record[key]) || record[key] < 0)) failures.push(`${key.toUpperCase()}_INVALID`);
  if (record?.latency_ms !== null && record?.ttft_ms !== null && record.ttft_ms > record.latency_ms) failures.push('TTFT_EXCEEDS_LATENCY');
  if ([record?.prompt_tokens, record?.completion_tokens, record?.total_tokens].every((value) => value !== null && value !== undefined) && record.total_tokens !== record.prompt_tokens + record.completion_tokens) failures.push('TOKEN_TOTAL_INCONSISTENT');
  if (record?.cost !== null && (typeof record?.cost?.amount !== 'number' || record.cost.amount < 0)) failures.push('COST_INVALID');
  const measurement = record?.metadata?.measurement_provenance;
  if (record?.throughput_tokens_per_second !== null && record?.throughput_tokens_per_second !== undefined) {
    const throughput = measurement?.throughput;
    if (!plain(throughput) || !['provider_reported', 'computed'].includes(throughput.source) || (throughput.source === 'computed' && !nonEmpty(throughput.formula))) failures.push('THROUGHPUT_PROVENANCE_MISSING');
  }
  if (record?.cost !== null && record?.record_type !== 'INCOMPLETE_RESULT') {
    const cost = measurement?.cost;
    if (!plain(cost) || !['provider_reported', 'billing_export', 'locally_calculated'].includes(cost.source)) failures.push('COST_PROVENANCE_MISSING');
  }
  if (record?.record_type === 'RAW_RESULT' && record?.source_class !== 'PROVIDER_EXECUTION') failures.push('SOURCE_CLASS_MISMATCH');
  if (record?.record_type === 'TEST_FIXTURE' && record?.source_class !== 'TEST_FIXTURE') failures.push('SOURCE_CLASS_MISMATCH');
  if (record?.record_type === 'INCOMPLETE_RESULT' && !['TEST_FIXTURE', 'PROVIDER_EXECUTION'].includes(record?.source_class)) failures.push('SOURCE_CLASS_MISMATCH');
  if (record?.success === true && record?.error !== null) failures.push('SUCCESS_ERROR_CONFLICT');
  if (record?.success === false && !plain(record?.error)) failures.push('FAILURE_ERROR_MISSING');
  return { status: failures.length === 0 ? 'PASS' : 'FAIL', reason_codes: [...new Set(failures)].sort() };
}

export class ResultAdmissionGate {
  assess(record) {
    const identity = safeIdentity(record);
    let secretStatus = 'CLEAN';
    try { assertNoSensitiveData(record, 'Incoming Result'); } catch { secretStatus = 'DETECTED'; }
    if (record?.record_type === 'LEGACY_SUMMARY') return this.#decision(identity, { status: 'REJECTED', reasonCodes: ['LEGACY_SUMMARY_REJECTED'], schemaStatus: 'INCOMPATIBLE', secretStatus, provenance: validateProvenanceCompleteness(record), integrity: { status: 'NOT_RUN', reason_codes: [] }, missingFields: [], officialEligible: false });
    if (secretStatus === 'DETECTED') return this.#decision(identity, { status: 'QUARANTINE_REQUIRED', reasonCodes: ['SENSITIVE_DATA_DETECTED'], schemaStatus: 'NOT_ADMITTED', secretStatus, provenance: { status: 'INSUFFICIENT', missing_fields: [], partial_fields: [], secret_status: secretStatus }, integrity: { status: 'NOT_RUN', reason_codes: [] }, missingFields: [], officialEligible: false });
    const schema = record?.record_type === 'INCOMPLETE_RESULT' ? validateIncompleteResult(record) : validateRawResult(record);
    const provenance = validateProvenanceCompleteness(record);
    const integrity = checkResultIntegrity(record);
    const missingFields = record?.record_type === 'INCOMPLETE_RESULT' ? [...(record.missing_fields ?? [])] : [];
    const reasonCodes = [];
    let status;
    if (!schema.valid) { status = 'REJECTED'; reasonCodes.push('SCHEMA_VALIDATION_FAILED', ...schema.errors.map((error) => `SCHEMA_${String(error.code).toUpperCase()}`)); }
    else if (provenance.status === 'INSUFFICIENT') { status = 'REJECTED'; reasonCodes.push('PROVENANCE_INSUFFICIENT'); }
    else if (integrity.status === 'FAIL') { status = 'REJECTED'; reasonCodes.push(...integrity.reason_codes); }
    else if (record.record_type === 'INCOMPLETE_RESULT' || provenance.status === 'PARTIAL') { status = 'ADMITTED_PARTIAL'; reasonCodes.push(record.record_type === 'INCOMPLETE_RESULT' ? 'INCOMPLETE_RESULT_ACCEPTED' : 'PROVENANCE_PARTIAL'); }
    else { status = 'ADMITTED'; reasonCodes.push('RESULT_ADMITTED'); }
    const officialEligible = status === 'ADMITTED' && record?.record_type === 'RAW_RESULT' && record?.source_class === 'PROVIDER_EXECUTION' && provenance.status === 'COMPLETE';
    if (record?.source_class === 'TEST_FIXTURE') reasonCodes.push('TEST_FIXTURE_NON_OFFICIAL');
    return this.#decision(identity, { status, reasonCodes, schemaStatus: schema.valid ? 'V0_1_COMPATIBLE' : 'INCOMPATIBLE', secretStatus, provenance, integrity, missingFields, officialEligible });
  }

  #decision(identity, { status, reasonCodes, schemaStatus, secretStatus, provenance, integrity, missingFields, officialEligible }) {
    const semantic = { identity, status, reason_codes: [...new Set(reasonCodes)].sort(), schema_status: schemaStatus, provenance_status: provenance.status, integrity, missing_fields: [...missingFields].sort(), official_eligible: officialEligible };
    return { schema_version: '0.1', record_type: 'RESULT_ADMISSION_DECISION', admission_id: `admission_${stableSha256(semantic)}`, status, record_identity: identity, schema_status: schemaStatus, secret_status: secretStatus, provenance_status: provenance.status, provenance, integrity_status: integrity.status, integrity_reason_codes: integrity.reason_codes, missing_fields: [...missingFields].sort(), reason_codes: semantic.reason_codes, source_class: identity.record_type === 'RAW_RESULT' ? 'PROVIDER_EXECUTION' : identity.record_type === 'TEST_FIXTURE' || identity.record_type === 'INCOMPLETE_RESULT' ? 'TEST_FIXTURE_OR_INCOMPLETE' : 'UNKNOWN', official_eligible: officialEligible, compatibility_status: schemaStatus };
  }
}
