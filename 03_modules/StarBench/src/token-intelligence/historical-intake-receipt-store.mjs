import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { assertNoSensitiveData } from '../credential-provider.mjs';
import { stableSha256 } from './contracts.mjs';

function bounded(rootDir,filePath){const root=resolve(rootDir);const target=resolve(filePath);const rel=relative(root,target);if(rel===''||rel==='..'||rel.startsWith(`..${sep}`)||rel.startsWith(sep)){const error=new Error('Receipt Store path must be below rootDir.');error.code='HISTORICAL_RECEIPT_STORE_PATH_ESCAPE';throw error;}return target;}
function validReceipt(value){return value?.schema_version==='0.1'&&value?.record_type==='HISTORICAL_USAGE_INTAKE_RECEIPT'&&/^history_batch_[a-f0-9]{64}$/u.test(value?.batch_id??'')&&Array.isArray(value?.outcomes)&&Array.isArray(value?.accepted_records)&&value?.truthfulness?.missing_tokens_inferred===false&&value?.truthfulness?.legacy_summary_promoted===false;}
function assertReceipt(value){assertNoSensitiveData(value,'Historical Intake Receipt');if(!validReceipt(value)){const error=new Error('Historical Intake Receipt is invalid.');error.code='HISTORICAL_RECEIPT_INVALID';throw error;}return value;}

export class HistoricalIntakeReceiptStore {
  constructor({filePath,rootDir=process.cwd()}){this.rootDir=resolve(rootDir);this.filePath=bounded(this.rootDir,filePath);}
  async readAll(){let content;try{content=await readFile(this.filePath,'utf8');}catch(error){if(error.code==='ENOENT')return[];throw error;}return content.split(/\r?\n/u).filter(Boolean).map((line)=>assertReceipt(JSON.parse(line)));}
  async write(receipt){const value=structuredClone(assertReceipt(receipt));const existing=(await this.readAll()).find((item)=>item.batch_id===value.batch_id);if(existing){if(stableSha256(existing)!==stableSha256(value)){const error=new Error('Historical receipt batch collision.');error.code='HISTORICAL_RECEIPT_CONFLICT';throw error;}return{status:'duplicate_skipped',batch_id:value.batch_id};}await mkdir(dirname(this.filePath),{recursive:true});await appendFile(this.filePath,`${JSON.stringify(value)}\n`,'utf8');return{status:'written',batch_id:value.batch_id};}
  async queryByBatchId(value){return(await this.readAll()).filter((item)=>item.batch_id===value);}
  async queryByUsageRecordId(value){return(await this.readAll()).filter((item)=>item.outcomes.some((outcome)=>outcome.usage_record_id===value));}
  async traceUsageRecord(value){return(await this.queryByUsageRecordId(value)).map((receipt)=>({batch_id:receipt.batch_id,source_type:receipt.provenance.source_type,source_ref:receipt.provenance.source_ref,imported_at:receipt.provenance.imported_at,evidence_quality:receipt.provenance.evidence_quality,field_provenance:structuredClone(receipt.provenance.field_provenance),outcome:structuredClone(receipt.outcomes.find((item)=>item.usage_record_id===value))}));}
}