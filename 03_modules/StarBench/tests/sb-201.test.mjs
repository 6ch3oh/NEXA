import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const coveragePath = resolve(projectRoot, 'contracts', 'phase2-benchmark-coverage-v0.1.json');
const evidencePath = resolve(projectRoot, 'contracts', 'scenario-evidence-requirement-v0.1.json');
const planPath = resolve(projectRoot, 'docs', 'PHASE2-REAL-BENCHMARK-PLAN.md');
const phase1ManifestPath = resolve(projectRoot, 'contracts', 'phase1-v0.1-manifest.json');
const activationSummaryPath = resolve(projectRoot, 'data', 'real-activation', 'activation-summary.json');

let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };
after(() => { globalThis.fetch = originalFetch; });

async function text(filePath) { return readFile(filePath, 'utf8'); }
async function json(filePath) { return JSON.parse(await text(filePath)); }

test('Phase-2 coverage and Scenario evidence contracts parse with stable identities', async () => {
  const coverage = await json(coveragePath);
  const evidence = await json(evidencePath);
  assert.equal(coverage.record_type, 'PHASE2_BENCHMARK_COVERAGE_CONTRACT');
  assert.equal(coverage.contract_id, 'phase2-benchmark-coverage-v0.1');
  assert.equal(evidence.record_type, 'SCENARIO_EVIDENCE_REQUIREMENT');
  assert.equal(evidence.contract_id, 'scenario-evidence-requirement-v0.1');
  assert.equal(coverage.status, 'PLANNED_NOT_AUTHORIZED');
  assert.equal(evidence.status, 'PLANNED_NOT_AUTHORIZED');
});

test('Real Benchmark Campaign V0.1 has an explicit non-authorized lifecycle and immutable snapshot', async () => {
  const campaign = (await json(coveragePath)).real_benchmark_campaign_v0_1;
  assert.equal(campaign.contract_version, '0.1');
  assert.equal(campaign.campaign_instance_required, true);
  assert.equal(campaign.execution_allowed_only_in_state, 'AUTHORIZED');
  assert.ok(campaign.lifecycle_states.includes('DRAFT'));
  assert.ok(campaign.lifecycle_states.includes('SEALED'));
  for (const field of ['campaign_id', 'candidate_provider_model_allowlist', 'scenario_allowlist', 'benchmark_task_identities', 'prompt_identities_and_versions', 'evaluation_methods', 'parameters', 'request_and_cost_budget', 'retry_and_stop_policy']) assert.ok(campaign.required_immutable_snapshot.includes(field));
  assert.equal(campaign.current_campaign.authorization_status, 'NOT_AUTHORIZED');
  assert.equal(campaign.current_campaign.execution_allowed, false);
});

test('Phase-1 manifest remains byte-for-byte frozen at the referenced digest', async () => {
  const manifestText = await text(phase1ManifestPath);
  const digest = createHash('sha256').update(manifestText).digest('hex');
  const coverage = await json(coveragePath);
  const manifest = JSON.parse(manifestText);
  assert.equal(digest, coverage.phase1_dependency.manifest_sha256);
  assert.equal(manifest.status, 'FROZEN');
  assert.equal(coverage.phase1_dependency.breaking_changes_allowed, false);
  assert.equal(coverage.metadata.phase1_contract_changes, 'NONE');
});

test('exactly the three Phase-2 Scenario categories are covered', async () => {
  const evidence = await json(evidencePath);
  assert.deepEqual(evidence.scenarios.map((item) => item.scenario).sort(), ['coding', 'instruction_following', 'planning']);
  assert.deepEqual(evidence.phase1_scenario_references.map((item) => item.scenario).sort(), ['coding', 'instruction_following', 'planning']);
  assert.equal(evidence.phase1_scenario_references.every((item) => item.existing_definition_source === 'TEST_FIXTURE' && item.promotion_to_real_definition === false), true);
});

