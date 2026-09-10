import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..');
const legacyRoot = 'source_import\\AMD_API_Test';
const manifestPath = resolve(projectRoot, 'legacy', 'legacy-benchmark-asset-manifest-v0.1.json');
const mappingPath = resolve(projectRoot, 'legacy', 'legacy-benchmark-mapping-v0.1.json');
const coveragePath = resolve(projectRoot, 'legacy', 'legacy-phase2-coverage-mapping-v0.1.json');

let networkRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { networkRequests += 1; throw new Error('NETWORK_FORBIDDEN'); };
after(() => { globalThis.fetch = originalFetch; });

async function text(filePath) { return readFile(filePath, 'utf8'); }
async function json(filePath) { return JSON.parse(await text(filePath)); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function promptId(value) { return `prompt_${sha256(Buffer.from(value.normalize('NFC').replace(/\r\n?/gu, '\n'), 'utf8'))}`; }

test('three Legacy intake artifacts parse with stable V0.1 identities', async () => {
  const manifest = await json(manifestPath);
  const mapping = await json(mappingPath);
  const coverage = await json(coveragePath);
  assert.equal(manifest.record_type, 'LEGACY_BENCHMARK_ASSET_MANIFEST');
  assert.equal(manifest.manifest_id, 'legacy-benchmark-asset-manifest-v0.1');
  assert.equal(mapping.record_type, 'LEGACY_BENCHMARK_MAPPING');
  assert.equal(mapping.mapping_id, 'legacy-benchmark-mapping-v0.1');
  assert.equal(coverage.record_type, 'LEGACY_PHASE2_COVERAGE_MAPPING');
  assert.equal(coverage.mapping_id, 'legacy-phase2-coverage-mapping-v0.1');
});

test('manifest covers exactly the three allowed Legacy Python files', async () => {
  const manifest = await json(manifestPath);
  assert.equal(manifest.assets.length, 3);
  assert.deepEqual(manifest.assets.map((asset) => asset.path).sort(), [
    `${legacyRoot}\\amd_benchmark.py`,
    `${legacyRoot}\\amd_test.py`,
    `${legacyRoot}\\deepseek_benchmark.py`,
  ]);
  assert.equal(manifest.source_root, legacyRoot);
  assert.equal(manifest.source_access, 'READ_ONLY');
});

test('manifest does not read or hash Credential-bearing Legacy source files', async () => {
  const manifest = await json(manifestPath);
  for (const asset of manifest.assets) {
    assert.equal(asset.content_digest_status, 'NOT_COMPUTED_CREDENTIAL_SAFETY');
    assert.equal(asset.mtime_status, 'NOT_AUTHORITY');
    assert.equal(Object.hasOwn(asset, 'sha256'), false);
    assert.equal(Object.hasOwn(asset, 'mtime'), false);
    assert.equal(asset.path.startsWith(`${legacyRoot}\\`), true);
  }
  assert.equal(manifest.source_location_status, 'MIGRATED_IN_REPOSITORY_READ_ONLY');
});

test('all Python assets are scripts with Prompt and Config but never RAW_RESULT', async () => {
  const manifest = await json(manifestPath);
  const allowed = new Set(['BENCHMARK_SCRIPT', 'RAW_RESULT', 'LEGACY_SUMMARY', 'PROMPT', 'CONFIG', 'REPORT', 'UNRELATED', 'UNKNOWN']);
  for (const asset of manifest.assets) {
    assert.equal(asset.classification.every((item) => allowed.has(item)), true);
    assert.ok(asset.classification.includes('BENCHMARK_SCRIPT'));
    assert.ok(asset.classification.includes('PROMPT'));
    assert.ok(asset.classification.includes('CONFIG'));
    assert.equal(asset.classification.includes('RAW_RESULT'), false);
    assert.equal(asset.contains_prompt, true);
    assert.equal(asset.contains_config, true);
    assert.equal(asset.contains_result, false);
  }
  assert.equal(manifest.raw_result_count, 0);
  assert.equal(manifest.classification_totals.RAW_RESULT, 0);
});

test('Credential presence is recorded only as a boolean and every source is DO_NOT_USE', async () => {
  const manifest = await json(manifestPath);
  assert.equal(manifest.assets.every((asset) => asset.contains_credential === true), true);
  assert.equal(manifest.assets.every((asset) => asset.credential_handling === 'DO_NOT_USE'), true);
  assert.equal(manifest.secret_output_count, 0);
  const output = [await text(manifestPath), await text(mappingPath), await text(coveragePath)].join('\n');
  assert.doesNotMatch(output, /\bsk-[A-Za-z0-9_-]{8,}\b|\bBearer\s+\S+|api[_-]?key\s*[:=]|authorization\s*:/iu);
});

test('three exact Legacy Benchmark Prompts have stable identities and remain unadapted', async () => {
  const prompts = (await json(mappingPath)).prompt_mapping;
  assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.equal(promptId(prompt.legacy_original), prompt.prompt_identity.prompt_id);
    assert.equal(prompt.prompt_identity.canonicalization, 'NFC_LF_UTF8_EXACT_LEGACY_STRING');
    assert.equal(prompt.canonical_adapted, null);
    assert.equal(prompt.provider_shared_same_prompt, true);
    assert.equal(prompt.intake_status, 'REUSE_DIRECT');
    assert.equal(prompt.canonical_task_status, 'ADAPT_REQUIRED');
  }
});

