import { assertNoSensitiveData } from '../credential-provider.mjs';
import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { stableSha256 } from './contracts.mjs';
import { classifyHistoricalUsageRecord } from './historical-usage-validator.mjs';

const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function assertProvenance(value) {
  assertNoSensitiveData(value, 'Historical Usage Intake Provenance');
  const valid = plain(value) && ['00_HISTORICAL_EXPORT','TEST_FIXTURE'].includes(value.source_type) && typeof value.source_ref === 'string' && value.source_ref.length > 0 && !Number.isNaN(Date.parse(value.imported_at)) && ['OBSERVED','PARTIAL','TEST_FIXTURE','UNKNOWN'].includes(value.evidence_quality) && plain(value.field_provenance) && ['token_provenance','duration_provenance','execution_provenance'].every((key)=>value[key] === null || typeof value[key] === 'string');
  if (!valid) { const error = new Error('Historical import provenance is invalid.'); error.code = 'HISTORICAL_INTAKE_PROVENANCE_INVALID'; throw error; }
  return structuredClone(value);
}
function outcome(index, record, classification, disposition, error_codes = []) { return { index, usage_record_id:record?.usage_record_id ?? null, classification, disposition, error_codes }; }

export function intakeHistoricalUsageBatch(entries, { existingRecords = [], provenance } = {}) {
  if (!Array.isArray(entries)) { const error=new Error('Historical intake requires an array.'); error.code='HISTORICAL_INTAKE_ARRAY_REQUIRED'; throw error; }
  const importProvenance = assertProvenance(provenance);
  const accepted_records=[]; const outcomes=[]; const seen=[...existingRecords];
  for (const [index,entry] of entries.entries()) {
    if (entry?.parse_error) { outcomes.push(outcome(index,null,'INVALID','REJECTED',[entry.parse_error])); continue; }
    const record = structuredClone(entry?.record ?? entry);
    const assessment = classifyHistoricalUsageRecord(record,{existingRecords:seen});
    if (!assessment.valid) { outcomes.push(outcome(index,record,assessment.classification,'REJECTED',assessment.error_codes)); continue; }
    if (assessment.duplicate) { outcomes.push(outcome(index,record,assessment.classification,'DUPLICATE_SKIPPED')); continue; }
    accepted_records.push(record); seen.push(record); outcomes.push(outcome(index,record,assessment.classification,'ACCEPTED'));
  }
  const count=(classification,disposition=null)=>outcomes.filter((item)=>item.classification===classification&&(!disposition||item.disposition===disposition)).length;
  const summary={total:outcomes.length,accepted:accepted_records.length,known:count('KNOWN','ACCEPTED'),unknown:count('UNKNOWN','ACCEPTED'),duplicates:outcomes.filter((x)=>x.disposition==='DUPLICATE_SKIPPED').length,invalid:count('INVALID'),conflicts:count('CONFLICT'),rejected:outcomes.filter((x)=>x.disposition==='REJECTED').length};
  const status=summary.rejected===0?'COMPLETE':accepted_records.length||summary.duplicates?'PARTIAL':'REJECTED';
  const semantic={provenance:importProvenance,outcomes,accepted_ids:accepted_records.map((x)=>x.usage_record_id)};
  return {schema_version:'0.1',record_type:'HISTORICAL_USAGE_INTAKE_RECEIPT',batch_id:`history_batch_${stableSha256(semantic)}`,status,provenance:importProvenance,outcomes,accepted_records,summary,truthfulness:{missing_tokens_inferred:false,unknown_preserved:true,legacy_summary_promoted:false},metadata:{partial_record_policy:'ACCEPT_VALID_NULL_AS_UNKNOWN',duplicate_policy:'SKIP_IDENTICAL_REJECT_CONFLICT'}};
}

export function intakeHistoricalUsageRecord(record, options) { return intakeHistoricalUsageBatch([record],options); }
export function intakeHistoricalUsageJsonl(content, options) {
  if (typeof content !== 'string') { const error=new Error('Historical intake requires JSONL text.'); error.code='HISTORICAL_INTAKE_JSONL_REQUIRED'; throw error; }
  const entries=[];
  for (const [index,line] of content.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try { entries.push({record:JSON.parse(line)}); } catch { entries.push({parse_error:`JSON_INVALID_LINE_${index+1}`}); }
  }
  return intakeHistoricalUsageBatch(entries,options);
}
function boundedExport(rootDir,filePath){const root=resolve(rootDir);const target=resolve(filePath);const rel=relative(root,target);if(rel===''||rel==='..'||rel.startsWith(`..${sep}`)||rel.startsWith(sep)){const error=new Error('Historical Export path must be below rootDir.');error.code='HISTORICAL_EXPORT_PATH_ESCAPE';throw error;}return target;}
export async function intakeHistoricalUsageFile(filePath,{rootDir=process.cwd(),...options}={}){
  let content; try{content=await readFile(boundedExport(rootDir,filePath),'utf8');}catch(error){if(error.code==='HISTORICAL_EXPORT_PATH_ESCAPE')throw error;const wrapped=new Error('Historical Export could not be read.');wrapped.code='HISTORICAL_EXPORT_READ_FAILED';wrapped.cause=error;throw wrapped;}
  return intakeHistoricalUsageJsonl(content,options);
}

export async function persistHistoricalUsageReceipt(receipt, store) {
  if (receipt?.record_type !== 'HISTORICAL_USAGE_INTAKE_RECEIPT' || !Array.isArray(receipt.accepted_records)) { const error=new Error('Historical intake receipt required.'); error.code='HISTORICAL_INTAKE_RECEIPT_REQUIRED'; throw error; }
  const writes=[]; for (const record of receipt.accepted_records) writes.push(await store.write(record));
  return {batch_id:receipt.batch_id,written:writes.filter((x)=>x.status==='written').length,duplicate_skipped:writes.filter((x)=>x.status==='duplicate_skipped').length,results:writes};
}