test('every Scenario requires three diverse tasks, full coverage, three evidence items, and HIGH confidence', async () => {
  const evidence = await json(evidencePath);
  for (const scenario of evidence.scenarios) {
    assert.equal(scenario.minimum_tasks, 3);
    assert.equal(scenario.minimum_coverage, 1);
    assert.equal(scenario.minimum_evidence_count, 3);
    assert.equal(scenario.minimum_confidence, 'HIGH');
    assert.equal(scenario.required_task_diversity.length, 3);
    assert.equal(new Set(scenario.required_task_diversity).size, 3);
  }
});

test('minimum real Benchmark set contains nine distinct planned tasks', async () => {
  const evidence = await json(evidencePath);
  const taskKeys = evidence.scenarios.flatMap((scenario) => scenario.minimum_real_benchmark_set.map((item) => item.task_key));
  assert.equal(taskKeys.length, 9);
  assert.equal(new Set(taskKeys).size, 9);
  assert.equal(evidence.scenarios.every((scenario) => scenario.minimum_real_benchmark_set.length === scenario.minimum_tasks), true);
  assert.equal(evidence.scenarios.every((scenario) => scenario.minimum_real_benchmark_set.every((item) => item.definition_status === 'PLANNED_NOT_AUTHORED' && item.deterministic_evaluation.length > 0)), true);
});

test('required Metric types and scorers stay within Phase-1 V0.1 vocabularies', async () => {
  const evidence = await json(evidencePath);
  const metricTypes = new Set(['binary', 'numeric', 'categorical', 'manual']);
  const scorers = new Set(['exact_match', 'rule_based', 'numeric', 'manual']);
  for (const scenario of evidence.scenarios) {
    assert.equal(scenario.required_metric_types.every((item) => metricTypes.has(item)), true);
    assert.equal(scenario.required_scorers.every((item) => scorers.has(item)), true);
    assert.equal(scenario.required_metric_types.length > 0, true);
    assert.equal(scenario.required_scorers.length > 0, true);
  }
});

test('minimum-set rationale is tied to diversity, existing HIGH confidence, and bounded repetition', async () => {
  const rationale = (await json(evidencePath)).minimum_set_rationale;
  assert.match(rationale.why_three_tasks, /diversity/u);
  assert.match(rationale.why_three_tasks, /HIGH/u);
  assert.match(rationale.why_two_runs, /non-determinism|instability/u);
  assert.equal(rationale.minimum_distinct_tasks_total, 9);
  assert.equal(rationale.minimum_requests_for_one_scenario_comparison, 12);
  assert.equal(rationale.minimum_requests_for_all_three_scenarios, 36);
});

test('repeat requirement distinguishes preliminary single runs from recommendation evidence', async () => {
  const evidence = await json(evidencePath);
  const shared = evidence.shared_requirement;
  assert.equal(shared.runs_per_task_per_candidate, 2);
  assert.equal(shared.repeat_run_required_for_recommendation, true);
  assert.equal(shared.deterministic_single_run_use, 'PRELIMINARY_EVIDENCE_ONLY');
  assert.equal(evidence.scenarios.every((scenario) => scenario.repeat_run_required && scenario.runs_per_task === 2), true);
});

test('stability reporting retains variance, success rate, and latency variation', async () => {
  const stability = (await json(evidencePath)).repeat_and_stability;
  assert.match(stability.score_variance, /variance/u);
  assert.match(stability.success_rate, /all attempted runs/u);
  assert.match(stability.latency_variation, /median/u);
  assert.match(stability.latency_variation, /coefficient of variation/u);
  assert.equal(stability.outlier_policy, 'Do not remove successful latency observations in V0.1.');
});

