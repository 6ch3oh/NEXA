import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { stableSha256 } from '../src/token-intelligence/contracts.mjs';
import { validateForecastSeal } from '../src/token-intelligence/forecast-lifecycle.mjs';
import { assertValidShadowForecastSeal, assertValidEstimatorExperiment } from '../src/token-intelligence/estimator-experiment.mjs';

const root = resolve(import.meta.dirname, '..');
const base = join(root, 'reports', 'external-prospective-validation', 'NEXA-CORE-TODAY-TOMORROW-HOST-001');
const read = path => readFile(join(base, ...path.split('/')), 'utf8').then(JSON.parse);
const sha256 = value => createHash('sha256').update(value).digest('hex').toUpperCase();

async function production(name) {
  const parent = join(base, 'production');
  const directory = (await readdir(parent, { withFileTypes: true })).find(entry => entry.isDirectory() && entry.name.startsWith('forecast_run_'));
  assert.ok(directory, 'sealed Production Forecast directory must exist');
  return readFile(join(parent, directory.name, name), 'utf8').then(JSON.parse);
}

test('external frozen Plan reference is exact and no Actual entered before Seal', async () => {
  const value = await read('input/frozen-plan-reference.json');
  assert.equal(value.plan_frozen, true);
  assert.equal(value.task_contract_frozen, true);
  assert.equal(value.plan_sha256.toUpperCase(), '4C58F04EF24728D273427DF0EB50F4BB62BC5BE8A7EA8F69116109044E4729CE');
  assert.equal(value.formal_goal_started, false);
  assert.equal(value.actual_read_before_seal, 0);
});

test('Production Forecast and Seal preserve the frozen triple', async () => {
  const forecast = await production('forecast.json');
  const seal = await production('forecast-seal.json');
  assert.equal(validateForecastSeal(seal).valid, true);
  assert.equal(forecast.forecast_id, seal.forecast_id);
  assert.deepEqual([seal.metadata.optimistic_tokens, seal.metadata.expected_tokens, seal.metadata.conservative_tokens], [628835, 711603, 2812292]);
  assert.equal(seal.metadata.forecast_confidence, 'LOW');
  assert.equal(seal.provenance.forecast_input_contains_actual, false);
});

test('Shadow V1 Forecast and Seal preserve the independent triple', async () => {
  const forecast = await read('shadow/shadow-forecast.json');
  const seal = await read('shadow/shadow-forecast-seal.json');
  assertValidShadowForecastSeal(seal);
  assert.equal(forecast.shadow_forecast_id, seal.shadow_forecast_id);
  assert.deepEqual([seal.metadata.optimistic_tokens, seal.metadata.expected_tokens, seal.metadata.conservative_tokens], [215661, 241130, 1073779]);
  assert.equal(forecast.provenance.same_input_as_production, true);
  assert.equal(forecast.metadata.fixed_multiplier, false);
  assert.equal(forecast.metadata.goal_specific_rule, false);
});

test('Applicability Gate deterministically prefers Production from semantic counter-triggers', async () => {
  const audit = await read('gate/applicability-decision-audit.json');
  assert.equal(audit.decision.status, 'PRODUCTION_PREFERRED');
  assert.equal(audit.decision.selected_estimator, 'PRODUCTION');
  assert.deepEqual(audit.matched_counter_triggers, ['PRODUCTION_MINIMUM_EXECUTION_SESSIONS', 'PRODUCTION_LOW_ROLE_MODEL_CONTINUITY']);
  assert.equal(audit.audit.features.execution_session_count, 6);
  assert.equal(audit.audit.features.role_model_continuity_ratio, 0.615385);
  assert.equal(audit.actual_read_before_seal, 0);
  assert.equal(audit.decision.input_boundary.goal_identity_received, false);
});

