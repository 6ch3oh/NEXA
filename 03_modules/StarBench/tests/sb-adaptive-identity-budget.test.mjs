import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';

import {
  createIdentityTestBudget,
  EVIDENCE_SUFFICIENCY_STATES,
  IDENTITY_MODE_POLICIES,
  IDENTITY_TEST_MODES,
  TOKEN_LIMIT_UNKNOWN,
} from '../src/external-identity/adaptive-identity-budget-contracts.mjs';
import {
  ADAPTIVE_IDENTITY_TEST_PLANNER_VERSION,
  evaluateCachedReferenceReuse,
  planAdaptiveIdentityTest,
  planProgressiveLongContext,
} from '../src/external-identity/adaptive-identity-test-planner.mjs';
import {
  applyAdaptiveBudgetToRunnerRequest,
  executeAdaptiveIdentityStage,
} from '../src/external-identity/adaptive-identity-runner-integration.mjs';
import {
  assessIdentityTestCost,
  assessIdentityUsageAgainstBudget,
  normalizeIdentityTokenUsage,
} from '../src/external-identity/identity-token-accounting.mjs';
import { OFFICIALITY_INFERENCE } from '../src/external-identity/contracts.mjs';
import { consumeExternalIdentityEvidence } from '../src/external-identity/external-identity-engine-port.mjs';
import {
  createLocalMockRunnerRequest,
  REAL_PROVIDER_MODE,
} from '../src/external-identity/external-identity-runner-contracts.mjs';
import {
  computeKbfArtifactSha256,
  KBF_ENGINE_VERSION,
  KBF_SOURCE_COMMIT,
} from '../src/external-identity/kbf-offline-adapter.mjs';
import { startLocalKbfMockServer } from './runtime/external-identity/local-kbf-mock-server.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = resolve(projectRoot, 'tests', 'fixtures', 'external-identity');
const adaptiveSources = [
  'adaptive-identity-budget-contracts.mjs', 'adaptive-identity-test-planner.mjs',
  'adaptive-identity-runner-integration.mjs', 'identity-token-accounting.mjs',
].map((name) => resolve(projectRoot, 'src', 'external-identity', name));
let referenceArtifact;
let completeUsage;
let totalOnlyUsage;
let unknownUsage;
let nearLimitUsage;
let atLimitUsage;
let pricing;
let entitlement;
let requirement;
let cachedReference;
let integrated;
let integratedPlan;
let integratedBudget;

async function fixture(name) { return JSON.parse(await readFile(resolve(fixtures, name), 'utf8')); }
function planning(mode, budget, overrides = {}) {
  return planAdaptiveIdentityTest({
    mode, claimedModel: 'synthetic/starbench-local-mock', budget,
    referenceRequirement: requirement, cachedReference,
    authorization: { full_mode_selected: mode === 'FULL', forensic_authorized: mode === 'FORENSIC' },
    ...overrides,
  });
}

before(async () => {
  referenceArtifact = await readFile(resolve(fixtures, 'runner-kbf-reference-legacy.json'), 'utf8');
  completeUsage = await fixture('identity-usage-complete.json');
  totalOnlyUsage = await fixture('identity-usage-total-only.json');
  unknownUsage = await fixture('identity-usage-unknown.json');
  nearLimitUsage = await fixture('identity-usage-near-limit.json');
  atLimitUsage = await fixture('identity-usage-at-limit.json');
  pricing = await fixture('identity-pricing-resolved.json');
  entitlement = await fixture('identity-entitlement.json');
  requirement = { engine_id: 'KBF', engine_source_commit: KBF_SOURCE_COMMIT, engine_version: KBF_ENGINE_VERSION, probe_version: 'synthetic-probe-v1', model_claim: 'synthetic/reference-v1' };
  cachedReference = { ...requirement, artifact: referenceArtifact, artifact_sha256: computeKbfArtifactSha256(referenceArtifact), freshness_status: 'CURRENT', trust_level: 'TRUSTED_REFERENCE', provenance_status: 'VERIFIED' };
  integratedBudget = createIdentityTestBudget({ mode: 'QUICK', sourceClass: 'TEST_FIXTURE', syntheticTokenCeilings: { input: null, output: null, reasoning: null, total: 200 }, pricingSnapshotRef: pricing.snapshot_ref });
  integratedPlan = planning('QUICK', integratedBudget);
  const mock = await startLocalKbfMockServer({ behavior: 'insufficient' });
  try {
    const runnerRequest = createLocalMockRunnerRequest({ run_id: 'adaptive-budget-integration', endpoint_url: mock.endpointUrl, reference_artifact: referenceArtifact, expected_reference_sha256: computeKbfArtifactSha256(referenceArtifact), request_budget: 16 });
    integrated = await executeAdaptiveIdentityStage({ plan: integratedPlan, budget: integratedBudget, runnerRequest, usageArtifact: completeUsage, pricingSnapshot: pricing, modelClass: 'OTHER_API_MODEL' });
  } finally { await mock.close(); }
});

