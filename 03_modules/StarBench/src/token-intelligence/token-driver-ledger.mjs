import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { assertNoSensitiveData } from '../credential-provider.mjs';
import { stableSha256 } from './contracts.mjs';

export const TOKEN_DRIVER_COMPONENT_TYPES = Object.freeze([
  'BASE_CONTEXT', 'SHARED_CONTEXT', 'INCREMENTAL_CONTEXT', 'TASK_INSTRUCTION',
  'EXPECTED_OUTPUT', 'REASONING', 'REVIEW', 'ACCEPTANCE', 'TEST_ANALYSIS',
  'DEBUG_ANALYSIS', 'SESSION_CONTROL', 'RISK_EXPANSION', 'DOCUMENTATION',
]);

const typeSet = new Set(TOKEN_DRIVER_COMPONENT_TYPES);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value) => Number.isInteger(value) && value >= 0;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const clean = (value) => structuredClone(value);

function bounded(rootDir, filePath) {
  const root = resolve(rootDir), target = resolve(filePath), rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) fail('TOKEN_DRIVER_STORE_PATH_ESCAPE', 'Token Driver Ledger path must stay below rootDir.');
  return target;
}

function driverId(value) {
  const copy = clean(value); delete copy.driver_id;
  return `token_driver_${stableSha256(copy)}`;
}

function componentForContext(component, unit, call) {
  if (component.component === 'task_instruction') return 'TASK_INSTRUCTION';
  if (component.component === 'test_or_diagnostic_feedback') return unit.task_type === 'DEBUG' || call.purpose === 'diagnosis_and_repair' ? 'DEBUG_ANALYSIS' : 'TEST_ANALYSIS';
  if (component.component === 'acceptance_context_refresh') return 'ACCEPTANCE';
  if (component.component === 'prior_execution_summary') return 'INCREMENTAL_CONTEXT';
  if ((unit.risk_factors ?? []).length > 0 && component.component === 'required_context') return 'RISK_EXPANSION';
  return 'BASE_CONTEXT';
}

function componentForOutput(component, unit, call) {
  if (call.purpose === 'review_or_acceptance' || unit.task_type === 'CODE_REVIEW') return component.component === 'structured_response' ? 'SESSION_CONTROL' : (unit.task_type === 'FINAL_ACCEPTANCE' ? 'ACCEPTANCE' : 'REVIEW');
  if (call.purpose === 'test_feedback_analysis' || unit.task_type === 'TEST_ANALYSIS' || component.component === 'test_analysis' || component.component === 'test_definition') return 'TEST_ANALYSIS';
  if (call.purpose === 'diagnosis_and_repair' || unit.task_type === 'DEBUG') return 'DEBUG_ANALYSIS';
  if (unit.task_type === 'FINAL_ACCEPTANCE') return 'ACCEPTANCE';
  if (unit.task_type === 'DOCUMENTATION' || component.component === 'structured_response') return 'DOCUMENTATION';
  if ((unit.risk_factors ?? []).length > 0 && unit.path_role === 'RISK_RESPONSE') return 'RISK_EXPANSION';
  return 'EXPECTED_OUTPUT';
}

function makeDriver(base) {
  const value = {
    schema_version: '0.1', record_type: 'TOKEN_DRIVER', driver_id: '',
    forecast_id: base.forecast_id, estimator_version: base.estimator_version,
    path: base.path, phase: base.phase, work_unit_id: base.work_unit_id,
    session_id: base.session_id, model_call_id: base.model_call_id,
    execution_role: base.execution_role, model_class: base.model_class,
    component_type: base.component_type, estimated_tokens: base.estimated_tokens,
    estimate_basis: clean(base.estimate_basis ?? []), source_context: clean(base.source_context ?? {}),
    shared_context_ref: base.shared_context_ref ?? null, risk_ref: clean(base.risk_ref ?? []),
    historical_evidence_refs: clean(base.historical_evidence_refs ?? []), confidence: base.confidence,
    provenance: clean(base.provenance),
  };
  value.driver_id = driverId(value);
  return assertValidTokenDriver(value);
}