test('formal recommendation reuses candidates unchanged and authorizes no routing', async () => {
  const value = await read('recommendation/formal-recommendation.json');
  assert.equal(value.recommended_estimator, 'PRODUCTION');
  assert.deepEqual(value.selected_forecast, { optimistic: 628835, expected: 711603, conservative: 2812292 });
  assert.equal(value.same_input_basis, true);
  assert.equal(value.automatic_routing_authorized, false);
  assert.equal(value.production_estimator_modified, false);
  assert.equal(value.shadow_v1_modified, false);
  assert.equal(value.goal_id_special_case, false);
  assert.equal(value.fixed_multiplier, false);
  assert.equal(value.actual_used, false);
});

test('Forecast scope covers exactly the future single /goal and excludes this phase', async () => {
  const value = await read('scope/forecast-scope.json');
  assert.equal(value.forecast_phase_usage, 'OUT_OF_SCOPE');
  assert.equal(value.single_goal_boundary, true);
  assert.equal(value.actual_scope_match_required_for_future_closeout, true);
  assert.match(value.scope_start, /single formal \/goal/u);
  assert.match(value.scope_end, /same single \/goal/u);
  assert.ok(value.excluded.includes('Production Forecast and Seal'));
});

test('Historical and resource snapshots are frozen and degrade truthfully', async () => {
  const history = await read('input/historical-usage-snapshot.json');
  const resource = await read('input/resource-snapshot.json');
  assert.equal(history.frozen_before_execution, true);
  assert.equal(history.actual_for_target_goal_present, false);
  assert.equal(history.records_admitted_to_production_estimator, 0);
  assert.equal(resource.same_input_for_production_and_shadow, true);
  assert.equal(resource.pricing.status, 'PRICING_SNAPSHOT_REQUIRED');
  assert.equal(resource.entitlement.status, 'ENTITLEMENT_SNAPSHOT_REQUIRED');
});

test('prospective experiment remains sealed and awaiting the future external execution', async () => {
  const experiment = await read('records/prospective-estimator-experiment.json');
  assertValidEstimatorExperiment(experiment);
  assert.equal(experiment.experiment_status, 'SEALED_AWAITING_EXECUTION');
  assert.equal(experiment.actual_receipt_id, null);
  assert.equal(experiment.execution_started_at, null);
  assert.equal(experiment.provenance.same_plan, true);
});

test('overall Seal identity and every governed artifact hash reconcile', async () => {
  const seal = await read('seal/external-prospective-validation-seal.json');
  const expected = stableSha256({ ...seal, seal_id: undefined, seal_hash: undefined });
  assert.equal(seal.seal_hash, expected);
  assert.equal(seal.seal_id, `external_prospective_seal_${expected}`);
  assert.equal(seal.status, 'SEALED_AWAITING_EXTERNAL_GOAL_EXECUTION');
  assert.equal(seal.artifact_hashes.canonical_brief, stableSha256(await read('input/canonical-project-estimate-brief.json')));
  assert.equal(seal.artifact_hashes.gate_decision_seal, stableSha256(await read('gate/gate-decision-seal.json')));
  assert.equal(seal.artifact_hashes.formal_recommendation_seal, stableSha256(await read('recommendation/formal-recommendation-seal.json')));
  assert.equal(seal.integrity.actual_read_before_seal, 0);
  assert.equal(seal.integrity.real_api_calls, 0);
  assert.equal(seal.integrity.business_runtime_network, 0);
});

test('Production, Shadow V1, and Gate source authorities were not modified', async () => {
  const expected = new Map([
    ['forecast-engine.mjs', '4B8C256DCAF1E1B52743AE152EA136542E7B9C0F78B2CB3361E82F836723316E'],
    ['session-aware-forecast.mjs', 'F32F076263A5B2D230BC6D67DA8684132FAB7BA6ED933F4CBB353E35243205BF'],
    ['estimator-applicability.mjs', 'F24CC6D995B2785FE5837520C9453F753477AD84F22E2D62A70BF479A503ED61']
  ]);
  for (const [name, hash] of expected) {
    const content = await readFile(join(root, 'src', 'token-intelligence', name));
    assert.equal(sha256(content), hash);
  }
});