test('QUICK contract is minimum-necessary and token limits remain unmeasured', () => {
  const budget = createIdentityTestBudget({ mode: 'QUICK' });
  assert.equal(budget.mode, 'QUICK');
  assert.equal(budget.request_ceiling, 4);
  assert.equal(budget.evidence_target, 'SUFFICIENT_FOR_SCREENING');
  assert.equal(budget.token_ceiling.total.status, TOKEN_LIMIT_UNKNOWN);
  assert.equal(budget.token_ceiling.total.value, null);
});

test('STANDARD contract covers assessment without automatic FULL entry', () => {
  const budget = createIdentityTestBudget({ mode: 'STANDARD' });
  assert.equal(budget.request_ceiling, 8);
  assert.equal(budget.evidence_target, 'SUFFICIENT_FOR_STANDARD_ASSESSMENT');
  assert.equal(budget.automatic_escalation_allowed, false);
});

test('FULL contract requires explicit user selection', () => {
  assert.throws(() => createIdentityTestBudget({ mode: 'FULL' }), (error) => error.code === 'FULL_EXPLICIT_SELECTION_REQUIRED');
  const budget = createIdentityTestBudget({ mode: 'FULL', fullModeSelected: true });
  assert.equal(budget.approval_level, 'EXPLICIT_USER_SELECTION_REQUIRED');
  assert.equal(budget.request_ceiling, 16);
});

test('FORENSIC contract requires explicit authorization and stays contract-only', () => {
  assert.throws(() => createIdentityTestBudget({ mode: 'FORENSIC' }), (error) => error.code === 'FORENSIC_EXPLICIT_AUTHORIZATION_REQUIRED');
  const budget = createIdentityTestBudget({ mode: 'FORENSIC', forensicAuthorized: true });
  const plan = planning('FORENSIC', budget);
  assert.equal(plan.execution_mode, 'CONTRACT_ONLY');
  assert.equal(plan.stop_reason, 'FORENSIC_EXECUTION_NOT_IMPLEMENTED');
});

test('Mode and evidence sufficiency vocabularies are formally frozen', () => {
  assert.deepEqual(IDENTITY_TEST_MODES, ['QUICK', 'STANDARD', 'FULL', 'FORENSIC']);
  assert.deepEqual(EVIDENCE_SUFFICIENCY_STATES, ['INSUFFICIENT', 'SUFFICIENT_FOR_SCREENING', 'SUFFICIENT_FOR_STANDARD_ASSESSMENT', 'SUFFICIENT_FOR_FULL_ASSESSMENT']);
  assert.equal(ADAPTIVE_IDENTITY_TEST_PLANNER_VERSION, '0.1.0');
});

test('QUICK anomaly can only suggest STANDARD and never auto-escalates', () => {
  const budget = createIdentityTestBudget({ mode: 'QUICK' });
  const plan = planning('QUICK', budget, { previousStageOutcome: 'ANOMALY_DETECTED' });
  assert.deepEqual(plan.escalation, { status: 'SUGGEST_ESCALATION', suggested_mode: 'STANDARD', approval_required: 'USER_SELECT_STANDARD' });
  assert.equal(plan.selected_mode, 'QUICK');
  assert.equal(plan.automatic_escalation_allowed, false);
});