export function assertValidTokenDriver(value) {
  assertNoSensitiveData(value, 'Token Driver');
  const keys = ['schema_version','record_type','driver_id','forecast_id','estimator_version','path','phase','work_unit_id','session_id','model_call_id','execution_role','model_class','component_type','estimated_tokens','estimate_basis','source_context','shared_context_ref','risk_ref','historical_evidence_refs','confidence','provenance'];
  if (!isObject(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value)) || value.schema_version !== '0.1' || value.record_type !== 'TOKEN_DRIVER' || !/^token_driver_[a-f0-9]{64}$/u.test(value.driver_id ?? '') || driverId(value) !== value.driver_id || !typeSet.has(value.component_type) || !integer(value.estimated_tokens) || !Array.isArray(value.estimate_basis) || !isObject(value.source_context) || !Array.isArray(value.risk_ref) || !Array.isArray(value.historical_evidence_refs) || !['LOW','MEDIUM','HIGH'].includes(value.confidence) || !isObject(value.provenance) || !['INPUT','OUTPUT','REASONING','CONTROL'].includes(value.provenance.dimension) || value.provenance.actual_component_value !== null) fail('TOKEN_DRIVER_INVALID', 'Token Driver V0.1 is invalid.');
  return value;
}

function productionDrivers({ forecastId, estimatorVersion, path, graph }) {
  const drivers = [];
  for (const unit of graph.work_units) {
    const sessionId = `production_session_${stableSha256({ forecastId, path: path.path_type, work_unit_id: unit.work_unit_id })}`;
    for (const call of unit.call_estimates) {
      const common = { forecast_id: forecastId, estimator_version: estimatorVersion, path: path.path_type, phase: unit.phase, work_unit_id: unit.work_unit_id, session_id: sessionId, model_call_id: call.call_id, execution_role: call.execution_role, model_class: call.model_class, estimate_basis: call.estimate_basis, risk_ref: unit.risk_factors, historical_evidence_refs: unit.historical_evidence_refs, confidence: unit.confidence };
      for (const component of call.context_components) drivers.push(makeDriver({ ...common, component_type: componentForContext(component, unit, call), estimated_tokens: component.tokens, source_context: { estimator: 'PRODUCTION', source_component: component.component, purpose: call.purpose, reusable: component.reusable, cached_input_tokens_non_additive: call.cached_input_tokens }, provenance: { source_record_type: 'AI_WORK_UNIT_CALL_ESTIMATE', source_component: component.component, dimension: 'INPUT', actual_component_value: null, additive: true } }));
      for (const component of call.output_components) drivers.push(makeDriver({ ...common, component_type: componentForOutput(component, unit, call), estimated_tokens: component.tokens, source_context: { estimator: 'PRODUCTION', source_component: component.component, purpose: call.purpose }, provenance: { source_record_type: 'AI_WORK_UNIT_CALL_ESTIMATE', source_component: component.component, dimension: 'OUTPUT', actual_component_value: null, additive: true } }));
      if (call.reasoning_tokens > 0) drivers.push(makeDriver({ ...common, component_type: 'REASONING', estimated_tokens: call.reasoning_tokens, source_context: { estimator: 'PRODUCTION', purpose: call.purpose }, provenance: { source_record_type: 'AI_WORK_UNIT_CALL_ESTIMATE', source_component: 'reasoning_tokens', dimension: 'REASONING', actual_component_value: null, additive: true } }));
    }
  }
  return drivers;
}

