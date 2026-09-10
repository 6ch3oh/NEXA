import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BenchmarkTaskRegistry, computePromptIdentity, loadBenchmarkTask } from '../src/benchmark-task-loader.mjs';
import { loadBenchmarkSuite } from '../src/benchmark-suite-loader.mjs';
import { findSensitiveData } from '../src/credential-provider.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const phase2Dir = join(root, 'benchmarks', 'phase2');
const scenarioDirs = ['planning', 'coding', 'instruction-following'];
const taskFiles = (await Promise.all(scenarioDirs.map(async (dir) =>
  (await readdir(join(phase2Dir, dir))).filter((name) => name.endsWith('.json')).sort().map((name) => join(phase2Dir, dir, name))
))).flat();
const tasks = await Promise.all(taskFiles.map((file) => loadBenchmarkTask(file, { rootDir: root })));
const byId = new Map(tasks.map((task) => [task.benchmark_task_id, task]));
const mapping = JSON.parse(await readFile(join(root, 'legacy', 'legacy-benchmark-mapping-v0.1.json'), 'utf8'));
const coverage = JSON.parse(await readFile(join(root, 'legacy', 'legacy-phase2-coverage-mapping-v0.1.json'), 'utf8'));
const lineage = JSON.parse(await readFile(join(root, 'contracts', 'phase2-task-lineage-v0.1.json'), 'utf8'));
const suitePath = join(phase2Dir, 'phase2-minimum-suite-v0.1.json');

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

test('exactly nine Phase-2 Benchmark Task files exist', () => {
  assert.equal(taskFiles.length, 9);
});

test('all nine task files pass the project Benchmark Task V0.1 loader', () => {
  assert.equal(tasks.length, 9);
  assert.ok(tasks.every((task) => task.schema_version === '0.1' && task.record_type === 'BENCHMARK_TASK'));
});

test('task ids and task id/version pairs are unique', () => {
  assert.equal(new Set(tasks.map((task) => task.benchmark_task_id)).size, 9);
  assert.equal(new Set(tasks.map((task) => `${task.benchmark_task_id}@${task.version}`)).size, 9);
});

test('every canonical prompt identity is computed from its actual prompt definition', () => {
  for (const task of tasks) assert.deepEqual(task.prompt_identity, computePromptIdentity(task));
});

test('coverage is exactly three tasks per required Scenario', () => {
  const counts = Object.groupBy(tasks, (task) => task.category);
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value.length])), {
    planning: 3,
    coding: 3,
    instruction_following: 3,
  });
});

test('surface contains three Legacy Anchors and six new complementary tasks', () => {
  assert.equal(tasks.filter((task) => task.metadata.task_origin === 'LEGACY_ANCHOR').length, 3);
  assert.equal(tasks.filter((task) => task.metadata.task_origin === 'NEW_COMPLEMENTARY').length, 6);
});

test('formal tasks are AUTHORED_DEFINITION and never TEST_FIXTURE', () => {
  assert.ok(tasks.every((task) => task.source_class === 'AUTHORED_DEFINITION'));
  assert.ok(tasks.every((task) => !task.tags.includes('fixture')));
});

test('formal tasks are candidate-neutral and execution-disabled', () => {
  for (const task of tasks) {
    assert.equal(task.metadata.candidate_independent, true);
    assert.equal(task.metadata.execution_allowed, false);
    assert.equal(task.metadata.result_records_created, 0);
    assert.doesNotMatch(JSON.stringify(task.parameters), /provider|model|endpoint/iu);
  }
});

test('no formal task contains sensitive data', () => {
  for (const task of tasks) assert.equal(findSensitiveData(task), null);
});