test('STANDARD can suggest FULL but cannot start it', () => {
  const budget = createIdentityTestBudget({ mode: 'STANDARD' });
  const plan = planning('STANDARD', budget, { previousStageOutcome: 'DEEPER_ASSESSMENT_SUGGESTED' });
  assert.equal(plan.escalation.suggested_mode, 'FULL');
  assert.equal(plan.escalation.approval_required, 'EXPLICIT_FULL_SELECTION');
  assert.equal(plan.selected_mode, 'STANDARD');
});

test('Planner independently rejects unauthorized FULL and FORENSIC', () => {
  const full = createIdentityTestBudget({ mode: 'FULL', fullModeSelected: true });
  const forensic = createIdentityTestBudget({ mode: 'FORENSIC', forensicAuthorized: true });
  assert.throws(() => planAdaptiveIdentityTest({ mode: 'FULL', claimedModel: 'x', budget: full, referenceRequirement: requirement }), (error) => error.code === 'FULL_EXPLICIT_SELECTION_REQUIRED');
  assert.throws(() => planAdaptiveIdentityTest({ mode: 'FORENSIC', claimedModel: 'x', budget: forensic, referenceRequirement: requirement }), (error) => error.code === 'FORENSIC_EXPLICIT_AUTHORIZATION_REQUIRED');
});

test('Selected mode request ceiling is passed down to the existing Runner', () => {
  assert.equal(integratedPlan.effective_request_ceiling, 4);
  assert.equal(integrated.effective_runner_request_budget, 4);
  assert.equal(integrated.runner_result.request_budget, 4);
  assert.equal(integrated.runner_result.request_count, 2);
});

test('Runner request ceiling can be reduced but never expanded by integration', () => {
  const input = createLocalMockRunnerRequest({ reference_artifact: referenceArtifact, expected_reference_sha256: computeKbfArtifactSha256(referenceArtifact), request_budget: 2 });
  const effective = applyAdaptiveBudgetToRunnerRequest({ plan: integratedPlan, budget: integratedBudget, runnerRequest: input });
  assert.equal(effective.request_budget, 2);
});

test('Request budget exhaustion stops with insufficient evidence', () => {
  const budget = createIdentityTestBudget({ mode: 'QUICK' });
  const plan = planning('QUICK', budget, { budgetState: { requests_used: 4, usage: null, monetary_assessment: null } });
  assert.equal(plan.must_stop, true);
  assert.equal(plan.stop_reason, 'STOP_BUDGET_EXHAUSTED');
  assert.equal(plan.evidence_sufficiency, 'INSUFFICIENT');
});

test('Synthetic token ceiling stops exactly at the fixture limit', () => {
  const budget = createIdentityTestBudget({ mode: 'QUICK', sourceClass: 'TEST_FIXTURE', syntheticTokenCeilings: { input: null, output: null, reasoning: null, total: 100 } });
  assert.equal(assessIdentityUsageAgainstBudget({ budget, usage: nearLimitUsage }).status, 'WITHIN_BUDGET');
  const exhausted = assessIdentityUsageAgainstBudget({ budget, usage: atLimitUsage });
  assert.equal(exhausted.status, 'STOP_BUDGET_EXHAUSTED');
  assert.ok(exhausted.violations.includes('TOKEN_TOTAL_BUDGET_EXHAUSTED'));
});

test('Unmeasured planning budget cannot accept fabricated token or money limits', () => {
  assert.throws(() => createIdentityTestBudget({ mode: 'QUICK', syntheticTokenCeilings: { input: null, output: null, reasoning: null, total: 100 } }), (error) => error.code === 'SYNTHETIC_BUDGET_LIMIT_NOT_ALLOWED');
});

test('Complete explicit usage retains every supplied token component', () => {
  const usage = normalizeIdentityTokenUsage(completeUsage);
  assert.equal(usage.status, 'COMPLETE');
  assert.deepEqual([usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.cached_input_tokens, usage.total_tokens], [60, 20, 10, 10, 90]);
});

test('Total-only usage never fabricates token decomposition', () => {
  const usage = normalizeIdentityTokenUsage(totalOnlyUsage);
  assert.equal(usage.status, 'TOTAL_ONLY');
  assert.deepEqual([usage.input_tokens, usage.output_tokens, usage.reasoning_tokens, usage.cached_input_tokens], [null, null, null, null]);
  assert.equal(usage.total_tokens, 90);
});