function shadowDrivers({ forecastId, estimatorVersion, path, graph }) {
  const units = new Map(graph.work_units.map((unit) => [unit.work_unit_id, unit])), drivers = [];
  for (const session of path.execution_sessions) {
    for (const [index, call] of session.model_calls.entries()) {
      const unit = units.get(call.work_unit_id);
      if (!unit) fail('TOKEN_DRIVER_WORK_UNIT_REF_INVALID', 'Shadow call references an unknown Work Unit.');
      const common = { forecast_id: forecastId, estimator_version: estimatorVersion, path: path.path_type, phase: unit.phase, work_unit_id: unit.work_unit_id, session_id: session.session_id, model_call_id: call.call_id, execution_role: call.execution_role, model_class: call.model_class, estimate_basis: call.estimate_basis, risk_ref: unit.risk_factors, historical_evidence_refs: unit.historical_evidence_refs, confidence: session.confidence };
      if (call.new_incremental_context > 0) drivers.push(makeDriver({ ...common, component_type: index === 0 ? 'BASE_CONTEXT' : ((unit.risk_factors ?? []).length && unit.path_role === 'RISK_RESPONSE' ? 'RISK_EXPANSION' : 'INCREMENTAL_CONTEXT'), estimated_tokens: call.new_incremental_context, source_context: { estimator: 'SHADOW_V1', purpose: call.purpose, logical_required_context: call.logical_required_context, shared_context_reused_non_additive: call.shared_context_reused, provider_cached_input_tokens: null }, provenance: { source_record_type: 'SHADOW_MODEL_CALL', source_component: 'new_incremental_context', dimension: 'INPUT', actual_component_value: null, additive: true } }));
      if (call.shared_context_reference_overhead > 0) drivers.push(makeDriver({ ...common, component_type: 'SHARED_CONTEXT', estimated_tokens: call.shared_context_reference_overhead, shared_context_ref: session.session_id, source_context: { estimator: 'SHADOW_V1', purpose: call.purpose, shared_context_reused_non_additive: call.shared_context_reused, reference_overhead_only: true, provider_cached_input_tokens: null }, provenance: { source_record_type: 'SHADOW_MODEL_CALL', source_component: 'shared_context_reference_overhead', dimension: 'INPUT', actual_component_value: null, additive: true } }));
      for (const component of call.output_components) drivers.push(makeDriver({ ...common, component_type: componentForOutput(component, unit, call), estimated_tokens: component.tokens, source_context: { estimator: 'SHADOW_V1', source_component: component.component, purpose: call.purpose }, provenance: { source_record_type: 'SHADOW_MODEL_CALL', source_component: component.component, dimension: 'OUTPUT', actual_component_value: null, additive: true } }));
      if (call.reasoning_tokens > 0) drivers.push(makeDriver({ ...common, component_type: 'REASONING', estimated_tokens: call.reasoning_tokens, source_context: { estimator: 'SHADOW_V1', purpose: call.purpose }, provenance: { source_record_type: 'SHADOW_MODEL_CALL', source_component: 'reasoning_tokens', dimension: 'REASONING', actual_component_value: null, additive: true } }));
      if (['review_or_acceptance','diagnosis_and_repair'].includes(call.purpose)) drivers.push(makeDriver({ ...common, component_type: 'SESSION_CONTROL', estimated_tokens: 0, source_context: { estimator: 'SHADOW_V1', structural_control_call: true, purpose: call.purpose }, provenance: { source_record_type: 'SHADOW_MODEL_CALL', source_component: 'control_marker', dimension: 'CONTROL', actual_component_value: null, additive: true } }));
    }
  }
  return drivers;
}

