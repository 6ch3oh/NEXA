import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { buildActualConstraintDiagnosis, assertValidActualConstraintDiagnosis } from '../src/token-intelligence/actual-constraint-diagnosis.mjs';
import { refineSessionCandidateRules } from '../src/token-intelligence/candidate-rule-refinement.mjs';
import { assertValidEstimatorExperiment, assertValidShadowForecastSeal } from '../src/token-intelligence/estimator-experiment.mjs';
import { assertValidForecastSeal } from '../src/token-intelligence/forecast-lifecycle.mjs';
import { parseNexaPlanMarkdown } from '../src/token-intelligence/nexa-plan-intake.mjs';
import { assertValidTokenDriver, assertValidTokenDriverLedger, TokenDriverLedgerStore, TOKEN_DRIVER_COMPONENT_TYPES } from '../src/token-intelligence/token-driver-ledger.mjs';

const root = resolve(import.meta.dirname, '..');
const read = async (path) => JSON.parse(await readFile(join(root, ...path.split('/')), 'utf8'));
const prodDir = 'reports/goal-g/pre-execution/production/forecast_run_22678e4b10d335b263e20efc5f905f377e1d632d1dfb3200aba7bfbcd5cb57b9';
const experimentId = 'experiment_87fa4759af891a812fbed89fefae94d5b50a0b7103fb2aba8bf0489aa0481619';

test('Goal F Closeout usage is added once as truthful project-scale evidence', async () => {
  const rows = (await readFile(join(root, 'data/historical-usage/historical-task-usage-seeds.jsonl'), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
  const found = rows.filter((row) => row.task_id === 'nexa-sb-goal-f-actual-closeout-001');
  assert.equal(found.length, 1); assert.equal(found[0].total_tokens, 106846); assert.equal(found[0].duration_seconds, 1770); assert.equal(found[0].result_status, 'PASS'); assert.equal(found[0].metadata.evidence_class, 'PROJECT_SCALE_ONLY'); assert.equal(found[0].metadata.retrospective_forecast_created, false);
  for (const key of ['provider','model','execution_role','billing_mode','input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','calls']) assert.equal(found[0][key], null);
});

test('Goal G Plan is the strict pre-execution authority', async () => {
  const parsed = parseNexaPlanMarkdown(await readFile(join(root, 'NEXA-SB-GOAL-G-PLAN.md'), 'utf8'));
  assert.equal(parsed.status, 'READY'); assert.equal(parsed.normalized_plan.fields.phases.length, 39);
});

test('Goal G dual estimator trial is presealed and awaiting Actual', async () => {
  const [experiment, production, shadow] = await Promise.all([read(`reports/goal-g/registry/${experimentId}.json`), read(`${prodDir}/forecast-seal.json`), read('reports/goal-g/pre-execution/shadow/shadow-forecast-seal.json')]);
  assertValidEstimatorExperiment(experiment); assertValidForecastSeal(production); assertValidShadowForecastSeal(shadow);
  assert.equal(experiment.experiment_status, 'SEALED_AWAITING_EXECUTION'); assert.equal(experiment.comparison_status, 'AWAITING_ACTUAL'); assert.equal(experiment.actual_receipt_id, null); assert.equal(production.metadata.actual_usage_receipt_id, null); assert.equal(shadow.metadata.actual_usage_receipt_id, null);
});

test('Goal G seals share Plan Brief history Snapshot and allocation inputs', async () => {
  const [production, shadow] = await Promise.all([read(`${prodDir}/forecast-seal.json`), read('reports/goal-g/pre-execution/shadow/shadow-forecast-seal.json')]);
  assert.equal(production.plan_identity, shadow.plan_identity); assert.equal(production.brief_identity, shadow.brief_identity); assert.deepEqual(production.historical_evidence_snapshot, shadow.historical_evidence_snapshot); assert.equal(production.historical_evidence_snapshot.length, 7); assert.ok(production.historical_evidence_snapshot.includes('usage_seed_c73795ae9d58de26d525771c538a9864a72ff4e1d192396464a894621f2a0174'));
});

test('Goal G sealed token paths remain exact', async () => {
  const [production, shadow] = await Promise.all([read(`${prodDir}/forecast-seal.json`), read('reports/goal-g/pre-execution/shadow/shadow-forecast-seal.json')]);
  assert.deepEqual([production.metadata.optimistic_tokens, production.metadata.expected_tokens, production.metadata.conservative_tokens], [909747, 930347, 998833]);
  assert.deepEqual([shadow.metadata.optimistic_tokens, shadow.metadata.expected_tokens, shadow.metadata.conservative_tokens], [367775, 376796, 410289]);
});

test('all Goal G Production and Shadow paths conserve Token exactly', async () => {
  for (const estimator of ['production','shadow-v1']) for (const path of ['optimistic','expected','conservative']) { const ledger = await read(`reports/goal-g/drivers/goal-g/${estimator}/${path}-ledger.json`); assertValidTokenDriverLedger(ledger); assert.equal(ledger.conservation.status, 'PASS'); assert.equal(ledger.conservation.delta_tokens, 0); }
});

test('Production expected Driver Ledger matches sealed Expected total', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-g/production/expected-ledger.json'); assert.equal(ledger.forecast_total_tokens, 930347); assert.equal(ledger.audit.total_work_units, 41); assert.equal(ledger.audit.total_model_calls, 121); assert.equal(ledger.audit.total_token_drivers, 1245);
});

test('Shadow expected Driver Ledger matches sealed Expected total and Session shape', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-g/shadow-v1/expected-ledger.json'); assert.equal(ledger.forecast_total_tokens, 376796); assert.equal(ledger.audit.total_work_units, 41); assert.equal(ledger.audit.total_sessions, 1); assert.equal(ledger.audit.total_model_calls, 82); assert.equal(ledger.provenance.shared_context_reused_is_non_additive, true);
});