test('PARTIAL and FAILED results are bounded, non-successful, and never fabricated as zero', async () => {
  const coverage = await json(coveragePath);
  const policy = coverage.partial_and_failure_policy;
  assert.equal(policy.maximum_combined_non_success_per_candidate_scenario, 1);
  assert.equal(policy.partial_counts_as_success, false);
  assert.equal(policy.failed_counts_as_success, false);
  assert.equal(policy.partial_or_failed_counts_in_reliability_denominator, true);
  assert.equal(policy.missing_observation_value, null);
  assert.equal(policy.fabricate_zero_for_missing, false);
  assert.equal(policy.over_limit_action, 'INSUFFICIENT_EVIDENCE');
});

test('each candidate needs six observations, five successes, and evidence on every required task', async () => {
  const evidence = await json(evidencePath);
  assert.equal(evidence.shared_requirement.minimum_provider_model_observations, 6);
  assert.equal(evidence.shared_requirement.minimum_successful_results_per_candidate, 5);
  assert.equal(evidence.shared_requirement.minimum_success_per_task, 1);
  assert.equal(evidence.shared_requirement.minimum_success_rate, 5 / 6);
  for (const scenario of evidence.scenarios) {
    assert.equal(scenario.minimum_provider_model_observations, 6);
    assert.equal(scenario.minimum_successful_results, 5);
  }
});

test('candidate identity remains provider plus model and never merges across Providers', async () => {
  const identity = (await json(coveragePath)).candidate_identity;
  assert.deepEqual(identity.identity_fields, ['provider', 'model']);
  assert.equal(identity.merge_same_model_across_providers, false);
});

test('candidate comparison requires paired tasks, prompts, methods, parameters, and run counts', async () => {
  const comparison = (await json(coveragePath)).candidate_comparison_requirement;
  for (const field of ['same_benchmark_task_identity', 'same_prompt_identity_and_version', 'same_evaluation_method', 'same_contract_version', 'same_required_metric_set', 'same_run_count_per_task', 'same_sampling_policy']) assert.equal(comparison[field], true);
  assert.deepEqual(comparison.same_parameters_required, ['temperature', 'thinking', 'stream']);
  assert.equal(comparison.max_tokens_policy, 'EQUAL_OR_PREDECLARED_EQUIVALENT');
  assert.equal(comparison.unbalanced_evidence_action, 'ABSTAINED');
  assert.equal(comparison.fixture_mixing_allowed, false);
});

test('a new provider/model candidate must independently earn matched real evidence before comparison', async () => {
  const entry = (await json(coveragePath)).new_candidate_entry_requirement;
  assert.deepEqual(entry.required_identity_fields, ['provider', 'model']);
  assert.equal(entry.provider_adapter_contract_review, 'PASS_REQUIRED');
  assert.equal(entry.phase1_intake_compatibility, 'V0_1_COMPATIBLE_REQUIRED');
  assert.equal(entry.same_campaign_snapshot_as_existing_candidates, true);
  assert.equal(entry.matched_task_prompt_and_run_surface_required, true);
  assert.equal(entry.fixture_backfill_allowed, false);
  assert.equal(entry.historical_unmatched_evidence_policy, 'OBSERVATION_ONLY_NOT_COMPARABLE');
  assert.match(entry.backfill_missing_comparable_evidence, /AUTHORIZED_REQUEST_BUDGET/u);
});

test('cost evidence separates observed spend, estimates, and UNKNOWN', async () => {
  const levels = (await json(coveragePath)).cost_evidence.levels;
  const bySource = Object.fromEntries(levels.map((item) => [item.source, item]));
  assert.equal(bySource.billing_export.classification, 'REAL_SPEND_VERIFIED');
  assert.equal(bySource.billing_export.formal_cost_comparison_allowed, true);
  assert.equal(bySource.provider_reported.classification, 'OBSERVED_PROVIDER_COST');
  assert.equal(bySource.provider_reported.formal_cost_comparison_allowed, true);
  assert.equal(bySource.locally_calculated_estimate.classification, 'ESTIMATE_ONLY');
  assert.equal(bySource.locally_calculated_estimate.formal_cost_comparison_allowed, false);
  assert.equal(bySource.official_price_estimate.classification, 'ESTIMATE_ONLY');
  assert.equal(bySource.unknown.classification, 'UNKNOWN');
});