test('Legacy tasks map once each to planning, coding, and instruction_following', async () => {
  const mapping = await json(mappingPath);
  const benchmarkTasks = mapping.task_mapping.filter((item) => item.target_scenario !== null);
  assert.deepEqual(benchmarkTasks.map((item) => item.target_scenario).sort(), ['coding', 'instruction_following', 'planning']);
  assert.deepEqual(mapping.scenario_mapping.map((item) => item.scenario_id).sort(), ['coding', 'instruction_following', 'planning']);
  assert.equal(mapping.scenario_mapping.every((item) => item.registry_reference_source === 'TEST_FIXTURE'), true);
});

test('amd_test.py remains a connectivity smoke prompt and not Phase-2 evidence', async () => {
  const manifest = await json(manifestPath);
  const mapping = await json(mappingPath);
  const smokeAsset = manifest.assets.find((asset) => asset.asset_id === 'legacy.asset.amd-smoke-test-py');
  const smokeTask = mapping.task_mapping.find((item) => item.legacy_task_id === 'legacy.smoke.amd-self-introduction');
  assert.equal(smokeAsset.benchmark_role, 'CONNECTIVITY_SMOKE_TEST_NOT_PHASE2_EVIDENCE');
  assert.equal(smokeAsset.intake_status, 'ARCHIVE_ONLY');
  assert.equal(smokeTask.target_scenario, null);
  assert.equal(smokeTask.intake_status, 'ARCHIVE_ONLY');
});

test('Provider and Model identities remain distinct across AMD and DeepSeek Official', async () => {
  const mapping = await json(mappingPath);
  assert.deepEqual(mapping.provider_mapping.map((item) => item.provider_identity).sort(), ['amd-radeon-cloud', 'deepseek-official']);
  assert.equal(mapping.model_mapping.every((item) => item.merge_with_other_provider === false), true);
  assert.deepEqual(mapping.model_mapping.map((item) => item.candidate_identity).sort(), ['amd-radeon-cloud/DeepSeek-V4-Flash', 'deepseek-official/deepseek-v4-flash']);
  const amd = mapping.provider_mapping.find((item) => item.provider_identity === 'amd-radeon-cloud');
  assert.equal(amd.execution_status, 'HISTORICAL_ONLY_DO_NOT_EXECUTE');
  assert.equal(amd.current_adapter_status, 'MISSING');
});

test('Config intake preserves explicit values and leaves SDK defaults UNKNOWN', async () => {
  const configs = (await json(mappingPath)).config_mapping;
  assert.equal(configs.length, 3);
  for (const config of configs) {
    assert.ok(config.model);
    assert.ok(config.endpoint);
    assert.ok(config.messages);
    assert.equal(config.stream, 'UNKNOWN');
    assert.equal(config.temperature, 'UNKNOWN');
    assert.equal(config.max_tokens, 'UNKNOWN');
    assert.equal(config.timeout, 'UNKNOWN');
    assert.deepEqual(config.other_request_parameters, {});
    assert.equal(config.sdk, 'openai-python');
    assert.equal(config.api_style, 'client.chat.completions.create');
  }
});

test('Legacy latency, usage, and throughput methods map without invented TTFT or aggregation', async () => {
  const statistics = (await json(mappingPath)).statistics_mapping;
  const byName = Object.fromEntries(statistics.map((item) => [item.legacy_statistic, item]));
  assert.match(byName.latency.legacy_method, /time\.time/u);
  assert.equal(byName.latency.target_field, 'RAW_RESULT.latency_ms');
  assert.match(byName.prompt_tokens.legacy_method, /response\.usage\.prompt_tokens/u);
  assert.match(byName.completion_tokens.legacy_method, /response\.usage\.completion_tokens/u);
  assert.match(byName.total_tokens.legacy_method, /response\.usage\.total_tokens/u);
  assert.match(byName.throughput.legacy_method, /completion_tokens \/ \(end - start\)/u);
  assert.match(byName.throughput.target_provenance, /computed/u);
  assert.equal(byName.ttft.legacy_method, 'UNKNOWN');
  assert.equal(byName.ttft.intake_status, 'MISSING');
  for (const name of ['total_elapsed_aggregation', 'total_token_aggregation', 'weighted_or_aggregate_throughput']) assert.equal(byName[name].legacy_method, 'UNKNOWN_REPORT_ONLY');
});

