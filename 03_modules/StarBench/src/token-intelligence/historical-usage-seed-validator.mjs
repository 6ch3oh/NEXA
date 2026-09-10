import { assertNoSensitiveData } from '../credential-provider.mjs';
import { stableSha256 } from './contracts.mjs';

const keys=['schema_version','record_type','usage_record_id','task_id','project_id','module','task_type','task_summary','provider','model','execution_role','billing_mode','input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','calls','first_attempt_success','codex_intervention','failure_reason','files_read','files_changed','tests_run','tests_passed','tests_failed','duration_seconds','duration_precision','result_status','context_size_or_proxy','source','provenance','metadata'];
const requiredUnknown=['provider','model','billing_mode','input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','calls','first_attempt_success','codex_intervention','failure_reason','files_read','files_changed','context_size_or_proxy'];
const plain=(value)=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const text=(value)=>typeof value==='string'&&value.length>0;
function fail(errors){const error=new Error('Historical Task Usage Seed V0.1 is invalid.');error.name='HistoricalUsageSeedValidationError';error.code='HISTORICAL_USAGE_SEED_INVALID';error.errors=errors;throw error;}
export function computeHistoricalUsageSeedId(record){const copy=structuredClone(record);delete copy.usage_record_id;return `usage_seed_${stableSha256(copy)}`;}
export function validateHistoricalUsageSeed(record){
  const errors=[];try{assertNoSensitiveData(record,'Historical Task Usage Seed');}catch(error){errors.push(error.code??'SENSITIVE_DATA');}
  if(!plain(record))return{valid:false,errors:['TYPE']};
  for(const key of Object.keys(record))if(!keys.includes(key))errors.push(`ADDITIONAL:${key}`);for(const key of keys)if(!(key in record))errors.push(`REQUIRED:${key}`);
  if(record.schema_version!=='0.1'||record.record_type!=='HISTORICAL_TASK_USAGE_SEED')errors.push('CONTRACT');
  for(const key of ['task_id','project_id','module','task_summary'])if(!text(record[key]))errors.push(`TEXT:${key}`);
  if(record.task_type!=='PROJECT_GOAL_EXECUTION'||!['USER_CONFIRMED_GOAL_USAGE','USER_CONFIRMED_CODEX_USAGE'].includes(record.source))errors.push('IDENTITY');
  if(record.provider!==null||record.model!==null||record.billing_mode!==null)errors.push('UNOBSERVED_BILLING_MUST_BE_NULL');
  for(const key of ['input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','files_read','files_changed','context_size_or_proxy'])if(record[key]!==null)errors.push(`UNOBSERVED_MUST_BE_NULL:${key}`);
  if(!Number.isInteger(record.total_tokens)||record.total_tokens<0)errors.push('TOTAL_TOKENS');
  for(const key of ['calls','tests_run','tests_passed','tests_failed'])if(!(record[key]===null||(Number.isInteger(record[key])&&record[key]>=0)))errors.push(`NULLABLE_INTEGER:${key}`);
  if(record.tests_run!==null&&record.tests_passed!==null&&record.tests_failed!==null&&record.tests_run!==record.tests_passed+record.tests_failed)errors.push('TEST_ARITHMETIC');
  if(!(typeof record.duration_seconds==='number'&&Number.isFinite(record.duration_seconds)&&record.duration_seconds>=0)||!['EXACT','APPROXIMATE'].includes(record.duration_precision))errors.push('DURATION');
  if(!['PASS','PARTIAL','FAILED','UNKNOWN'].includes(record.result_status))errors.push('RESULT_STATUS');
  const p=record.provenance;if(!plain(p)||p.source_type!==record.source||!text(p.source_task)||!text(p.source_ref)||Number.isNaN(Date.parse(p.recorded_at))||p.evidence_quality!=='PARTIAL_OBSERVED'||!Array.isArray(p.observed_fields)||!Array.isArray(p.unknown_fields)||!plain(p.field_provenance)||!text(p.token_provenance)||!text(p.duration_provenance)||!text(p.execution_provenance))errors.push('PROVENANCE');
  else{const observed=new Set(p.observed_fields),unknown=new Set(p.unknown_fields);for(const field of observed)if(unknown.has(field)||record[field]===null)errors.push(`PROVENANCE_OBSERVED:${field}`);for(const field of unknown)if(!(field in record)||record[field]!==null)errors.push(`PROVENANCE_UNKNOWN:${field}`);for(const field of requiredUnknown)if(!unknown.has(field))errors.push(`UNKNOWN_NOT_DECLARED:${field}`);}
  if(plain(record.metadata)===false)errors.push('METADATA');
  else if(record.metadata.raw_result!==false||record.metadata.provider_billing_receipt!==false||record.metadata.api_execution_evidence!==false)errors.push('EVIDENCE_CLASS_MUST_REMAIN_USER_CONFIRMED_GOAL_USAGE');
  if(/^usage_seed_[a-f0-9]{64}$/u.test(record.usage_record_id??'')===false)errors.push('USAGE_RECORD_ID_FORMAT');else if(computeHistoricalUsageSeedId(record)!==record.usage_record_id)errors.push('USAGE_RECORD_ID_CONTENT_MISMATCH');
  return{valid:errors.length===0,errors:[...new Set(errors)]};
}
export function assertValidHistoricalUsageSeed(record){const result=validateHistoricalUsageSeed(record);if(!result.valid)fail(result.errors);return record;}
export function classifyHistoricalUsageSeed(record,{existingRecords=[]}={}){const existing=existingRecords.find((item)=>item.usage_record_id===record?.usage_record_id);if(existing&&stableSha256(existing)!==stableSha256(record))return{classification:'CONFLICT',valid:false,duplicate:false,error_codes:['USAGE_RECORD_ID_CONFLICT']};const validation=validateHistoricalUsageSeed(record);if(!validation.valid)return{classification:'INVALID',valid:false,duplicate:false,error_codes:validation.errors};return{classification:'UNKNOWN',valid:true,duplicate:Boolean(existing),error_codes:[],known_fields:[...record.provenance.observed_fields],unknown_fields:[...record.provenance.unknown_fields]};}