test('UNKNOWN cost permits capability-only recommendation but forbids cheapest claims', async () => {
  const cost = (await json(coveragePath)).cost_evidence;
  assert.match(cost.unknown_cost_policy, /Capability-only recommendation is allowed/u);
  assert.match(cost.unknown_cost_policy, /cheapest-model and cost-efficiency claims are forbidden/u);
  assert.equal(cost.estimate_must_not_claim_real_spend, true);
});

test('latency requires five successful observations and uses median without silent outlier removal', async () => {
  const latency = (await json(coveragePath)).latency_evidence;
  assert.equal(latency.minimum_successful_observations_per_candidate_scenario, 5);
  assert.equal(latency.primary_statistic, 'median');
  for (const statistic of ['mean', 'min', 'max', 'interquartile_range', 'coefficient_of_variation']) assert.ok(latency.secondary_statistics.includes(statistic));
  assert.equal(latency.failed_or_timed_out_in_latency_distribution, false);
  assert.equal(latency.failed_or_timed_out_in_reliability_denominator, true);
  assert.equal(latency.successful_outlier_removal, 'FORBIDDEN_IN_V0_1');
});

test('REAL_RECOMMENDATION_READY requires two comparable candidates and complete real evidence', async () => {
  const gate = (await json(coveragePath)).recommendation_activation_requirement;
  assert.equal(gate.requires_all, true);
  assert.equal(gate.minimum_real_raw_results_per_candidate, 6);
  assert.equal(gate.minimum_real_raw_results_total, 12);
  assert.equal(gate.minimum_candidates, 2);
  assert.equal(gate.minimum_distinct_tasks_per_candidate, 3);
  assert.equal(gate.minimum_successful_results_per_candidate, 5);
  assert.equal(gate.minimum_coverage, 1);
  assert.equal(gate.minimum_evidence_count, 3);
  assert.equal(gate.minimum_confidence, 'HIGH');
  assert.equal(gate.required_provenance, 'COMPLETE');
  assert.equal(gate.required_secret_status, 'CLEAN');
  assert.equal(gate.test_fixture_allowed, false);
  assert.equal(gate.simple_positive_count_rule_forbidden, true);
  assert.equal(gate.recommendation_status_required, 'RECOMMENDED');
});

test('REAL_MODEL_RANKING_READY is strictly stronger and requires full three-Scenario parity', async () => {
  const ranking = (await json(coveragePath)).ranking_readiness_requirement;
  assert.equal(ranking.strictly_stronger_than_recommendation, true);
  assert.equal(ranking.minimum_scenarios, 3);
  assert.deepEqual(ranking.required_scenarios, ['coding', 'planning', 'instruction_following']);
  assert.equal(ranking.minimum_distinct_tasks_per_candidate, 9);
  assert.equal(ranking.minimum_real_raw_results_per_candidate, 18);
  assert.equal(ranking.minimum_real_raw_results_total, 36);
  assert.equal(ranking.every_scenario_must_meet_recommendation_evidence_gate, true);
  assert.equal(ranking.same_candidate_set_across_scenarios, true);
  assert.equal(ranking.current_ready, false);
});

test('abstain outcome meanings remain explicit and RECOMMENDED is evidence-gated', async () => {
  const rules = (await json(coveragePath)).abstain_rules;
  assert.match(rules.NO_ELIGIBLE_CANDIDATE, /hard constraint/u);
  assert.match(rules.INSUFFICIENT_EVIDENCE, /coverage/u);
  assert.match(rules.ABSTAINED, /incomparable/u);
  assert.match(rules.RECOMMENDED, /winner/u);
  assert.match(rules.RECOMMENDED, /evidence references/u);
});