test('report mapping reuses task, latency, usage, and throughput but marks comparison sections missing', async () => {
  const report = (await json(mappingPath)).report_mapping;
  assert.equal(report.physical_report_asset_count, 0);
  const byLegacy = Object.fromEntries(report.embedded_console_structure.map((item) => [item.legacy_section, item]));
  assert.equal(byLegacy['Task name'].intake_status, 'REUSE_DIRECT');
  assert.equal(byLegacy.Latency.intake_status, 'REUSE_WITH_ADAPTER');
  assert.equal(byLegacy['Prompt, completion, and total tokens'].intake_status, 'REUSE_DIRECT');
  assert.equal(byLegacy['Comparison, Summary, Conclusion'].intake_status, 'MISSING');
});

test('Phase-1 Fixtures are only SIMILAR engineering fixtures, never Legacy replacements', async () => {
  const relations = (await json(mappingPath)).fixture_relationship;
  assert.equal(relations.length, 3);
  assert.equal(relations.every((item) => item.relationship === 'SIMILAR'), true);
  assert.equal(relations.every((item) => item.fixture_status === 'FIXTURE_ONLY'), true);
  assert.equal(new Set(relations.map((item) => item.fixture_task_id)).size, 3);
});

test('historical report assertions remain LEGACY_SUMMARY and never become evidence', async () => {
  const summaries = (await json(mappingPath)).historical_summary_assertions;
  assert.equal(summaries.length, 2);
  assert.equal(summaries.every((item) => item.record_type === 'LEGACY_SUMMARY'), true);
  assert.equal(summaries.every((item) => item.source_level === 'TASK_SPEC_ASSERTION_NO_SOURCE_FILE'), true);
  assert.equal(summaries.every((item) => item.raw_result_count === 0), true);
  assert.equal(summaries.every((item) => item.eligible_for_evidence === false), true);
  assert.equal(summaries.every((item) => item.formula_provenance === 'REPORT_ONLY'), true);
});

test('Legacy-to-Phase-1 mapping preserves boundaries for scripts, summaries, and credentials', async () => {
  const items = (await json(mappingPath)).phase1_contract_mapping;
  const byAsset = Object.fromEntries(items.map((item) => [item.legacy_asset, item]));
  assert.equal(byAsset['Legacy Prompt and Task'].intake_status, 'ADAPT_REQUIRED');
  assert.match(byAsset['Legacy Prompt and Task'].mapping, /LEGACY_ORIGINAL/u);
  assert.match(byAsset['Legacy Prompt and Task'].mapping, /CANONICAL_ADAPTED/u);
  assert.equal(byAsset['Legacy Summary'].intake_status, 'ARCHIVE_ONLY');
  assert.match(byAsset['Legacy Summary'].mapping, /never import as RAW_RESULT/u);
  assert.equal(byAsset['Legacy Script'].intake_status, 'REFERENCE_ONLY');
  assert.equal(byAsset['Legacy Credential'].mapping, 'NONE / DO_NOT_USE');
});

test('SB-201 Evidence Contracts remain byte-for-byte unchanged', async () => {
  const coverage = await json(coveragePath);
  const refs = coverage.frozen_requirement_reference;
  const coverageContract = await readFile(resolve(projectRoot, refs.coverage_contract));
  const scenarioContract = await readFile(resolve(projectRoot, refs.scenario_requirement));
  assert.equal(sha256(coverageContract), refs.coverage_contract_sha256);
  assert.equal(sha256(scenarioContract), refs.scenario_requirement_sha256);
  assert.equal(refs.contract_changes, 'NONE');
  assert.equal(coverage.metadata.phase1_contract_changes, 'NONE');
  assert.equal(coverage.metadata.sb201_contract_changes, 'NONE');
});

test('each Scenario has one Legacy Anchor of three required tasks and two missing slots', async () => {
  const scenarios = (await json(coveragePath)).scenario_coverage;
  assert.deepEqual(scenarios.map((item) => item.scenario_id).sort(), ['coding', 'instruction_following', 'planning']);
  for (const scenario of scenarios) {
    assert.equal(scenario.required_task_count, 3);
    assert.equal(scenario.legacy_task_count, 1);
    assert.equal(scenario.current_formal_task_definition_count, 0);
    assert.equal(scenario.legacy_task_refs.length, 1);
    assert.equal(scenario.covered_heterogeneous_slots.length, 1);
    assert.equal(scenario.missing_task_slots, 2);
    assert.equal(scenario.missing_slot_names.length, 2);
    assert.equal(scenario.anchor_formalization_required, true);
    assert.equal(scenario.historical_raw_result_count, 0);
    assert.equal(scenario.eligible_real_observation_count, 0);
  }
});