function groupTokens(drivers, key) {
  const out = {};
  for (const driver of drivers) out[driver[key]] = (out[driver[key]] ?? 0) + driver.estimated_tokens;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function buildTrace(drivers) {
  const units = new Map();
  for (const driver of drivers) {
    if (!units.has(driver.work_unit_id)) units.set(driver.work_unit_id, { work_unit_id: driver.work_unit_id, phase: driver.phase, estimated_tokens: 0, sessions: new Map() });
    const unit = units.get(driver.work_unit_id); unit.estimated_tokens += driver.estimated_tokens;
    if (!unit.sessions.has(driver.session_id)) unit.sessions.set(driver.session_id, { session_id: driver.session_id, estimated_tokens: 0, calls: new Map() });
    const session = unit.sessions.get(driver.session_id); session.estimated_tokens += driver.estimated_tokens;
    if (!session.calls.has(driver.model_call_id)) session.calls.set(driver.model_call_id, { model_call_id: driver.model_call_id, estimated_tokens: 0, driver_refs: [] });
    const call = session.calls.get(driver.model_call_id); call.estimated_tokens += driver.estimated_tokens; call.driver_refs.push(driver.driver_id);
  }
  return [...units.values()].map((unit) => ({ ...unit, sessions: [...unit.sessions.values()].map((session) => ({ ...session, calls: [...session.calls.values()] })) }));
}

function audit(drivers, graph, totalTokens) {
  const components = groupTokens(drivers, 'component_type'), dimensions = {};
  for (const driver of drivers) dimensions[driver.provenance.dimension] = (dimensions[driver.provenance.dimension] ?? 0) + driver.estimated_tokens;
  const sessions = new Set(drivers.map((driver) => driver.session_id)), calls = new Set(drivers.map((driver) => driver.model_call_id));
  const top = [...drivers].sort((a, b) => b.estimated_tokens - a.estimated_tokens || a.driver_id.localeCompare(b.driver_id)).slice(0, 10).map((driver) => ({ driver_id: driver.driver_id, component_type: driver.component_type, work_unit_id: driver.work_unit_id, session_id: driver.session_id, model_call_id: driver.model_call_id, estimated_tokens: driver.estimated_tokens }));
  return { total_work_units: graph.work_units.length, total_sessions: sessions.size, total_model_calls: calls.size, total_token_drivers: drivers.length, base_context_tokens: components.BASE_CONTEXT ?? 0, shared_context_tokens: components.SHARED_CONTEXT ?? 0, incremental_context_tokens: components.INCREMENTAL_CONTEXT ?? 0, output_tokens: dimensions.OUTPUT ?? 0, reasoning_tokens: dimensions.REASONING ?? 0, review_tokens: components.REVIEW ?? 0, test_analysis_tokens: components.TEST_ANALYSIS ?? 0, debug_tokens: components.DEBUG_ANALYSIS ?? 0, control_tokens: components.SESSION_CONTROL ?? 0, risk_expansion_tokens: components.RISK_EXPANSION ?? 0, top_token_drivers: top, top_overestimation_pressure: [], component_totals: components, dimension_totals: dimensions, total_tokens: totalTokens };
}

export function computeTokenDriverLedgerId(value) { const copy = clean(value); delete copy.ledger_id; return `token_driver_ledger_${stableSha256(copy)}`; }

export function assertValidTokenDriverLedger(value) {
  assertNoSensitiveData(value, 'Token Driver Ledger');
  if (!isObject(value) || value.schema_version !== '0.1' || value.record_type !== 'TOKEN_DRIVER_LEDGER' || !/^token_driver_ledger_[a-f0-9]{64}$/u.test(value.ledger_id ?? '') || computeTokenDriverLedgerId(value) !== value.ledger_id || !Array.isArray(value.drivers) || value.drivers.some((driver) => { try { assertValidTokenDriver(driver); return false; } catch { return true; } }) || !integer(value.forecast_total_tokens) || !isObject(value.conservation) || value.conservation.status !== 'PASS' || value.conservation.driver_total_tokens !== value.forecast_total_tokens || sum(value.drivers.map((driver) => driver.estimated_tokens)) !== value.forecast_total_tokens || !Array.isArray(value.trace) || !isObject(value.audit) || value.metadata?.actual_component_fabrication !== 0 || value.metadata?.fixed_multiplier !== false) fail('TOKEN_DRIVER_LEDGER_INVALID', 'Token Driver Ledger V0.1 is invalid or does not conserve Token.');
  return value;
}

export function buildProductionTokenDriverLedger({ case_id, forecast_id, estimator_version = 'PROJECT_SEMANTIC_WORK_GRAPH/V0.1', path, graph, evidence_class, authority = 'FORECAST_BUNDLE' }) {
  if (path.graph_id !== graph.graph_id || path.total_tokens !== sum(graph.work_units.flatMap((unit) => unit.call_estimates).map((call) => call.total_tokens))) fail('TOKEN_DRIVER_PRODUCTION_INPUT_MISMATCH', 'Production Forecast path and graph are inconsistent.');
  const drivers = productionDrivers({ forecastId: forecast_id, estimatorVersion: estimator_version, path, graph }), total = sum(drivers.map((driver) => driver.estimated_tokens));
  if (total !== path.total_tokens) fail('TOKEN_DRIVER_CONSERVATION_FAILED', 'Production Token Drivers do not conserve the Forecast total.');
  const value = { schema_version: '0.1', record_type: 'TOKEN_DRIVER_LEDGER', ledger_id: '', case_id, forecast_id, estimator_version, path: path.path_type, evidence_class, authority, forecast_total_tokens: path.total_tokens, drivers, trace: buildTrace(drivers), audit: audit(drivers, graph, total), conservation: { status: 'PASS', forecast_total_tokens: path.total_tokens, driver_total_tokens: total, delta_tokens: total - path.total_tokens }, provenance: { source_graph_id: graph.graph_id, source_forecast_id: forecast_id, forecast_mutated: false, actual_used: false }, metadata: { actual_component_fabrication: 0, fixed_multiplier: false, goal_specific_rule: false, production_estimator_changed: false, real_api_calls: 0, business_runtime_network: 0 } };
  value.ledger_id = computeTokenDriverLedgerId(value); return assertValidTokenDriverLedger(value);
}

export function buildShadowTokenDriverLedger({ case_id, forecast_id, estimator_version = 'SESSION_AWARE_SHADOW/V0.1', path, graph, evidence_class, authority = 'SHADOW_FORECAST' }) {
  const drivers = shadowDrivers({ forecastId: forecast_id, estimatorVersion: estimator_version, path, graph }), total = sum(drivers.map((driver) => driver.estimated_tokens));
  if (total !== path.total_tokens) fail('TOKEN_DRIVER_CONSERVATION_FAILED', 'Shadow Token Drivers do not conserve the Forecast total.');
  const value = { schema_version: '0.1', record_type: 'TOKEN_DRIVER_LEDGER', ledger_id: '', case_id, forecast_id, estimator_version, path: path.path_type, evidence_class, authority, forecast_total_tokens: path.total_tokens, drivers, trace: buildTrace(drivers), audit: audit(drivers, graph, total), conservation: { status: 'PASS', forecast_total_tokens: path.total_tokens, driver_total_tokens: total, delta_tokens: total - path.total_tokens }, provenance: { source_graph_id: graph.graph_id, source_forecast_id: forecast_id, forecast_mutated: false, actual_used: false, shared_context_reused_is_non_additive: true }, metadata: { actual_component_fabrication: 0, fixed_multiplier: false, goal_specific_rule: false, production_estimator_changed: false, real_api_calls: 0, business_runtime_network: 0 } };
  value.ledger_id = computeTokenDriverLedgerId(value); return assertValidTokenDriverLedger(value);
}

export class TokenDriverLedgerStore {
  constructor({ rootDir = process.cwd(), filePath }) { this.filePath = bounded(rootDir, filePath); }
  async read() { return assertValidTokenDriverLedger(JSON.parse(await readFile(this.filePath, 'utf8'))); }
  async write(value) { const ledger = clean(assertValidTokenDriverLedger(value)); let existing = null; try { existing = await this.read(); } catch (error) { if (error.code !== 'ENOENT') throw error; } if (existing) { if (stableSha256(existing) !== stableSha256(ledger)) fail('TOKEN_DRIVER_LEDGER_CONFLICT', 'Token Driver Ledger create-once conflict.'); return { status: 'DUPLICATE_SKIPPED', ledger_id: ledger.ledger_id }; } await mkdir(dirname(this.filePath), { recursive: true }); await writeFile(this.filePath, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); return { status: 'WRITTEN', ledger_id: ledger.ledger_id }; }
}
