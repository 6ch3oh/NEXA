import { stableSha256 } from './contracts.mjs';

const hindsight=new Set(['actual_total_tokens','actual_duration_seconds','final_tests','completion_report','failure_history']);
export function assessBacktestEligibility({case_id,plan,actual,scope,forecast_created_at=null,actual_completed_at=null,forecast_input_fields=[]}){
 let status='ELIGIBLE_BACKTEST',reason='Independent pre-execution Plan exists and scope matches.';
 if(!plan){status='NO_PRE_EXECUTION_PLAN';reason='No authentic pre-execution Plan was found.';}
 else if(!plan.source_ref||!plan.created_at||Number.isNaN(Date.parse(plan.created_at))){status='INSUFFICIENT_PROVENANCE';reason='Plan provenance is insufficient.';}
 else if(scope?.project_id!==actual?.project_id||scope?.task_id!==actual?.task_id){status='SCOPE_MISMATCH';reason='Plan and actual usage scope differ.';}
 else if(forecast_input_fields.some(field=>hindsight.has(field))||(forecast_created_at&&actual_completed_at&&Date.parse(forecast_created_at)>=Date.parse(actual_completed_at))){status='HINDSIGHT_CONTAMINATED';reason='Post-completion knowledge is present.';}
 const evaluation_mode=status==='ELIGIBLE_BACKTEST'?(forecast_created_at?'PROSPECTIVE_BACKTEST':'RETROSPECTIVE_MODEL_EVALUATION'):null;
 return{schema_version:'0.1',record_type:'BACKTEST_ELIGIBILITY',eligibility_id:`eligibility_${stableSha256({case_id,status,plan:plan?.source_ref??null,actual:actual?.usage_record_id??actual?.receipt_id??null,scope,evaluation_mode})}`,case_id,status,reason,evaluation_mode,forecast_was_preexisting:Boolean(forecast_created_at),plan_was_pre_execution:status==='ELIGIBLE_BACKTEST',hindsight_fields:forecast_input_fields.filter(field=>hindsight.has(field)),scope,metadata:{automatic_matching:false}};
}
