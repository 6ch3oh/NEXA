import { stableSha256, validateHistoricalTaskUsage } from './contracts.mjs';

export const HISTORICAL_FIELD_STATES = Object.freeze(['KNOWN', 'UNKNOWN', 'INVALID', 'CONFLICT']);
const identityFields = ['task_id','project_id','module','provider','model','execution_role','billing_mode'];
const observationFields = ['input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','calls','duration','result_status'];
const nullableText = (value) => value === null || (typeof value === 'string' && value.length > 0);
const nullableBoolean = (value) => value === null || typeof value === 'boolean';
const nullableNumber = (value) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);

function fieldState(record, field) {
  if (!(field in record)) return 'INVALID';
  return record[field] === null || record[field] === 'UNKNOWN' ? 'UNKNOWN' : 'KNOWN';
}
function detailedErrors(record) {
  const errors=[];
  if (!nullableText(record.project_id)) errors.push('PROJECT_ID_TYPE');
  if (!nullableText(record.provider)) errors.push('PROVIDER_IDENTITY_TYPE');
  if (!nullableText(record.model)) errors.push('MODEL_IDENTITY_TYPE');
  if (!nullableBoolean(record.first_attempt_success)) errors.push('FIRST_ATTEMPT_SUCCESS_TYPE');
  if (!nullableBoolean(record.codex_intervention)) errors.push('CODEX_INTERVENTION_TYPE');
  if (!nullableText(record.failure_reason)) errors.push('FAILURE_REASON_TYPE');
  if (!nullableNumber(record.duration)) errors.push('DURATION_TYPE');
  if (!(record.context_size_or_proxy === null || typeof record.context_size_or_proxy === 'string' || (typeof record.context_size_or_proxy === 'number' && Number.isFinite(record.context_size_or_proxy) && record.context_size_or_proxy >= 0))) errors.push('CONTEXT_SIZE_TYPE');
  if (!['IMPORTED_HISTORY','TEST_FIXTURE'].includes(record.provenance?.source_class)) errors.push('PROVENANCE_SOURCE_CLASS');
  if (!stringArray(record.provenance?.observed_fields)) errors.push('PROVENANCE_OBSERVED_FIELDS');
  if (!stringArray(record.provenance?.unknown_fields) && record.provenance?.unknown_fields?.length !== 0) errors.push('PROVENANCE_UNKNOWN_FIELDS');
  return errors;
}
function provenanceErrors(record) {
  const errors = [];
  const observed = new Set(record?.provenance?.observed_fields ?? []);
  const unknown = new Set(record?.provenance?.unknown_fields ?? []);
  for (const field of observed) {
    if (unknown.has(field)) errors.push(`PROVENANCE_OVERLAP:${field}`);
    if (field in record && record[field] === null) errors.push(`OBSERVED_FIELD_IS_NULL:${field}`);
  }
  for (const field of unknown) if (field in record && record[field] !== null) errors.push(`UNKNOWN_FIELD_HAS_VALUE:${field}`);
  return errors;
}

export function classifyHistoricalUsageRecord(record, { existingRecords = [] } = {}) {
  const validation = validateHistoricalTaskUsage(record);
  const errors = validation.valid ? detailedErrors(record) : [...new Set(validation.errors.map((error)=>`CONTRACT:${error.code}`))];
  if (validation.valid) errors.push(...provenanceErrors(record));
  if (errors.length) return { classification:'INVALID', valid:false, duplicate:false, field_states:{}, error_codes:[...new Set(errors)] };
  const sameId = existingRecords.find((item)=>item.usage_record_id === record.usage_record_id);
  if (sameId && stableSha256(sameId) !== stableSha256(record)) return { classification:'CONFLICT', valid:false, duplicate:false, field_states:{}, error_codes:['USAGE_RECORD_ID_CONFLICT'] };
  const field_states = Object.fromEntries([...identityFields,...observationFields].map((field)=>[field,fieldState(record,field)]));
  const classification = Object.values(field_states).includes('UNKNOWN') || record.provenance.unknown_fields.length > 0 ? 'UNKNOWN' : 'KNOWN';
  return { classification, valid:true, duplicate:Boolean(sameId), field_states, error_codes:[] };
}

export function assertHistoricalUsageClassifiable(record, options = {}) {
  const result = classifyHistoricalUsageRecord(record, options);
  if (!result.valid) {
    const error = new Error(`Historical usage classification failed: ${result.classification}`);
    error.name = 'HistoricalUsageValidationError'; error.code = `HISTORICAL_USAGE_${result.classification}`; error.error_codes = result.error_codes;
    throw error;
  }
  return result;
}