test('Missing usage remains explicitly UNKNOWN', () => {
  assert.equal(normalizeIdentityTokenUsage(null).status, 'UNKNOWN');
  assert.equal(normalizeIdentityTokenUsage(unknownUsage).status, 'UNKNOWN');
  assert.equal(normalizeIdentityTokenUsage(null).total_tokens, null);
});

test('Malformed usage fails closed', async () => {
  const malformed = await fixture('identity-usage-malformed.json');
  assert.throws(() => normalizeIdentityTokenUsage(malformed), (error) => error.code === 'IDENTITY_TOKEN_USAGE_MALFORMED');
  assert.throws(() => normalizeIdentityTokenUsage({ ...completeUsage, total_tokens: 91 }), (error) => error.code === 'IDENTITY_TOKEN_USAGE_MALFORMED');
});

test('Exact trusted cached reference is reusable', () => {
  assert.deepEqual(evaluateCachedReferenceReuse({ required: requirement, cached: cachedReference }), { status: 'REUSE_REFERENCE', reason: null, artifact_sha256: cachedReference.artifact_sha256 });
});

test('Stale cached reference is denied', () => {
  const result = evaluateCachedReferenceReuse({ required: requirement, cached: { ...cachedReference, freshness_status: 'STALE' } });
  assert.equal(result.reason, 'REFERENCE_CACHE_STALE');
});

test('Cached reference hash mismatch is denied', () => {
  const result = evaluateCachedReferenceReuse({ required: requirement, cached: { ...cachedReference, artifact_sha256: '0'.repeat(64) } });
  assert.equal(result.reason, 'REFERENCE_HASH_MISMATCH');
});

test('Current-mode evidence target causes an immediate early stop', () => {
  const budget = createIdentityTestBudget({ mode: 'QUICK' });
  const plan = planning('QUICK', budget, { currentEvidence: { sufficiency: 'SUFFICIENT_FOR_SCREENING', failure_signals: [], completed_families: ['IDENTITY_SCREENING'] } });
  assert.equal(plan.stop_reason, 'STOP_EVIDENCE_TARGET_REACHED');
});

test('Obvious failure stops later low-value tests', () => {
  const budget = createIdentityTestBudget({ mode: 'STANDARD' });
  const plan = planning('STANDARD', budget, { currentEvidence: { sufficiency: 'INSUFFICIENT', failure_signals: ['FORMAT_INCOMPATIBLE'], completed_families: [] } });
  assert.equal(plan.stop_reason, 'STOP_OBVIOUS_FAILURE:FORMAT_INCOMPATIBLE');
});

test('QUICK excludes long-context by policy', () => {
  assert.deepEqual(planProgressiveLongContext({ mode: 'QUICK' }), { status: 'DISABLED_FOR_QUICK', next_stage: null, stop_reason: 'QUICK_EXCLUDES_LONG_CONTEXT' });
  assert.equal(IDENTITY_MODE_POLICIES.QUICK.long_context_policy, 'DISABLED');
});

test('Progressive long-context stops after the first failed capability stage', () => {
  const stages = [{ stage_id: 'small', context_tokens: 1000 }, { stage_id: 'medium', context_tokens: 2000 }];
  assert.equal(planProgressiveLongContext({ mode: 'FULL', stages, completed: [] }).next_stage.stage_id, 'small');
  const stopped = planProgressiveLongContext({ mode: 'FULL', stages, completed: [{ stage_id: 'small', status: 'FAIL' }] });
  assert.equal(stopped.status, 'STOPPED');
  assert.equal(stopped.next_stage, null);
});

test('Valid 03 PricingSnapshot produces exact synthetic cost through existing consumer', () => {
  const cost = assessIdentityTestCost({ usage: completeUsage, pricingSnapshot: pricing, modelClass: 'OTHER_API_MODEL', calls: 2 });
  assert.equal(cost.status, 'CALCULATED');
  assert.equal(cost.currency, 'CNY');
  assert.match(cost.total_amount, /^\d+\.\d{12}$/u);
});

