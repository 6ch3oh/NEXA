import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ForecastWorkbench } from './forecast-workbench.mjs';
import { parseNexaPlanMarkdown, mapNexaPlanToProjectBrief } from './nexa-plan-intake.mjs';
import { stableSha256 } from './contracts.mjs';
import { createForecastSeal, classifyForecastLifecycle } from './forecast-lifecycle.mjs';
import { createForecastCloseout, renderCloseoutSummary, renderProspectiveSummary } from './forecast-closeout.mjs';
import { ForecastLedger } from './forecast-ledger.mjs';
import { reviewCalibrationRule } from './calibration-governance.mjs';

export async function runGoalDCommand(options,{rootDir,bounded,readJson}){
 if(!['prospective-start','prospective-status','prospective-close','calibration-review'].includes(options.command))return null;
 const ledgerPath=bounded(rootDir,options.ledger??'data/forecast-ledger/forecast-ledger.jsonl'),ledger=new ForecastLedger({rootDir,filePath:ledgerPath});
 if(options.command==='prospective-start'){
  if(!options.input||!options.output||!options.project_id||!options.goal_id)return 2;
  const planPath=bounded(rootDir,options.input),content=await readFile(planPath,'utf8'),intake=parseNexaPlanMarkdown(content);if(intake.status!=='READY')return 3;
  const mapped=mapNexaPlanToProjectBrief(intake.normalized_plan);mapped.brief.project_id=options.project_id;
  const result=new ForecastWorkbench().run({input:mapped.brief,format:'json',parent_run_id:options.parent_forecast??null});
  const workbench=new ForecastWorkbench(),written=await workbench.writeBundle(result.bundle,{rootDir,outputDir:bounded(rootDir,options.output)}),created_at=(await stat(join(written.directory,'manifest.json'))).birthtime.toISOString(),sealed_at=new Date().toISOString(),seal=createForecastSeal({forecast:result.bundle.forecast,manifest:result.bundle.manifest,plan_identity:`plan_${stableSha256(content)}`,brief_identity:`brief_${stableSha256(result.bundle.brief)}`,project_id:options.project_id,goal_id:options.goal_id,created_at,sealed_at,parent_forecast_id:options.parent_forecast??null,reason_for_revision:options.revision_reason??null});
  await writeFile(join(written.directory,'forecast-seal.json'),`${JSON.stringify(seal,null,2)}\n`,'utf8');await writeFile(join(written.directory,'prospective-summary.txt'),`${renderProspectiveSummary(seal)}\n`,'utf8');
  await ledger.append({entry_type:'FORECAST',project_id:seal.project_id,goal_id:seal.goal_id,subject_id:seal.forecast_id,payload:{run_id:result.bundle.manifest.run_id,plan_identity:seal.plan_identity},recorded_at:created_at});await ledger.append({entry_type:'SEAL',project_id:seal.project_id,goal_id:seal.goal_id,subject_id:seal.seal_id,payload:seal,recorded_at:sealed_at});
  process.stdout.write(`${JSON.stringify({status:'SEALED',forecast_id:seal.forecast_id,seal_id:seal.seal_id,optimistic:seal.metadata.optimistic_tokens,expected:seal.metadata.expected_tokens,conservative:seal.metadata.conservative_tokens,confidence:seal.metadata.forecast_confidence})}\n`);return 0;
 }
 if(options.command==='prospective-status'){if(!options.goal_id)return 2;process.stdout.write(`${JSON.stringify(await ledger.status(options.goal_id),null,2)}\n`);return 0;}
 if(options.command==='prospective-close'){
  if(!options.seal||!options.actual||!options.output)return 2;
  const seal=await readJson(bounded(rootDir,options.seal)),actual=await readJson(bounded(rootDir,options.actual)),structural_diagnosis=options.diagnosis?await readJson(bounded(rootDir,options.diagnosis)):[],lifecycle=classifyForecastLifecycle({seal,actual});
  if(lifecycle.classification!=='PROSPECTIVE_FORECAST'||lifecycle.status!=='READY_TO_CLOSE'){const e=new Error('Forecast is not eligible for prospective closeout.');e.code='PROSPECTIVE_CLOSE_INELIGIBLE';throw e;}
  const closeout=createForecastCloseout({seal,actual,structural_diagnosis,closed_at:new Date().toISOString()});
  await ledger.append({entry_type:'ACTUAL_LINK',project_id:seal.project_id,goal_id:seal.goal_id,subject_id:seal.seal_id,payload:{actual_usage_receipt_id:actual.receipt_id,scope_match:true,temporal_evidence:lifecycle.temporal_evidence,actual_completion_time:lifecycle.actual_completion_time??actual.completed_at},recorded_at:closeout.closed_at});
  await ledger.append({entry_type:'CLOSEOUT',project_id:seal.project_id,goal_id:seal.goal_id,subject_id:seal.seal_id,payload:closeout,recorded_at:closeout.closed_at});
  const output=bounded(rootDir,options.output);await mkdir(output,{recursive:true});await writeFile(join(output,'forecast-closeout.json'),`${JSON.stringify(closeout,null,2)}\n`,'utf8');await writeFile(join(output,'forecast-closeout.txt'),`${renderCloseoutSummary(closeout)}\n`,'utf8');process.stdout.write(`${JSON.stringify({status:'CLOSED',closeout_id:closeout.closeout_id})}\n`);return 0;
 }
 if(options.command==='calibration-review'){
  if(!options.input||!options.output)return 2;const rule=reviewCalibrationRule(await readJson(bounded(rootDir,options.input))),output=bounded(rootDir,options.output);await mkdir(output,{recursive:true});await writeFile(join(output,`${rule.rule_id}.json`),`${JSON.stringify(rule,null,2)}\n`,'utf8');
  if(options.ledger_goal_id)await ledger.append({entry_type:'CALIBRATION_DIAGNOSIS',project_id:options.project_id??'starbench',goal_id:options.ledger_goal_id,subject_id:rule.rule_id,payload:rule,recorded_at:rule.reviewed_at});
  process.stdout.write(`${JSON.stringify({status:rule.status,rule_id:rule.rule_id})}\n`);return 0;
 }
}