test('four-layer trace covers every additive Driver exactly once', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-g/shadow-v1/expected-ledger.json'), refs = ledger.trace.flatMap((unit) => unit.sessions.flatMap((session) => session.calls.flatMap((call) => call.driver_refs)));
  assert.equal(refs.length, ledger.drivers.length); assert.equal(new Set(refs).size, ledger.drivers.length); assert.deepEqual(new Set(refs), new Set(ledger.drivers.map((driver) => driver.driver_id)));
});

test('Token Driver contract exposes every required component type', async () => {
  const schema = await read('schemas/token-driver-v0.1.schema.json'); assert.deepEqual(new Set(schema.properties.component_type.enum), new Set(TOKEN_DRIVER_COMPONENT_TYPES));
});

test('Token Driver content identity rejects tampering', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-g/production/expected-ledger.json'), driver = structuredClone(ledger.drivers[0]); assertValidTokenDriver(driver); driver.estimated_tokens += 1; assert.throws(() => assertValidTokenDriver(driver), { code: 'TOKEN_DRIVER_INVALID' });
});

test('Ledger validator rejects broken conservation', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-g/production/expected-ledger.json'); ledger.conservation.driver_total_tokens -= 1; assert.throws(() => assertValidTokenDriverLedger(ledger), { code: 'TOKEN_DRIVER_LEDGER_INVALID' });
});

test('Token Driver Store is create-once duplicate-safe and root-bounded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sb-goal-g-')); try { const ledger = await read('reports/goal-g/drivers/goal-g/production/expected-ledger.json'), store = new TokenDriverLedgerStore({ rootDir: dir, filePath: join(dir, 'ledger.json') }); assert.equal((await store.write(ledger)).status, 'WRITTEN'); assert.equal((await store.write(ledger)).status, 'DUPLICATE_SKIPPED'); assert.throws(() => new TokenDriverLedgerStore({ rootDir: dir, filePath: resolve(dir, '..', 'escape.json') }), { code: 'TOKEN_DRIVER_STORE_PATH_ESCAPE' }); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Actual Constraint Diagnosis leaves every Actual component UNKNOWN', async () => {
  const diagnosis = await read('reports/goal-g/drivers/goal-f/diagnosis/shadow-v1-expected.json'); assertValidActualConstraintDiagnosis(diagnosis); assert.equal(diagnosis.actual_component_status, 'UNKNOWN'); assert.deepEqual(new Set(Object.values(diagnosis.actual_component_values)), new Set([null])); assert.equal(diagnosis.metadata.actual_component_fabrication, 0);
});

