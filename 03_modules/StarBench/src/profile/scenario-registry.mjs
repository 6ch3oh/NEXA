import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { BenchmarkTaskRegistry, taskReferenceKey } from '../benchmark-task-loader.mjs';
import { stableSha256 } from '../scoring/score-contracts.mjs';

const scenarioKeys = new Set([
  'schema_version', 'record_type', 'scenario_id', 'name', 'description', 'category', 'task_types',
  'benchmark_task_refs', 'suite_refs', 'metric_preferences', 'weights', 'minimum_coverage',
  'minimum_evidence', 'metadata', 'version',
]);
const categories = new Set(['coding', 'planning', 'instruction_following', 'reasoning', 'long_context', 'cost_efficiency', 'agent']);
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir);
  const target = resolve(filePath);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new ScenarioRegistryError('SCENARIO_PATH_ESCAPE', 'Scenario path must be a file below rootDir.');
  return target;
}

export class ScenarioRegistryError extends Error {
  constructor(code, message, errors = [], cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScenarioRegistryError';
    this.code = code;
    this.errors = errors;
  }
}

export function validateScenarioDefinition(scenario) {
  const errors = [];
  try { assertNoSensitiveData(scenario, 'Scenario Definition'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(scenario)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Scenario must be an object.' }] };
  for (const key of Object.keys(scenario)) if (!scenarioKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of scenarioKeys) if (!(key in scenario)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (scenario.schema_version !== '0.1' || scenario.record_type !== 'SCENARIO_DEFINITION') errors.push({ path: '/', code: 'contract', message: 'Expected Scenario Definition V0.1.' });
  if (!idPattern.test(scenario.scenario_id ?? '') || !versionPattern.test(scenario.version ?? '')) errors.push({ path: '/', code: 'identity', message: 'Invalid scenario identity or version.' });
  for (const key of ['name', 'description']) if (!nonEmptyString(scenario[key])) errors.push({ path: `/${key}`, code: 'type', message: 'Expected non-empty string.' });
  if (!categories.has(scenario.category)) errors.push({ path: '/category', code: 'enum', message: 'Invalid scenario category.' });
  if (!Array.isArray(scenario.task_types) || scenario.task_types.length === 0 || !scenario.task_types.every(nonEmptyString) || new Set(scenario.task_types).size !== scenario.task_types.length) errors.push({ path: '/task_types', code: 'type', message: 'task_types must be unique strings.' });
  if (!Array.isArray(scenario.benchmark_task_refs) || !Array.isArray(scenario.suite_refs) || scenario.benchmark_task_refs.length + scenario.suite_refs.length === 0) errors.push({ path: '/', code: 'mapping_required', message: 'At least one explicit task or suite reference is required.' });
  const taskKeys = new Set();
  for (const [index, ref] of (Array.isArray(scenario.benchmark_task_refs) ? scenario.benchmark_task_refs : []).entries()) {
    if (!plain(ref) || !idPattern.test(ref?.benchmark_task_id ?? '') || !versionPattern.test(ref?.version ?? '') || !positive(ref?.weight) || typeof ref?.required !== 'boolean' || Object.keys(ref ?? {}).some((key) => !['benchmark_task_id', 'version', 'weight', 'required'].includes(key))) errors.push({ path: `/benchmark_task_refs/${index}`, code: 'type', message: 'Invalid task mapping.' });
    const key = taskReferenceKey(ref?.benchmark_task_id, ref?.version);
    if (taskKeys.has(key)) errors.push({ path: `/benchmark_task_refs/${index}`, code: 'duplicate_reference', message: `Duplicate task reference ${key}.` });
    taskKeys.add(key);
  }
  const suiteKeys = new Set();
  for (const [index, ref] of (Array.isArray(scenario.suite_refs) ? scenario.suite_refs : []).entries()) {
    if (!plain(ref) || !idPattern.test(ref?.suite_id ?? '') || !versionPattern.test(ref?.version ?? '') || !positive(ref?.weight) || typeof ref?.required !== 'boolean' || Object.keys(ref ?? {}).some((key) => !['suite_id', 'version', 'weight', 'required'].includes(key))) errors.push({ path: `/suite_refs/${index}`, code: 'type', message: 'Invalid suite mapping.' });
    const key = `${ref?.suite_id}@${ref?.version}`;
    if (suiteKeys.has(key)) errors.push({ path: `/suite_refs/${index}`, code: 'duplicate_reference', message: `Duplicate suite reference ${key}.` });
    suiteKeys.add(key);
  }
  const metricIds = new Set();
  if (!Array.isArray(scenario.metric_preferences)) errors.push({ path: '/metric_preferences', code: 'type', message: 'metric_preferences must be an array.' });
  for (const [index, metric] of (Array.isArray(scenario.metric_preferences) ? scenario.metric_preferences : []).entries()) {
    if (!plain(metric) || !idPattern.test(metric?.metric_id ?? '') || !positive(metric?.weight) || typeof metric?.required !== 'boolean' || Object.keys(metric ?? {}).some((key) => !['metric_id', 'weight', 'required'].includes(key))) errors.push({ path: `/metric_preferences/${index}`, code: 'type', message: 'Invalid metric preference.' });
    if (metricIds.has(metric?.metric_id)) errors.push({ path: `/metric_preferences/${index}`, code: 'duplicate_metric', message: 'Duplicate metric preference.' });
    metricIds.add(metric?.metric_id);
  }
  if (!plain(scenario.weights) || scenario.weights?.normalization !== 'normalize_positive' || scenario.weights?.coverage_mode !== 'weighted_task_metric_coverage' || Object.keys(scenario.weights ?? {}).some((key) => !['normalization', 'coverage_mode'].includes(key))) errors.push({ path: '/weights', code: 'contract', message: 'Invalid weighting contract.' });
  if (typeof scenario.minimum_coverage !== 'number' || !Number.isFinite(scenario.minimum_coverage) || scenario.minimum_coverage < 0 || scenario.minimum_coverage > 1) errors.push({ path: '/minimum_coverage', code: 'range', message: 'minimum_coverage must be [0,1].' });
  if (!Number.isInteger(scenario.minimum_evidence) || scenario.minimum_evidence < 1) errors.push({ path: '/minimum_evidence', code: 'range', message: 'minimum_evidence must be a positive integer.' });
  if (!plain(scenario.metadata)) errors.push({ path: '/metadata', code: 'type', message: 'metadata must be an object.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidScenarioDefinition(scenario) {
  if (scenario?.record_type === 'LEGACY_SUMMARY') throw new ScenarioRegistryError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot enter the Scenario registry.');
  const checked = validateScenarioDefinition(scenario);
  if (!checked.valid) throw new ScenarioRegistryError('SCENARIO_DEFINITION_INVALID', 'Scenario Definition validation failed.', checked.errors);
  return scenario;
}

export function scenarioReferenceKey(scenarioId, version) { return `${scenarioId}@${version}`; }
export function computeScenarioIdentity(scenario) {
  assertValidScenarioDefinition(scenario);
  return { scenario_id: scenario.scenario_id, scenario_version: scenario.version, scenario_definition_sha256: stableSha256(scenario) };
}

export function resolveScenario(scenario, { taskRegistry, suiteRegistry = new Map() } = {}) {
  assertValidScenarioDefinition(scenario);
  if (!(taskRegistry instanceof BenchmarkTaskRegistry)) throw new ScenarioRegistryError('TASK_REGISTRY_REQUIRED', 'A BenchmarkTaskRegistry is required.');
  const taskMappings = scenario.benchmark_task_refs.map((ref) => {
    if (!taskRegistry.has(ref.benchmark_task_id, ref.version)) throw new ScenarioRegistryError('SCENARIO_TASK_REFERENCE_MISSING', `Scenario references missing task ${taskReferenceKey(ref.benchmark_task_id, ref.version)}.`);
    return { ...structuredClone(ref), mapping_source: 'TASK_REFERENCE' };
  });
  const suiteMappings = [];
  for (const ref of scenario.suite_refs) {
    const key = `${ref.suite_id}@${ref.version}`;
    const suite = suiteRegistry.get(key);
    if (!suite) throw new ScenarioRegistryError('SCENARIO_SUITE_REFERENCE_MISSING', `Scenario references missing suite ${key}.`);
    if (!Array.isArray(suite.tasks) || suite.tasks.length === 0) throw new ScenarioRegistryError('SCENARIO_SUITE_INVALID', `Resolved suite ${key} contains no tasks.`);
    const taskWeight = ref.weight / suite.tasks.length;
    for (const entry of suite.tasks) suiteMappings.push({ benchmark_task_id: entry.task.benchmark_task_id, version: entry.task.version, weight: taskWeight, required: ref.required, mapping_source: 'SUITE_REFERENCE', suite_id: ref.suite_id });
  }
  const combined = [...taskMappings, ...suiteMappings];
  const keys = combined.map((ref) => taskReferenceKey(ref.benchmark_task_id, ref.version));
  if (new Set(keys).size !== keys.length) throw new ScenarioRegistryError('SCENARIO_MAPPING_COLLISION', 'Scenario maps the same task more than once.');
  return { definition: structuredClone(scenario), scenario_identity: computeScenarioIdentity(scenario), task_mappings: combined };
}

export async function loadScenarioDefinition(filePath, { rootDir = process.cwd() } = {}) {
  const target = boundedFile(rootDir, filePath);
  let scenario;
  try { scenario = JSON.parse(await readFile(target, 'utf8')); } catch (error) { throw new ScenarioRegistryError(error instanceof SyntaxError ? 'SCENARIO_JSON_INVALID' : 'SCENARIO_READ_FAILED', 'Scenario Definition could not be loaded.', [], error); }
  assertValidScenarioDefinition(scenario);
  return structuredClone(scenario);
}

export class ScenarioRegistry {
  #scenarios = new Map();
  register(scenario) {
    assertValidScenarioDefinition(scenario);
    const key = scenarioReferenceKey(scenario.scenario_id, scenario.version);
    if (this.#scenarios.has(key)) throw new ScenarioRegistryError('SCENARIO_DUPLICATE', `Scenario ${key} is already registered.`);
    this.#scenarios.set(key, structuredClone(scenario));
    return key;
  }
  get(scenarioId, version) { const value = this.#scenarios.get(scenarioReferenceKey(scenarioId, version)); return value ? structuredClone(value) : null; }
  list() { return [...this.#scenarios.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, scenario]) => structuredClone(scenario)); }
}