test('Missing PricingSnapshot withholds money while token accounting remains valid', () => {
  const cost = assessIdentityTestCost({ usage: completeUsage, pricingSnapshot: null, modelClass: 'OTHER_API_MODEL', calls: 2 });
  assert.deepEqual([cost.status, cost.reason, cost.total_amount], ['WITHHELD', 'PRICING_SNAPSHOT_REQUIRED', null]);
  assert.equal(normalizeIdentityTokenUsage(completeUsage).total_tokens, 90);
});

test('Total-only usage with pricing withholds cost instead of inventing components', () => {
  const cost = assessIdentityTestCost({ usage: totalOnlyUsage, pricingSnapshot: pricing, modelClass: 'OTHER_API_MODEL', calls: 2 });
  assert.deepEqual([cost.status, cost.reason, cost.total_amount], ['WITHHELD', 'TOKEN_COMPONENTS_REQUIRED', null]);
});

test('Subscription quota is assessed without API-price monetary conversion', () => {
  const cost = assessIdentityTestCost({ usage: completeUsage, entitlementSnapshot: entitlement, billingMode: 'SUBSCRIPTION_QUOTA', modelClass: 'SUBSCRIPTION_MODEL', calls: 2 });
  assert.equal(cost.status, 'SUFFICIENT');
  assert.equal(cost.monetary_cost, null);
  assert.equal(cost.subscription_api_price_conversion, false);
});

test('Synthetic monetary ceiling is machine-enforced only with calculated snapshot cost', () => {
  const cost = assessIdentityTestCost({ usage: completeUsage, pricingSnapshot: pricing, modelClass: 'OTHER_API_MODEL', calls: 2 });
  const budget = createIdentityTestBudget({ mode: 'QUICK', sourceClass: 'TEST_FIXTURE', syntheticTokenCeilings: { input: null, output: null, reasoning: null, total: null }, syntheticMonetaryCeiling: { amount: '0.1', currency: 'CNY' }, pricingSnapshotRef: pricing.snapshot_ref });
  const assessed = assessIdentityUsageAgainstBudget({ budget, usage: completeUsage, monetaryAssessment: cost });
  assert.equal(assessed.status, 'STOP_BUDGET_EXHAUSTED');
  assert.ok(assessed.violations.includes('MONETARY_BUDGET_EXHAUSTED'));
});

test('Existing Runner and existing Port are reused by the adaptive integration', () => {
  assert.equal(integrated.status, 'COMPLETED');
  assert.equal(integrated.runner_reused, true);
  assert.equal(integrated.port_reused, true);
  assert.equal(integrated.canonical_observation.normalized_verdict, 'INSUFFICIENT_EVIDENCE');
});

test('REAL_PROVIDER remains disabled', () => {
  assert.equal(REAL_PROVIDER_MODE, 'DISABLED');
  assert.throws(() => createLocalMockRunnerRequest({ execution_mode: 'REAL_PROVIDER' }), (error) => error.code === 'RUNNER_REAL_PROVIDER_MODE_DISABLED');
});

test('Adaptive implementation contains no Credential read or second process launcher', async () => {
  const source = (await Promise.all(adaptiveSources.map((path) => readFile(path, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /process\.env|node:child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|api[_-]?key|credential manager/iu);
  assert.match(source, /runExternalIdentityEngine/u);
  assert.match(source, /consumeExternalIdentityEvidence|port_reused/u);
});

test('SAME still maps only to consistency and never Official', async () => {
  const portReference = await readFile(resolve(fixtures, 'kbf-reference-legacy.json'), 'utf8');
  const target = await readFile(resolve(fixtures, 'kbf-legacy-same.json'), 'utf8');
  const observation = consumeExternalIdentityEvidence({ engineId: 'KBF', referenceArtifact: portReference, targetArtifact: target, expectedReferenceSha256: computeKbfArtifactSha256(portReference), expectedRawArtifactSha256: computeKbfArtifactSha256(target), engineSourceCommit: KBF_SOURCE_COMMIT });
  assert.equal(observation.normalized_verdict, 'CONSISTENT_WITH_REFERENCE');
  assert.equal(observation.officiality_inference, OFFICIALITY_INFERENCE);
  assert.equal(Object.hasOwn(observation, 'official'), false);
});