test('component-impossible logic is an Actual upper-bound test only', async () => {
  const ledger = await read('reports/goal-g/drivers/goal-f/production/expected-ledger.json'), diagnosis = buildActualConstraintDiagnosis({ ledger, actual_total_tokens: 1, actual_source_ref: 'TEST_TOTAL_ONLY' }), finding = diagnosis.findings.find((item) => item.finding_type === 'COMPONENT_IMPOSSIBLE'); assert.equal(finding.status, 'SUPPORTED'); assert.ok(finding.evidence.length > 0); assert.deepEqual(new Set(Object.values(diagnosis.actual_component_values)), new Set([null]));
});

test('Goal F review call category is impossible against the whole Actual total', async () => {
  const diagnosis = await read('reports/goal-g/drivers/goal-f/diagnosis/shadow-v1-expected.json'), category = diagnosis.findings.find((item) => item.finding_type === 'CATEGORY_IMPOSSIBLE'), review = category.evidence.find((item) => item.category_type === 'CALL_PURPOSE' && item.category === 'review_or_acceptance'); assert.equal(category.status, 'SUPPORTED'); assert.equal(review.estimated_tokens, 195341); assert.equal(review.excess_over_actual, 10861);
});

test('Goal F Session and call-count pressure are supported without Actual decomposition', async () => {
  const diagnosis = await read('reports/goal-g/drivers/goal-f/diagnosis/shadow-v1-expected.json'); assert.equal(diagnosis.findings.find((item) => item.finding_type === 'SESSION_PRESSURE').status, 'SUPPORTED'); assert.equal(diagnosis.findings.find((item) => item.finding_type === 'CALL_COUNT_PRESSURE').status, 'SUPPORTED'); assert.equal(diagnosis.provenance.actual_call_breakdown_known, false);
});

test('Goal F 489433 reduction is conserved and structurally attributed', async () => {
  const attribution = await read('reports/goal-g/drivers/goal-f/attribution.json'); assert.equal(attribution.production_to_shadow_reduction_tokens, 489433); assert.equal(attribution.reduction_conserved, true); assert.equal(attribution.driver_changes.reduce((total, row) => total + row.reduction_tokens, 0), 489433); assert.equal(attribution.driver_changes[0].component_type, 'BASE_CONTEXT'); assert.equal(attribution.driver_changes[0].reduction_tokens, 315804);
});

test('Goal D repeats call pressure but warns against further blind reduction', async () => {
  const [attribution, diagnosis] = await Promise.all([read('reports/goal-g/drivers/goal-d/attribution.json'), read('reports/goal-g/drivers/goal-d/diagnosis/shadow-v1-expected.json')]); assert.equal(attribution.comparison_status, 'SHADOW_BETTER'); assert.equal(attribution.shadow_metrics.total_tokens, 263856); assert.ok(attribution.shadow_metrics.total_tokens < attribution.actual_tokens); assert.equal(diagnosis.findings.find((item) => item.finding_type === 'CALL_COUNT_PRESSURE').status, 'SUPPORTED');
});

test('Goal B remains a detected counterexample with total-only Production detail', async () => {
  const attribution = await read('reports/goal-g/drivers/goal-b/attribution.json'); assert.equal(attribution.production_detail_status, 'UNKNOWN_TOTAL_ONLY_AUTHORITY'); assert.equal(attribution.comparison_status, 'PRODUCTION_BETTER'); assert.equal(attribution.counterexample_retained, true); assert.equal(attribution.production_metrics.calls, null); assert.ok(attribution.counterexample_analysis.some((item) => item.factor === 'EXPLICIT_INDEPENDENT_CALLS' && item.status === 'PARTIAL'));
});

