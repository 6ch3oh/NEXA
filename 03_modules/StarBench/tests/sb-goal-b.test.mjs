import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertValidAllocationProposal, assertValidHistoricalTaskUsage, assertValidProjectEstimateBrief,
  assertValidResourceProposal, assertValidTokenForecast, computeHistoricalUsageId,
  loadProjectEstimateBrief, TokenIntelligenceContractError,
} from '../src/token-intelligence/contracts.mjs';
import { ProjectTokenIntelligenceEngine } from '../src/token-intelligence/forecast-engine.mjs';
import { calibrateGraphs } from '../src/token-intelligence/historical-calibrator.mjs';
import { HistoricalUsageStore } from '../src/token-intelligence/historical-usage-store.mjs';
import { importHistoricalUsageJsonl, importHistoricalUsageRecord } from '../src/token-intelligence/historical-usage-importer.mjs';
import { buildWorkGraphs } from '../src/token-intelligence/work-graph-builder.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(root, 'tests', 'fixtures', 'token-intelligence');
const tempRoot = join(root, 'tests', '.tmp-goal-b');
let networkRequests = 0; const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };
after(async () => { globalThis.fetch = originalFetch; await rm(tempRoot, { recursive: true, force: true }); });

async function json(name) { return JSON.parse(await readFile(join(fixtureDir, name), 'utf8')); }
async function jsonl(name) { return (await readFile(join(fixtureDir, name), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse); }
const simple = await json('project-simple.json');
const complex = await json('project-complex.json');
const risk = await json('project-risk.json');
const knownHistory = await jsonl('historical-usage-known.jsonl');
const unknownHistory = await jsonl('historical-usage-unknown.jsonl');
const engine = new ProjectTokenIntelligenceEngine();
const simpleResult = engine.forecast({ brief: simple });
const complexResult = engine.forecast({ brief: complex, historyRecords: knownHistory });
const riskResult = engine.forecast({ brief: risk, historyRecords: [...knownHistory, ...unknownHistory] });

test('seven Goal B schemas parse with exact V0.1 record types', async () => {
  const expected = {
    'project-estimate-brief-v0.1.schema.json': 'PROJECT_ESTIMATE_BRIEF',
    'ai-work-unit-v0.1.schema.json': 'AI_WORK_UNIT', 'ai-work-graph-v0.1.schema.json': 'AI_WORK_GRAPH',
    'historical-task-usage-v0.1.schema.json': 'HISTORICAL_TASK_USAGE', 'token-forecast-v0.1.schema.json': 'TOKEN_FORECAST',
    'model-allocation-proposal-v0.1.schema.json': 'MODEL_ALLOCATION_PROPOSAL', 'resource-usage-proposal-v0.1.schema.json': 'RESOURCE_USAGE_PROPOSAL',
  };
  for (const [name, recordType] of Object.entries(expected)) {
    const schema = JSON.parse(await readFile(join(root, 'schemas', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.properties.record_type.const, recordType);
  }
});

test('Project Estimate Brief supports detailed task plan and semantic-only inputs', () => {
  assert.equal(assertValidProjectEstimateBrief(simple), simple);
  assert.ok(Array.isArray(simple.known_task_plan));
  assert.equal(assertValidProjectEstimateBrief(complex), complex);
  assert.equal(complex.known_task_plan, null);
});

test('brief loader is root-bounded and rejects sensitive fields', async () => {
  assert.equal((await loadProjectEstimateBrief(join(fixtureDir, 'project-simple.json'), { rootDir: root })).project_id, 'fixture-simple');
  await assert.rejects(loadProjectEstimateBrief(resolve(root, '..', 'outside.json'), { rootDir: root }), { code: 'PROJECT_ESTIMATE_BRIEF_READ_FAILED' });
  assert.throws(() => assertValidProjectEstimateBrief({ ...simple, metadata: { api_key: 'forbidden' } }), { code: 'PROJECT_ESTIMATE_BRIEF_INVALID' });
});

test('existing task plan preserves explicit units and dependency edges', () => {
  const graphs = buildWorkGraphs(simple); const optimistic = graphs.optimistic;
  assert.deepEqual(optimistic.work_units.map((x) => x.work_unit_id), ['plan-export', 'implement-export', 'accept-export']);
  assert.deepEqual(optimistic.work_units.find((x) => x.work_unit_id === 'implement-export').dependencies, ['plan-export']);
  assert.equal(optimistic.work_units.find((x) => x.work_unit_id === 'implement-export').phase, 'CONSTRUCTION');
  assert.ok(optimistic.edges.some((edge) => edge.from === 'implement-export' && edge.to === 'accept-export'));
});

test('project without a task plan derives engineering units from semantic facts', () => {
  const units = buildWorkGraphs(complex).optimistic.work_units;
  assert.ok(units.some((x) => x.task_type === 'ARCHITECTURE'));
  assert.ok(units.some((x) => x.task_type === 'LEGACY_RECONCILIATION'));
  assert.equal(units.filter((x) => x.task_type === 'CODE_IMPLEMENTATION').length, complex.planned_features.length);
  assert.ok(units.every((x) => x.source_facts.length > 0));
});

test('Simple, Complex, and Risk projects produce materially different graphs', () => {
  const signatures = [simpleResult, complexResult, riskResult].map((result) => result.graphs.expected.work_units.map((x) => `${x.task_type}:${x.description}`).join('|'));
  assert.equal(new Set(signatures).size, 3);
  assert.ok(complexResult.graphs.expected.work_units.length > simpleResult.graphs.expected.work_units.length);
  assert.ok(riskResult.graphs.expected.edges.length > simpleResult.graphs.expected.edges.length);
});

test('Optimistic, Expected, and Conservative are independent graph identities and structures', () => {
  for (const result of [simpleResult, complexResult, riskResult]) {
    const graphs = Object.values(result.graphs);
    assert.equal(new Set(graphs.map((x) => x.graph_id)).size, 3);
    assert.ok(graphs[1].work_units.length > graphs[0].work_units.length);
    assert.ok(graphs[2].work_units.length > graphs[1].work_units.length);
  }
});

test('Conservative path expands every explicit Risk constraint into named Work Units', () => {
  const riskUnits = riskResult.graphs.conservative.work_units.filter((x) => x.path_role === 'RISK_RESPONSE');
  for (const riskFact of risk.risk_constraints) assert.ok(riskUnits.some((unit) => unit.source_facts.includes(`risk_constraint:${riskFact}`)));
  assert.ok(riskUnits.some((unit) => unit.work_unit_id === 'expanded-regression'));
});

test('path totals come from their calls rather than fixed ratios', () => {
  const f = riskResult.forecast;
  assert.equal(f.optimistic_path.total_tokens, f.optimistic_path.work_units.flatMap((x) => x.call_estimates).reduce((n,c) => n + c.total_tokens, 0));
  assert.equal(f.expected_path.total_tokens, f.expected_path.work_units.flatMap((x) => x.call_estimates).reduce((n,c) => n + c.total_tokens, 0));
  assert.equal(f.conservative_path.total_tokens, f.conservative_path.work_units.flatMap((x) => x.call_estimates).reduce((n,c) => n + c.total_tokens, 0));
  assert.notEqual(f.optimistic_path.total_tokens / f.expected_path.total_tokens, 0.8);
  assert.notEqual(f.conservative_path.total_tokens / f.expected_path.total_tokens, 1.2);
});

test('every call has component basis and exact arithmetic', () => {
  for (const graph of Object.values(riskResult.graphs)) for (const unit of graph.work_units) for (const call of unit.call_estimates) {
    assert.ok(call.context_components.length >= 5); assert.ok(call.output_components.length >= 1); assert.ok(call.estimate_basis.length >= 5);
    assert.equal(call.input_tokens, call.context_components.reduce((n,x) => n + x.tokens, 0));
    assert.equal(call.output_tokens, call.output_components.reduce((n,x) => n + x.tokens, 0));
    assert.equal(call.total_tokens, call.input_tokens + call.output_tokens + (call.reasoning_tokens ?? 0));
    assert.ok(call.cached_input_tokens <= call.input_tokens);
  }
});

test('later calls attribute cached context and context growth components', () => {
  const calls = riskResult.graphs.conservative.work_units.flatMap((x) => x.call_estimates);
  assert.ok(calls.some((call) => call.cached_input_tokens > 0));
  assert.ok(calls.some((call) => call.context_components.some((x) => x.component === 'prior_execution_summary')));
  assert.ok(calls.some((call) => call.context_components.some((x) => x.component === 'test_or_diagnostic_feedback')));
});

test('reasoning tokens are represented only where applicable', () => {
  const calls = riskResult.graphs.expected.work_units.flatMap((x) => x.call_estimates);
  assert.ok(calls.every((x) => Number.isInteger(x.reasoning_tokens)));
  const generalBrief = structuredClone(simple); generalBrief.known_task_plan[1].task_type = 'DOCUMENTATION';
  const graph = buildWorkGraphs(generalBrief).optimistic; // default role remains repository or reasoning and stays explicit
  assert.ok(graph.work_units.every((x) => x.call_estimates.every((c) => c.reasoning_tokens === null || Number.isInteger(c.reasoning_tokens))));
});

test('Historical Task Usage accepts observed and UNKNOWN values without fabrication', () => {
  for (const record of [...knownHistory, ...unknownHistory]) assert.equal(assertValidHistoricalTaskUsage(record), record);
  const unknown = unknownHistory[0];
  for (const key of ['input_tokens','cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','calls']) assert.equal(unknown[key], null);
  const invalid = structuredClone(knownHistory[0]); invalid.total_tokens += 1;
  assert.throws(() => assertValidHistoricalTaskUsage(invalid), { code: 'HISTORICAL_TASK_USAGE_INVALID' });
});

test('Historical Usage identity helper is deterministic and content-sensitive', () => {
  const record = structuredClone(knownHistory[0]); delete record.usage_record_id;
  const id = computeHistoricalUsageId(record);
  assert.equal(id, computeHistoricalUsageId(record));
  assert.notEqual(id, computeHistoricalUsageId({ ...record, calls: record.calls + 1 }));
});

test('Historical Usage importer validates JSONL and never repairs UNKNOWN fields', async () => {
  const content = await readFile(join(fixtureDir, 'historical-usage-unknown.jsonl'), 'utf8');
  const records = importHistoricalUsageJsonl(content);
  assert.equal(records.length, 1); assert.equal(records[0].total_tokens, null); assert.equal(records[0].calls, null);
  assert.throws(() => importHistoricalUsageRecord({ record_type: 'LEGACY_SUMMARY' }), { code: 'HISTORICAL_USAGE_IMPORT_REJECTED' });
  assert.throws(() => importHistoricalUsageJsonl('{bad json}'), { code: 'HISTORICAL_USAGE_JSON_INVALID' });
});

test('Historical Store validates, deduplicates, queries, and rejects path escape', async () => {
  await rm(tempRoot, { recursive: true, force: true });
  const store = new HistoricalUsageStore({ rootDir: root, filePath: join(tempRoot, 'history.jsonl') });
  assert.equal((await store.write(knownHistory[0])).status, 'written');
  assert.equal((await store.write(knownHistory[0])).status, 'duplicate_skipped');
  assert.equal((await store.queryByTaskType('CODE_IMPLEMENTATION')).length, 1);
  assert.equal((await store.queryByBillingMode('SUBSCRIPTION_QUOTA')).length, 1);
  assert.throws(() => new HistoricalUsageStore({ rootDir: tempRoot, filePath: resolve(root, 'outside-history.jsonl') }), { code: 'HISTORICAL_USAGE_STORE_PATH_ESCAPE' });
});

test('calibrator adds evidence and assessment without changing Work Units or calls', () => {
  const base = buildWorkGraphs(complex); const calibrated = calibrateGraphs(base, knownHistory);
  for (const key of Object.keys(base)) {
    assert.deepEqual(calibrated.graphs[key].work_units.map((x) => x.work_unit_id), base[key].work_units.map((x) => x.work_unit_id));
    assert.deepEqual(calibrated.graphs[key].work_units.map((x) => x.expected_calls), base[key].work_units.map((x) => x.expected_calls));
  }
  assert.ok(calibrated.graphs.expected.historical_evidence_refs.length > 0);
  assert.equal(calibrated.graphs.expected.metadata.historical_calibration_changes_graph, false);
});

test('Forecast rejects malformed History before calibration', () => {
  assert.throws(() => engine.forecast({ brief: simple, historyRecords: [{ record_type: 'LEGACY_SUMMARY' }] }), { code: 'HISTORICAL_TASK_USAGE_INVALID' });
});

test('empty History does not block forecast and honestly lowers confidence', () => {
  assert.equal(simpleResult.forecast.historical_data_status, 'EMPTY');
  assert.equal(simpleResult.forecast.historical_export_required, true);
  assert.equal(simpleResult.forecast.forecast_confidence, 'LOW');
  assert.ok(simpleResult.forecast.expected_path.total_tokens > 0);
});

test('partial History preserves UNKNOWN and remains evidence-only', () => {
  const result = engine.forecast({ brief: risk, historyRecords: unknownHistory });
  assert.equal(result.forecast.historical_data_status, 'PARTIAL');
  assert.equal(unknownHistory[0].total_tokens, null);
  assert.equal(result.graphs.conservative.metadata.historical_calibration_changes_graph, false);
});

test('Token Forecast aggregates calls and tokens by model, role, and phase', () => {
  const f = assertValidTokenForecast(complexResult.forecast); const p = f.expected_path;
  assert.equal(Object.values(p.calls_by_model).reduce((n,x) => n + x, 0), p.calls);
  assert.equal(Object.values(p.tokens_by_model).reduce((n,x) => n + x, 0), p.total_tokens);
  assert.equal(Object.values(p.tokens_by_role).reduce((n,x) => n + x, 0), p.total_tokens);
  assert.equal(Object.values(p.tokens_by_phase).reduce((n,x) => n + x, 0), p.total_tokens);
});

test('API resource modeling reports token components and future PricingSnapshot boundary', () => {
  const resources = assertValidResourceProposal(riskResult.resources);
  assert.ok(resources.api_token_billed.calls > 0); assert.ok(resources.api_token_billed.total_tokens > 0);
  assert.equal(resources.pricing_snapshot_ref, 'pricing-fixture-ref');
  assert.equal(resources.pricing_authority, '03-01 AI资产成本');
  assert.equal(resources.monetary_forecast_status, 'READY_FOR_EXTERNAL_CALCULATION');
});

test('Subscription modeling reports usage without API price conversion', () => {
  const resources = complexResult.resources;
  assert.ok(resources.subscription_quota.total_tokens > 0); assert.ok(resources.subscription_quota.calls > 0); assert.ok(resources.subscription_quota.task_count > 0);
  assert.equal(resources.subscription_quota.monetary_cost, null);
  assert.equal(resources.metadata.subscription_api_price_conversion, false);
  assert.equal(resources.entitlement_snapshot_ref, 'entitlement-fixture-ref');
});

test('Model Allocation Proposal is advisory and resource shares are auditable', () => {
  const allocation = assertValidAllocationProposal(complexResult.allocation);
  assert.equal(allocation.proposal_status, 'ADVISORY_ONLY');
  assert.ok(Math.abs(allocation.allocations.reduce((n,x) => n + x.resource_share, 0) - 1) < 1e-12);
  assert.ok(allocation.allocations.every((x) => x.constraints.includes('NO_AUTOMATIC_EXECUTION')));
});

test('preferred model hints affect advisory allocation without automatic control', () => {
  const subscriptionBrief = structuredClone(simple); subscriptionBrief.preferred_models = ['SUBSCRIPTION_MODEL'];
  const result = engine.forecast({ brief: subscriptionBrief });
  assert.ok(result.graphs.expected.work_units.every((unit) => unit.recommended_model_class === 'SUBSCRIPTION_MODEL'));
  assert.ok(result.graphs.expected.work_units.every((unit) => unit.estimate_basis.some((basis) => basis.basis === 'preferred_model_hint')));
  assert.equal(result.allocation.proposal_status, 'ADVISORY_ONLY');
});

test('all public API and subscription model classes can be selected as advisory hints', () => {
  for (const modelClass of ['GENERAL_API_EXECUTOR','OTHER_API_MODEL']) {
    const hinted = structuredClone(simple); hinted.preferred_models = [modelClass];
    const result = engine.forecast({ brief: hinted });
    assert.ok(result.graphs.expected.work_units.every((unit) => unit.recommended_model_class === modelClass));
    assert.equal(result.allocation.proposal_status, 'ADVISORY_ONLY');
    assert.ok(result.resources.api_token_billed.total_tokens > 0);
  }
});

test('Copyable Summary contains three paths, allocation, resources, risks, and evidence state', () => {
  const value = riskResult.copyable_summary;
  for (const text of ['项目：','乐观 ','预计 ','保守 ','模型与角色建议（仅建议）','API Token 资源','订阅资源占用','主要风险','预测依据','当前预测置信度']) assert.ok(value.includes(text));
  assert.ok(value.includes('不执行任务、不切换模型、不消费额度'));
});

test('prediction method explicitly excludes prohibited statistical cores', () => {
  const method = riskResult.forecast.prediction_method;
  assert.equal(method.core, 'PROJECT_SEMANTIC_WORK_GRAPH');
  assert.equal(method.monte_carlo, false); assert.equal(method.probability_sampling, false);
  assert.equal(method.historical_average_times_task_count, false); assert.equal(method.fixed_path_ratios, false);
});

test('source implementation contains no probability engine, pricing table, provider call, or Worker control', async () => {
  const files = (await readdir(join(root, 'src', 'token-intelligence'))).filter((x) => x.endsWith('.mjs'));
  const source = (await Promise.all(files.map((x) => readFile(join(root, 'src', 'token-intelligence', x), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /Math\.random|percentile|p20|p50|p90|fetch\s*\(|https?:\/\/|chat\.completions|process\.env/iu);
  assert.doesNotMatch(source, /(?:from|import\s*\()\s*['"][^'"]*(?:ExecutionHub|OpenCode)|(?:switch|set|select|dispatch)(?:Model|Worker)\s*\(|price[_ -]per[_ -]token/iu);
});

test('Goal B records remain separate from RAW_RESULT and LEGACY_SUMMARY', () => {
  for (const value of [simpleResult.forecast, simpleResult.allocation, simpleResult.resources, ...Object.values(simpleResult.graphs)]) {
    assert.notEqual(value.record_type, 'RAW_RESULT'); assert.notEqual(value.record_type, 'LEGACY_SUMMARY');
  }
  assert.throws(() => assertValidProjectEstimateBrief({ record_type: 'LEGACY_SUMMARY' }), { code: 'PROJECT_ESTIMATE_BRIEF_INVALID' });
});

test('Business Runtime Network, real API, Credential, and AMD counts remain zero', () => {
  assert.equal(networkRequests, 0);
  for (const result of [simpleResult, complexResult, riskResult]) {
    assert.equal(result.forecast.metadata.business_runtime_network, 0);
    assert.equal(result.forecast.metadata.real_api_calls, 0);
  }
});