test('budget contract expresses limits but grants no campaign authorization', async () => {
  const budget = (await json(coveragePath)).campaign_budget_contract;
  assert.equal(budget.budget_status, 'NOT_AUTHORIZED');
  assert.equal(budget.max_requests, null);
  assert.equal(budget.max_estimated_cost, null);
  assert.deepEqual(budget.allowed_models, []);
  assert.deepEqual(budget.allowed_providers, []);
  assert.deepEqual(budget.allowed_scenarios, []);
  assert.equal(budget.stop_on_first_failure, true);
  assert.equal(budget.retry_budget, 0);
  assert.equal(budget.authorization_effect, false);
});

test('activation Task remains pipeline-only evidence and the current real count cannot activate recommendation', async () => {
  const coverage = await json(coveragePath);
  const boundary = coverage.activation_task_boundary;
  const actual = await json(activationSummaryPath);
  assert.equal(boundary.benchmark_task_id, actual.benchmark_task_id);
  assert.equal(boundary.classification, 'PIPELINE_ACTIVATION_EVIDENCE');
  assert.equal(boundary.counts_toward_real_result_intake, true);
  assert.equal(boundary.counts_toward_scenario_capability_coverage, false);
  assert.equal(boundary.counts_toward_recommendation_evidence, false);
  assert.equal(boundary.counts_toward_ranking_evidence, false);
  assert.equal(actual.activation.real_raw_result_count, 1);
  assert.equal(actual.activation.REAL_RECOMMENDATION_READY, false);
});

test('minimum campaign arithmetic is internally consistent', async () => {
  const shape = (await json(coveragePath)).minimum_campaign_shape;
  assert.equal(shape.distinct_tasks_per_scenario * shape.runs_per_task_per_candidate, shape.requests_per_candidate_per_scenario);
  assert.equal(shape.requests_per_candidate_per_scenario * shape.minimum_candidates_for_comparison, shape.requests_per_scenario_comparison);
  assert.equal(shape.requests_per_candidate_per_scenario * shape.scenario_count, shape.requests_per_candidate_full_coverage);
  assert.equal(shape.requests_per_candidate_full_coverage * shape.minimum_candidates_for_comparison, shape.minimum_full_coverage_requests);
  assert.equal(shape.minimum_full_coverage_requests, 36);
});

test('execution order is staged, paired, and provides an early zero-network stop review', async () => {
  const stages = (await json(coveragePath)).phase2_execution_order;
  assert.deepEqual(stages.map((item) => item.stage), [0, 1, 2, 3, 4, 5]);
  assert.equal(stages.filter((item) => Number.isInteger(item.planned_requests)).reduce((sum, item) => sum + item.planned_requests, 0), 36);
  assert.match(stages[1].name, /paired/u);
  assert.equal(stages[2].planned_requests, 0);
  assert.ok(stages[2].stop_condition);
});

test('plan documents the core matrices, activation gate, ranking gate, budget, and execution order', async () => {
  const plan = await text(planPath);
  for (const heading of ['Benchmark coverage matrix', 'Evidence sufficiency matrix', 'Minimum real Benchmark set', 'Repeat and stability requirement', 'Candidate comparison rules', 'New candidate entry standard', 'Cost evidence', 'Latency evidence', 'REAL_RECOMMENDATION_READY conditions', 'REAL_MODEL_RANKING_READY conditions', 'Abstain rules', 'Benchmark budget contract', 'Activation task classification', 'Phase-2 execution order']) assert.match(plan, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(plan, /thirty-six observations/u);
  assert.match(plan, /NOT_AUTHORIZED/u);
});

test('Phase-2 planning assets contain no network execution path and tests make zero requests', async () => {
  const combined = [await text(coveragePath), await text(evidencePath), await text(planPath)].join('\n');
  assert.doesNotMatch(combined, /\bfetch\s*\(|https?\.request\s*\(|from ['"](?:axios|openai)['"]|api\.deepseek\.com|AMD_API_Test/iu);
  assert.equal((await json(coveragePath)).metadata.network_required, false);
  assert.equal((await json(evidencePath)).metadata.network_required, false);
  assert.equal(networkRequests, 0);
});
