import { runExternalIdentityEngine } from './external-identity-engine-runner.mjs';
import { validateExternalIdentityRunnerRequest, ExternalIdentityRunnerError } from './external-identity-runner-contracts.mjs';
import { assessIdentityTestCost, assessIdentityUsageAgainstBudget, normalizeIdentityTokenUsage } from './identity-token-accounting.mjs';
import { validateIdentityTestBudget } from './adaptive-identity-budget-contracts.mjs';

function fail(code, message) { throw new ExternalIdentityRunnerError(code, message); }

export function applyAdaptiveBudgetToRunnerRequest({ plan, budget, runnerRequest } = {}) {
  const frozenBudget = validateIdentityTestBudget(budget);
  if (!plan || plan.budget_id !== frozenBudget.budget_id || plan.selected_mode !== frozenBudget.mode) fail('ADAPTIVE_PLAN_BUDGET_MISMATCH', 'Adaptive plan and budget do not match.');
  if (plan.can_continue !== true || !Number.isInteger(plan.effective_request_ceiling) || plan.effective_request_ceiling < 1) fail('ADAPTIVE_PLAN_STOPPED', 'Adaptive plan does not authorize the current local stage.');
  const input = structuredClone(runnerRequest);
  input.request_budget = Math.min(input.request_budget, plan.effective_request_ceiling, frozenBudget.request_ceiling);
  input.runtime_budget_ms = Math.min(input.runtime_budget_ms, frozenBudget.duration_ceiling_ms);
  input.output_budget.max_file_bytes = Math.min(input.output_budget.max_file_bytes, frozenBudget.output_ceiling_bytes);
  input.output_budget.max_total_bytes = Math.min(input.output_budget.max_total_bytes, frozenBudget.output_ceiling_bytes);
  return validateExternalIdentityRunnerRequest(input);
}

export async function executeAdaptiveIdentityStage({
  plan,
  budget,
  runnerRequest,
  usageArtifact = null,
  pricingSnapshot = null,
  entitlementSnapshot = null,
  billingMode = 'API_TOKEN_BILLED',
  modelClass = 'OTHER_API_MODEL',
  previousRequestsUsed = 0,
} = {}) {
  const effectiveRunnerRequest = applyAdaptiveBudgetToRunnerRequest({ plan, budget, runnerRequest });
  const runnerResult = await runExternalIdentityEngine(effectiveRunnerRequest);
  const usage = normalizeIdentityTokenUsage(usageArtifact);
  const cost = assessIdentityTestCost({ usage: usageArtifact, pricingSnapshot, entitlementSnapshot, billingMode, modelClass, calls: runnerResult.request_count });
  const budgetAssessment = assessIdentityUsageAgainstBudget({ budget, usage: usageArtifact, requestsUsed: previousRequestsUsed + runnerResult.request_count, monetaryAssessment: cost, usageRequired: true });
  return {
    status: runnerResult.execution_status !== 'COMPLETED' ? runnerResult.execution_status : budgetAssessment.status === 'STOP_BUDGET_EXHAUSTED' ? 'STOP_BUDGET_EXHAUSTED' : 'COMPLETED',
    plan_id: plan.plan_id,
    budget_id: budget.budget_id,
    effective_runner_request_budget: effectiveRunnerRequest.request_budget,
    runner_result: runnerResult,
    token_usage: usage,
    cost_assessment: cost,
    budget_assessment: budgetAssessment,
    canonical_observation: runnerResult.normalization_result,
    runner_reused: true,
    port_reused: runnerResult.normalization_result?.provenance?.adapter_identity === 'starbench.kbf-offline-adapter',
    automatic_escalation_performed: false,
  };
}
