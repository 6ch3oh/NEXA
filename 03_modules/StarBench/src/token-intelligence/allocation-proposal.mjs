import { assertValidAllocationProposal, stableSha256 } from './contracts.mjs';

export function buildAllocationProposal({ forecast, expectedGraph }) {
  const grouped = new Map();
  for (const unit of expectedGraph.work_units) {
    const key = `${unit.execution_role}|${unit.recommended_model_class}|${unit.billing_mode}`;
    const current = grouped.get(key) ?? { execution_role:unit.execution_role, task_types:new Set(), recommended_model_class:unit.recommended_model_class, billing_mode:unit.billing_mode, estimated_calls:0, estimated_tokens:0 };
    current.task_types.add(unit.task_type); current.estimated_calls += unit.expected_calls; current.estimated_tokens += unit.call_estimates.reduce((n,c)=>n+c.total_tokens,0); grouped.set(key,current);
  }
  const total = [...grouped.values()].reduce((n,x)=>n+x.estimated_tokens,0);
  const allocations = [...grouped.values()].sort((a,b)=>a.execution_role.localeCompare(b.execution_role)).map((item)=>({
    execution_role:item.execution_role, task_types:[...item.task_types].sort(), recommended_model_class:item.recommended_model_class, billing_mode:item.billing_mode,
    estimated_calls:item.estimated_calls, estimated_tokens:item.estimated_tokens, resource_share:total===0?0:item.estimated_tokens/total,
    reason:item.recommended_model_class==='CODEX'?'Repository-aware implementation, integration, testing, and repair work.':'Project reasoning, architecture, and acceptance synthesis.',
    alternative:item.recommended_model_class==='CODEX'?'SUBSCRIPTION_MODEL':'OTHER_API_MODEL',
    constraints:['ADVISORY_ONLY','NO_AUTOMATIC_MODEL_SWITCH','NO_AUTOMATIC_EXECUTION','NO_QUOTA_CONSUMPTION'],
  }));
  const semantic={forecast_id:forecast.forecast_id,allocations:allocations.map(({resource_share,...rest})=>rest)};
  return assertValidAllocationProposal({schema_version:'0.1',record_type:'MODEL_ALLOCATION_PROPOSAL',proposal_id:`allocation_${stableSha256(semantic)}`,project_id:forecast.project_summary.project_id,forecast_id:forecast.forecast_id,proposal_status:'ADVISORY_ONLY',allocations,constraints:['Proposal does not control workers or providers','Specific model SKUs are external choices'],metadata:{automatic_model_control:false}});
}