test('Legacy Anchor instructions exactly preserve all three LEGACY_ORIGINAL strings', () => {
  const anchors = tasks.filter((task) => task.metadata.task_origin === 'LEGACY_ANCHOR');
  for (const task of anchors) {
    const legacy = mapping.prompt_mapping.find((entry) => entry.legacy_task_id === task.metadata.legacy_task_id);
    assert.ok(legacy);
    assert.equal(task.prompt.instruction, legacy.legacy_original);
    assert.equal(task.metadata.legacy_instruction, legacy.legacy_original);
    assert.equal(task.metadata.legacy_instruction_changed, false);
  }
});

test('Legacy Anchor metadata preserves original stable prompt references', () => {
  for (const task of tasks.filter((item) => item.metadata.task_origin === 'LEGACY_ANCHOR')) {
    const legacy = mapping.prompt_mapping.find((entry) => entry.legacy_task_id === task.metadata.legacy_task_id);
    assert.equal(task.metadata.legacy_prompt_id, legacy.prompt_identity.prompt_id);
    assert.equal(task.metadata.adaptation_status, 'ADAPTED_FROM_LEGACY');
    assert.ok(task.metadata.changed_fields.includes('canonical wrapper'));
  }
});

test('canonical prompt ids are distinct from Legacy original prompt ids', () => {
  for (const task of tasks.filter((item) => item.metadata.task_origin === 'LEGACY_ANCHOR')) {
    assert.notEqual(task.prompt_identity.prompt_id, task.metadata.legacy_prompt_id);
  }
});

test('Legacy Anchors use authorized-import provenance', () => {
  const anchors = tasks.filter((task) => task.metadata.task_origin === 'LEGACY_ANCHOR');
  assert.ok(anchors.every((task) => task.provenance.origin === 'AUTHORIZED_IMPORT'));
});

test('Legacy Anchor evaluator choices are manual, manual, and rule-based', () => {
  assert.equal(byId.get('phase2.planning.legacy-anchor').evaluation_method.type, 'manual');
  assert.equal(byId.get('phase2.coding.legacy-anchor').evaluation_method.type, 'manual');
  assert.equal(byId.get('phase2.instruction-following.legacy-anchor').evaluation_method.type, 'rule_based');
});

test('complementary roles exactly fill the six 201A missing slots', () => {
  const expected = coverage.scenario_coverage.flatMap((entry) => entry.missing_slot_names).sort();
  const actual = tasks.filter((task) => task.metadata.task_origin === 'NEW_COMPLEMENTARY').map((task) => task.metadata.complementary_role).sort();
  assert.deepEqual(actual, expected);
});

test('new complementary tasks are locally authored and have no Legacy parent', () => {
  for (const task of tasks.filter((item) => item.metadata.task_origin === 'NEW_COMPLEMENTARY')) {
    assert.equal(task.provenance.origin, 'LOCAL_AUTHORED');
    assert.equal('legacy_task_id' in task.metadata, false);
  }
});

test('five complementary tasks use exact-match references', () => {
  const exact = tasks.filter((task) => task.evaluation_method.type === 'exact_match');
  assert.equal(exact.length, 5);
  assert.ok(exact.every((task) => typeof task.expected_output.reference === 'string'));
  assert.ok(exact.every((task) => Array.isArray(task.evaluation_method.config.normalization)));
});

test('rule-based tasks declare only supported offline rule types', () => {
  const supported = new Set(['contains', 'not_contains', 'regex', 'numeric_range', 'required_fields']);
  for (const task of tasks.filter((item) => item.evaluation_method.type === 'rule_based')) {
    assert.ok(task.evaluation_method.config.rules.length > 0);
    assert.ok(task.evaluation_method.config.rules.every((rule) => supported.has(rule.type)));
  }
});

test('the minimum suite resolves all nine tasks in stable order', async () => {
  const registry = new BenchmarkTaskRegistry();
  for (const task of tasks) registry.register(task);
  const resolved = await loadBenchmarkSuite(suitePath, { rootDir: root, registry });
  assert.equal(resolved.tasks.length, 9);
  assert.deepEqual(resolved.tasks.map((entry) => entry.order), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(resolved.tasks.map((entry) => entry.task.benchmark_task_id)).size, 9);
});