test('Gap Matrix requires formalizing three Anchors plus only six complementary tasks', async () => {
  const gap = (await json(coveragePath)).gap_matrix;
  assert.equal(gap.required_distinct_task_definitions, 9);
  assert.equal(gap.legacy_anchor_tasks_available, 3);
  assert.equal(gap.current_formal_task_definitions_from_legacy, 0);
  assert.equal(gap.legacy_anchor_tasks_requiring_formalization, 3);
  assert.equal(gap.missing_complementary_task_slots, 6);
  assert.deepEqual(gap.missing_complementary_tasks_by_scenario, { planning: 2, coding: 2, instruction_following: 2 });
});

test('no historical RAW_RESULT or repeat run reduces the 36-observation gap', async () => {
  const coverage = await json(coveragePath);
  const gap = coverage.gap_matrix;
  assert.equal(gap.required_real_observations, 36);
  assert.equal(gap.eligible_historical_real_observations, 0);
  assert.equal(gap.missing_first_run_observations, 18);
  assert.equal(gap.missing_repeat_run_observations, 18);
  assert.equal(gap.missing_total_real_observations, 36);
  assert.equal(gap.historical_raw_result_count, 0);
  assert.equal(gap.historical_summary_promoted_to_raw_result, false);
  assert.equal(coverage.repeat_requirement.eligible_historical_repeat_run_count, 0);
  assert.equal(coverage.repeat_requirement.repeat_run_gap, 18);
});

test('Candidate coverage keeps AMD forbidden and the sealed DeepSeek activation out of capability evidence', async () => {
  const candidates = (await json(coveragePath)).candidate_coverage;
  const amd = candidates.find((item) => item.provider === 'amd-radeon-cloud');
  const deepseek = candidates.find((item) => item.provider === 'deepseek-official');
  assert.equal(amd.historical_raw_result_count, 0);
  assert.equal(amd.current_campaign_eligibility, 'NOT_ELIGIBLE_HISTORICAL_ONLY_DO_NOT_EXECUTE');
  assert.equal(deepseek.historical_raw_result_count, 0);
  assert.equal(deepseek.pipeline_activation_result_count, 1);
  assert.equal(deepseek.pipeline_activation_counts_as_capability, false);
  assert.equal(deepseek.phase2_capability_observation_count, 0);
  assert.equal(deepseek.current_campaign_eligibility, 'PROPOSABLE_NOT_AUTHORIZED_ONE_SHOT_ADAPTER_SEALED');
});

test('minimal completion strategy keeps all Legacy Anchors and forbids full redesign', async () => {
  const strategy = (await json(coveragePath)).minimal_completion_strategy;
  assert.equal(strategy.principle, 'LEGACY_ANCHOR_PLUS_MINIMAL_NEW_COMPLEMENTARY_TASKS');
  assert.equal(strategy.redesign_entire_benchmark, false);
  assert.equal(strategy.steps.some((item) => item.includes('two missing heterogeneous Task slots per Scenario')), true);
  assert.equal(strategy.steps.some((item) => item.includes('separate explicit Campaign authorization')), true);
});

test('Legacy mapping defines the route but grants no recommendation, ranking, or Campaign readiness', async () => {
  const current = (await json(coveragePath)).current_readiness;
  assert.equal(current.REAL_RECOMMENDATION_READY, false);
  assert.equal(current.REAL_MODEL_RANKING_READY, false);
  assert.equal(current.next_campaign_authorization, 'NOT_AUTHORIZED');
  assert.equal(current.legacy_to_phase2_route_defined, true);
});

test('Legacy intake tests and artifacts execute no network path', async () => {
  const artifacts = [await text(manifestPath), await text(mappingPath), await text(coveragePath)].join('\n');
  assert.doesNotMatch(artifacts, /\bfetch\s*\(|https?\.request\s*\(|client\.chat\.completions\.create\s*\(/iu);
  assert.equal((await json(mappingPath)).metadata.network_required, false);
  assert.equal((await json(coveragePath)).metadata.network_required, false);
  assert.equal((await json(mappingPath)).metadata.executes_legacy_script, false);
  assert.equal((await json(coveragePath)).metadata.executes_legacy_script, false);
  assert.equal(networkRequests, 0);
});
