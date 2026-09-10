import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { ScenarioRegistry } from '../profile/scenario-registry.mjs';
import { plain } from '../scoring/score-contracts.mjs';

const ruleKeys = new Set(['schema_version', 'record_type', 'rule_id', 'version', 'name', 'description', 'target_scenario_id', 'priority', 'signals', 'required_signals', 'excluded_signals', 'weight', 'reason_code', 'enabled', 'source_class', 'metadata']);
const signalKeys = new Set(['signal_id', 'signal_type', 'field', 'values', 'match', 'case_sensitive', 'weight']);
const signalTypes = new Set(['keyword', 'phrase', 'structured_hint', 'task_type', 'domain_hint']);
const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

function nonEmpty(value) { return typeof value === 'string' && value.length > 0; }
function uniqueStrings(value) { return Array.isArray(value) && value.every(nonEmpty) && new Set(value).size === value.length; }
function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function unit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function boundedFile(rootDir, filePath) {
  const root = resolve(rootDir); const target = resolve(filePath); const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new IntentRuleRegistryError('INTENT_RULE_PATH_ESCAPE', 'Intent Rule path must be a file below rootDir.');
  return target;
}

function validateSignal(signal, path, errors) {
  if (!plain(signal)) { errors.push({ path, code: 'type', message: 'Signal must be an object.' }); return; }
  for (const key of Object.keys(signal)) if (!signalKeys.has(key)) errors.push({ path: `${path}/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of signalKeys) if (!(key in signal)) errors.push({ path: `${path}/${key}`, code: 'required', message: 'Required field is missing.' });
  if (!idPattern.test(signal.signal_id ?? '') || !signalTypes.has(signal.signal_type) || !(signal.field === null || nonEmpty(signal.field)) || !uniqueStrings(signal.values) || !['ANY', 'ALL', 'EQUALS'].includes(signal.match) || typeof signal.case_sensitive !== 'boolean' || !positive(signal.weight)) errors.push({ path, code: 'signal_invalid', message: 'Signal contract is invalid.' });
  if (['structured_hint', 'task_type', 'domain_hint'].includes(signal.signal_type) && !nonEmpty(signal.field)) errors.push({ path: `${path}/field`, code: 'field_required', message: 'Structured signals require a field.' });
  if (['keyword', 'phrase'].includes(signal.signal_type) && signal.field !== null) errors.push({ path: `${path}/field`, code: 'field_forbidden', message: 'Text signals use task_text and require field null.' });
}

export class IntentRuleRegistryError extends Error {
  constructor(code, message, errors = [], cause = null) { super(message, cause ? { cause } : undefined); this.name = 'IntentRuleRegistryError'; this.code = code; this.errors = errors; }
}

export function validateIntentRule(rule) {
  const errors = [];
  try { assertNoSensitiveData(rule, 'Intent Rule'); } catch (error) { errors.push({ path: '/', code: error.code, message: error.message }); }
  if (!plain(rule)) return { valid: false, errors: [...errors, { path: '/', code: 'type', message: 'Intent Rule must be an object.' }] };
  for (const key of Object.keys(rule)) if (!ruleKeys.has(key)) errors.push({ path: `/${key}`, code: 'additional_property', message: 'Unexpected field.' });
  for (const key of ruleKeys) if (!(key in rule)) errors.push({ path: `/${key}`, code: 'required', message: 'Required field is missing.' });
  if (rule.schema_version !== '0.1' || rule.record_type !== 'INTENT_RULE') errors.push({ path: '/', code: 'contract', message: 'Expected Intent Rule V0.1.' });
  if (!idPattern.test(rule.rule_id ?? '') || !versionPattern.test(rule.version ?? '')) errors.push({ path: '/', code: 'identity', message: 'Invalid rule identity or version.' });
  if (!nonEmpty(rule.name) || !nonEmpty(rule.description) || !nonEmpty(rule.target_scenario_id) || !Number.isInteger(rule.priority) || rule.priority < 0 || !positive(rule.weight) || !/^[A-Z][A-Z0-9_]*$/u.test(rule.reason_code ?? '') || typeof rule.enabled !== 'boolean' || !['TEST_FIXTURE', 'ROUTING_RULE'].includes(rule.source_class) || !plain(rule.metadata)) errors.push({ path: '/', code: 'type', message: 'Invalid rule metadata or routing fields.' });
  if (!Array.isArray(rule.signals) || rule.signals.length === 0) errors.push({ path: '/signals', code: 'type', message: 'At least one positive signal is required.' });
  for (const [index, signal] of (Array.isArray(rule.signals) ? rule.signals : []).entries()) validateSignal(signal, `/signals/${index}`, errors);
  for (const [index, signal] of (Array.isArray(rule.excluded_signals) ? rule.excluded_signals : []).entries()) validateSignal(signal, `/excluded_signals/${index}`, errors);
  if (!Array.isArray(rule.excluded_signals)) errors.push({ path: '/excluded_signals', code: 'type', message: 'excluded_signals must be an array.' });
  if (!uniqueStrings(rule.required_signals)) errors.push({ path: '/required_signals', code: 'type', message: 'required_signals must contain unique signal IDs.' });
  const signalIds = (Array.isArray(rule.signals) ? rule.signals : []).map((signal) => signal.signal_id);
  if (new Set(signalIds).size !== signalIds.length) errors.push({ path: '/signals', code: 'duplicate_signal', message: 'Signal IDs must be unique within a rule.' });
  if (Array.isArray(rule.required_signals) && rule.required_signals.some((signalId) => !signalIds.includes(signalId))) errors.push({ path: '/required_signals', code: 'unknown_signal', message: 'Required signals must reference positive signal IDs.' });
  if (rule.source_class === 'TEST_FIXTURE' && rule.metadata?.fixture_only !== true) errors.push({ path: '/metadata/fixture_only', code: 'source_isolation', message: 'Fixture rule must be fixture_only.' });
  return { valid: errors.length === 0, errors };
}

export function assertValidIntentRule(rule) {
  if (rule?.record_type === 'LEGACY_SUMMARY') throw new IntentRuleRegistryError('LEGACY_SUMMARY_REJECTED', 'LEGACY_SUMMARY cannot become an Intent Rule.');
  const checked = validateIntentRule(rule);
  if (!checked.valid) throw new IntentRuleRegistryError('INTENT_RULE_INVALID', 'Intent Rule validation failed.', checked.errors);
  return rule;
}

export function validateRoutingConfig(config) {
  return plain(config) && unit(config.minimum_score) && unit(config.ambiguity_margin) && plain(config.confidence_thresholds) && unit(config.confidence_thresholds.medium) && unit(config.confidence_thresholds.high) && config.confidence_thresholds.high >= config.confidence_thresholds.medium;
}

export class IntentRuleRegistry {
  #rules = new Map();
  constructor({ scenarioRegistry, routingConfig }) {
    if (!(scenarioRegistry instanceof ScenarioRegistry)) throw new IntentRuleRegistryError('SCENARIO_REGISTRY_REQUIRED', 'The existing Scenario Registry is required.');
    if (!validateRoutingConfig(routingConfig)) throw new IntentRuleRegistryError('ROUTING_CONFIG_INVALID', 'Routing config must explicitly define score, ambiguity, and confidence thresholds.');
    this.scenarioRegistry = scenarioRegistry;
    this.routingConfig = structuredClone(routingConfig);
  }
  register(rule) {
    assertValidIntentRule(rule);
    if (!this.scenarioRegistry.list().some((scenario) => scenario.scenario_id === rule.target_scenario_id)) throw new IntentRuleRegistryError('RULE_SCENARIO_NOT_REGISTERED', `Rule target ${rule.target_scenario_id} is not registered.`);
    const key = `${rule.rule_id}@${rule.version}`;
    if (this.#rules.has(key)) throw new IntentRuleRegistryError('INTENT_RULE_DUPLICATE', `Intent Rule ${key} is already registered.`);
    this.#rules.set(key, structuredClone(rule));
    return key;
  }
  list({ enabledOnly = false } = {}) { return [...this.#rules.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, rule]) => structuredClone(rule)).filter((rule) => !enabledOnly || rule.enabled); }
  get(ruleId, version) { const value = this.#rules.get(`${ruleId}@${version}`); return value ? structuredClone(value) : null; }
}

export async function loadIntentRuleSet(filePath, { rootDir = process.cwd(), scenarioRegistry } = {}) {
  const target = boundedFile(rootDir, filePath);
  let set;
  try { set = JSON.parse(await readFile(target, 'utf8')); } catch (error) { throw new IntentRuleRegistryError(error instanceof SyntaxError ? 'INTENT_RULE_JSON_INVALID' : 'INTENT_RULE_READ_FAILED', 'Intent Rule Set could not be loaded.', [], error); }
  assertNoSensitiveData(set, 'Intent Rule Set');
  if (!plain(set) || set.schema_version !== '0.1' || set.record_type !== 'INTENT_RULE_SET' || !idPattern.test(set.rule_set_id ?? '') || !versionPattern.test(set.version ?? '') || !validateRoutingConfig(set.routing_config) || !Array.isArray(set.rules) || set.rules.length === 0 || !plain(set.metadata) || set.source_class !== 'TEST_FIXTURE' || set.metadata.fixture_only !== true) throw new IntentRuleRegistryError('INTENT_RULE_SET_INVALID', 'Intent Rule Set validation failed.');
  const registry = new IntentRuleRegistry({ scenarioRegistry, routingConfig: set.routing_config });
  for (const rule of set.rules) registry.register(rule);
  return { definition: structuredClone(set), registry };
}