test('suite declares candidate-neutral, non-executable planning state', async () => {
  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.equal(suite.source_class, 'AUTHORED_DEFINITION');
  assert.equal(suite.metadata.execution_allowed, false);
  assert.equal(suite.metadata.campaign_status, 'NOT_AUTHORIZED');
  assert.equal(suite.metadata.fixture_mixing_allowed, false);
  assert.equal(suite.metadata.result_records_created, 0);
  assert.equal(findSensitiveData(suite), null);
});

test('suite scenario counts are 3/3/3', async () => {
  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.deepEqual(suite.metadata.scenario_task_counts, { planning: 3, coding: 3, instruction_following: 3 });
});

test('minimum campaign arithmetic is 36 planned observations', async () => {
  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.equal(suite.task_references.length * suite.metadata.planned_candidate_count * suite.default_parameters.runs_per_candidate_task, 36);
  assert.equal(suite.metadata.planned_observation_count, 36);
});

test('lineage has a one-to-one entry for every formal task', () => {
  assert.equal(lineage.task_lineage.length, 9);
  assert.deepEqual(lineage.task_lineage.map((entry) => entry.benchmark_task_id).sort(), tasks.map((task) => task.benchmark_task_id).sort());
});

test('lineage distinguishes canonicalized Anchors from new complements', () => {
  const anchors = lineage.task_lineage.filter((entry) => entry.task_origin === 'LEGACY_ANCHOR');
  const complements = lineage.task_lineage.filter((entry) => entry.task_origin === 'NEW_COMPLEMENTARY');
  assert.equal(anchors.length, 3);
  assert.equal(complements.length, 6);
  assert.ok(anchors.every((entry) => entry.legacy_asset_ref && entry.legacy_prompt_ref && entry.parent_task_id));
  assert.ok(complements.every((entry) => entry.legacy_asset_ref === null && entry.legacy_prompt_ref === null && entry.parent_task_id === null));
});

test('lineage records no result creation, network request, or contract change', () => {
  assert.equal(lineage.metadata.result_records_created, 0);
  assert.equal(lineage.metadata.network_requests, 0);
  assert.equal(lineage.metadata.phase1_contract_changes, 'NONE');
  assert.equal(lineage.metadata.sb201_contract_changes, 'NONE');
});

test('Phase-1 fixtures remain byte-identical and fixture-only', async () => {
  const expected = new Map([
    ['benchmark-task-planning.json', '4c43e77336f459e75385d93f3054c535f4941192935b9d72b5fa6b17e9fc71af'],
    ['benchmark-task-coding.json', '0466842b384fb12b097c7843ae529ee7f823e043d300cf4c96d7a652dbcc326f'],
    ['benchmark-task-instruction.json', '0c8ba03fe82bf60a6eb950c437f97021b0b9677d9d9dc5de79e6033847edd8eb'],
  ]);
  for (const [name, digest] of expected) {
    const file = join(root, 'tests', 'fixtures', name);
    assert.equal(await sha256(file), digest);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).source_class, 'TEST_FIXTURE');
  }
});

test('Phase-1 and SB-201 frozen references remain byte-identical', async () => {
  for (const reference of Object.values(lineage.frozen_references)) assert.equal(await sha256(join(root, reference.path)), reference.sha256);
});

test('new definitions contain no result or Legacy Summary record', async () => {
  const records = [...tasks, JSON.parse(await readFile(suitePath, 'utf8')), lineage];
  const forbidden = new Set(['RAW_RESULT', 'CANONICAL_EVALUATION', 'TASK_SCORE', 'SCENARIO_PROFILE', 'RECOMMENDATION_DECISION', 'LEGACY_SUMMARY']);
  assert.ok(records.every((record) => !forbidden.has(record.record_type)));
});