test('Overnight 002 retains total-only authority without fabricated Production components', async () => {
  const attribution = await read('reports/goal-g/drivers/overnight-002/attribution.json'); assert.equal(attribution.production_detail_status, 'UNKNOWN_TOTAL_ONLY_AUTHORITY'); assert.equal(attribution.production_metrics.context_tokens, null); assert.equal(attribution.production_structural_reference.status, 'NON_AUTHORITATIVE_RECONSTRUCTED_MODEL'); assert.equal(attribution.comparison_status, 'SHADOW_BETTER');
});

test('Candidate rules are narrowed and explicitly Shadow-validated after two prospective closeouts', async () => {
  const refinement = await read('reports/goal-g/rules/candidate-rule-refinement.json'); assert.equal(refinement.rules.length, 2); assert.ok(refinement.rules.every((rule) => rule.status === 'SHADOW_VALIDATED' && rule.numeric_multiplier === null && rule.production_effect === false)); assert.equal(refinement.evidence_assessment.long_continuous_goal_support, 'SUPPORTED'); assert.equal(refinement.evidence_assessment.reset_counter_trigger, 'SUPPORTED'); assert.equal(refinement.promotion_status, 'PROMOTE_TO_SHADOW_VALIDATED');
});

test('Shadow V2 remains unjustified and no hindsight replay is fabricated', async () => {
  const refinement = await read('reports/goal-g/rules/candidate-rule-refinement.json'); assert.equal(refinement.shadow_v2_decision, 'NOT_JUSTIFIED'); assert.equal(refinement.production_estimator_modified, false); assert.equal(refinement.fixed_multiplier, false); assert.equal(refinement.metadata.prospective_closed_dual_trials, 2); assert.equal(refinement.metadata.hindsight_shadow_v2_generation, false);
});

test('generic refinement detects evidence without Goal-specific branches', async () => {
  const registry = await read('reports/goal-e/rules/structural-rule-registry.json'), attributions = await Promise.all(['goal-b','overnight-002','goal-d','goal-f'].map((name) => read(`reports/goal-g/drivers/${name}/attribution.json`))), refinement = refineSessionCandidateRules({ registry, attributions }); assert.equal(refinement.shadow_v2_decision, 'NOT_JUSTIFIED'); assert.ok(refinement.rules.every((rule) => rule.metadata.goal_specific_rule === false));
});

test('Goal G contracts are present and Draft 2020-12 JSON Schemas', async () => {
  for (const name of ['token-driver-v0.1.schema.json','token-driver-ledger-v0.1.schema.json','actual-total-constraint-diagnosis-v0.1.schema.json','forecast-driver-attribution-v0.1.schema.json','candidate-rule-refinement-v0.1.schema.json']) assert.equal((await read(`schemas/${name}`)).$schema, 'https://json-schema.org/draft/2020-12/schema');
});

test('Goal G implementation contains no network Credential fixed multiplier or case branch', async () => {
  const source = (await Promise.all(['token-driver-ledger.mjs','actual-constraint-diagnosis.mjs','forecast-driver-attribution.mjs','candidate-rule-refinement.mjs','goal-g-cli.mjs'].map((name) => readFile(join(root, 'src/token-intelligence', name), 'utf8')))).join('\n'); assert.doesNotMatch(source, /fetch\s*\(|process\.env|Authorization|provider-adapter|Math\.random|Monte Carlo|numeric_multiplier\s*:\s*[-\d]|case_id\s*===|goal_id\s*===/iu);
});

test('Goal G Workbench commands remain on the existing CLI', async () => {
  const source = await readFile(join(root, 'scripts/starbench-workbench.mjs'), 'utf8'); assert.match(source, /forecast-drivers/u); assert.match(source, /constraint-diagnosis/u); assert.match(source, /rule-refinement/u); assert.doesNotMatch(source, /fetch\s*\(|process\.env|Authorization/iu);
});
