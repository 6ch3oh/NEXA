import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { stableSha256 } from './contracts.mjs';
import { assertValidActualUsageReceipt } from './actual-usage-receipt.mjs';

function bounded(rootDir,filePath){const root=resolve(rootDir),target=resolve(filePath),rel=relative(root,target);if(rel===''||rel==='..'||rel.startsWith(`..${sep}`)||rel.startsWith(sep)){const error=new Error('Actual Usage Receipt Store path must be below rootDir.');error.code='ACTUAL_USAGE_RECEIPT_STORE_PATH_ESCAPE';throw error;}return target;}
export class ActualUsageReceiptStore{
 constructor({rootDir=process.cwd(),filePath}){this.rootDir=resolve(rootDir);this.filePath=bounded(this.rootDir,filePath);}
 async readAll(){let content;try{content=await readFile(this.filePath,'utf8');}catch(error){if(error.code==='ENOENT')return[];throw error;}return content.split(/\r?\n/u).filter(Boolean).map(line=>assertValidActualUsageReceipt(JSON.parse(line)));}
 async write(receipt){const value=structuredClone(assertValidActualUsageReceipt(receipt)),records=await this.readAll(),same=records.find(item=>item.receipt_id===value.receipt_id);if(same){if(stableSha256(same)!==stableSha256(value)){const error=new Error('Actual Usage Receipt ID conflict.');error.code='ACTUAL_USAGE_RECEIPT_CONFLICT';throw error;}return{status:'DUPLICATE_SKIPPED',receipt_id:value.receipt_id};}await mkdir(dirname(this.filePath),{recursive:true});const temp=`${this.filePath}.tmp-${process.pid}`;await rm(temp,{force:true});try{await writeFile(temp,`${[...records,value].map(item=>JSON.stringify(item)).join('\n')}\n`,{encoding:'utf8',flag:'wx'});await rename(temp,this.filePath);}catch(error){await rm(temp,{force:true});throw error;}return{status:'WRITTEN',receipt_id:value.receipt_id};}
}
