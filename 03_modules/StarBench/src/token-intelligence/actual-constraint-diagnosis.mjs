import { assertNoSensitiveData } from '../credential-provider.mjs';
import { stableSha256 } from './contracts.mjs';
import { assertValidTokenDriverLedger, TOKEN_DRIVER_COMPONENT_TYPES } from './token-driver-ledger.mjs';

const sum = (values) => values.reduce((total, value) => total + value, 0);
const status = (condition, partial = false) => condition ? 'SUPPORTED' : (partial ? 'PARTIAL' : 'NOT_SUPPORTED');

export function buildActualConstraintDiagnosis({ ledger, actual_total_tokens, actual_source_ref, diagnosed_at = null }) {
  assertValidTokenDriverLedger(ledger);
  if (!Number.isInteger(actual_total_tokens) || actual_total_tokens < 0) { const error = new Error('Actual total Token must be a non-negative authoritative integer.'); error.code = 'ACTUAL_TOTAL_CONSTRAINT_INVALID'; throw error; }
  const categoryTotals = Object.fromEntries(TOKEN_DRIVER_COMPONENT_TYPES.map((type) => [type, sum(ledger.drivers.filter((driver) => driver.component_type === type).map((driver) => driver.estimated_tokens))]));
  const purposeTotals = {};
  for (const driver of ledger.drivers) { const purpose = driver.source_context?.purpose; if (typeof purpose === 'string') purposeTotals[purpose] = (purposeTotals[purpose] ?? 0) + driver.estimated_tokens; }
  const componentImpossible = ledger.drivers.filter((driver) => driver.estimated_tokens > actual_total_tokens).map((driver) => ({ driver_id: driver.driver_id, component_type: driver.component_type, estimated_tokens: driver.estimated_tokens }));
  const categoryImpossible = [
    ...Object.entries(categoryTotals).filter(([, tokens]) => tokens > actual_total_tokens).map(([category, estimated_tokens]) => ({ category_type: 'COMPONENT_TYPE', category, estimated_tokens, excess_over_actual: estimated_tokens - actual_total_tokens })),
    ...Object.entries(purposeTotals).filter(([, tokens]) => tokens > actual_total_tokens).map(([category, estimated_tokens]) => ({ category_type: 'CALL_PURPOSE', category, estimated_tokens, excess_over_actual: estimated_tokens - actual_total_tokens })),
  ];
  const sessions = new Map(); for (const driver of ledger.drivers) sessions.set(driver.session_id, (sessions.get(driver.session_id) ?? 0) + driver.estimated_tokens);
  const sessionRows = [...sessions].map(([session_id, estimated_tokens]) => ({ session_id, estimated_tokens, ratio_to_actual: actual_total_tokens === 0 ? null : estimated_tokens / actual_total_tokens })).sort((a, b) => b.estimated_tokens - a.estimated_tokens);
  const highSessions = sessionRows.filter((row) => actual_total_tokens === 0 ? row.estimated_tokens > 0 : row.ratio_to_actual >= 0.75);
  const calls = new Set(ledger.drivers.map((driver) => driver.model_call_id));
  const fullContextCalls = new Set(ledger.drivers.filter((driver) => driver.component_type === 'BASE_CONTEXT' && driver.estimated_tokens > 0).map((driver) => driver.model_call_id));
  const controlCalls = new Set(ledger.drivers.filter((driver) => ['REVIEW','ACCEPTANCE','SESSION_CONTROL','TEST_ANALYSIS','DEBUG_ANALYSIS'].includes(driver.component_type)).map((driver) => driver.model_call_id));
  const callPressure = calls.size > ledger.audit.total_work_units && (fullContextCalls.size > sessions.size || controlCalls.size > sessions.size);
  const findings = [
    { finding_type: 'COMPONENT_IMPOSSIBLE', status: status(componentImpossible.length > 0), evidence: componentImpossible, explanation: componentImpossible.length ? 'At least one additive Forecast driver exceeds the whole authoritative Actual total.' : 'No single additive Forecast driver exceeds the whole authoritative Actual total.' },
    { finding_type: 'CATEGORY_IMPOSSIBLE', status: status(categoryImpossible.length > 0), evidence: categoryImpossible, explanation: categoryImpossible.length ? 'At least one Forecast category exceeds the whole Actual total; its decomposition cannot all coexist with the observed total without over-estimation or overlap.' : 'No Forecast category alone exceeds the whole Actual total.' },
    { finding_type: 'SESSION_PRESSURE', status: status(highSessions.length > 0, !highSessions.length && sessionRows.some((row) => row.ratio_to_actual !== null && row.ratio_to_actual >= 0.5)), evidence: sessionRows.slice(0, 10), explanation: 'This compares Forecast Session totals with the whole Actual upper bound; it does not infer Actual Session usage.' },
    { finding_type: 'CALL_COUNT_PRESSURE', status: status(callPressure, !callPressure && calls.size > ledger.audit.total_work_units), evidence: [{ total_model_calls: calls.size, total_work_units: ledger.audit.total_work_units, total_sessions: sessions.size, repeated_base_context_calls: fullContextCalls.size, control_or_analysis_calls: controlCalls.size }], explanation: 'Pressure is structural: modeled calls exceed Work Units and depend on repeated context or control/analysis calls. The real call count remains UNKNOWN.' },
  ];
  const pressure = [
    ...Object.entries(categoryTotals).filter(([, tokens]) => tokens > 0).map(([category, estimated_tokens]) => ({ category_type: 'COMPONENT_TYPE', component_type: category, category, estimated_tokens, ratio_to_actual: actual_total_tokens === 0 ? null : estimated_tokens / actual_total_tokens, constraint_status: estimated_tokens > actual_total_tokens ? 'IMPOSSIBLE_AS_STANDALONE_CATEGORY' : 'PRESSURE_ONLY' })),
    ...Object.entries(purposeTotals).filter(([, tokens]) => tokens > 0).map(([category, estimated_tokens]) => ({ category_type: 'CALL_PURPOSE', component_type: category, category, estimated_tokens, ratio_to_actual: actual_total_tokens === 0 ? null : estimated_tokens / actual_total_tokens, constraint_status: estimated_tokens > actual_total_tokens ? 'IMPOSSIBLE_AS_STANDALONE_CATEGORY' : 'PRESSURE_ONLY' })),
  ].sort((a, b) => b.estimated_tokens - a.estimated_tokens || a.category.localeCompare(b.category));
  const value = { schema_version: '0.1', record_type: 'ACTUAL_TOTAL_CONSTRAINT_DIAGNOSIS', diagnosis_id: '', case_id: ledger.case_id, ledger_id: ledger.ledger_id, forecast_id: ledger.forecast_id, estimator_version: ledger.estimator_version, path: ledger.path, actual_total_tokens, actual_source_ref, actual_component_status: 'UNKNOWN', actual_component_values: Object.fromEntries(TOKEN_DRIVER_COMPONENT_TYPES.map((type) => [type, null])), category_totals: categoryTotals, purpose_category_totals: purposeTotals, findings, top_overestimation_pressure: pressure.slice(0, 10), diagnosed_at, provenance: { forecast_decomposition_only: true, actual_total_as_upper_bound_only: true, actual_call_breakdown_known: false, actual_component_breakdown_known: false }, metadata: { actual_component_fabrication: 0, fixed_multiplier: false, goal_specific_rule: false, real_api_calls: 0, business_runtime_network: 0 } };
  value.diagnosis_id = `actual_constraint_${stableSha256({ ...value, diagnosis_id: undefined })}`;
  return assertValidActualConstraintDiagnosis(value);
}

export function assertValidActualConstraintDiagnosis(value) {
  assertNoSensitiveData(value, 'Actual Constraint Diagnosis');
  if (value?.schema_version !== '0.1' || value.record_type !== 'ACTUAL_TOTAL_CONSTRAINT_DIAGNOSIS' || !/^actual_constraint_[a-f0-9]{64}$/u.test(value.diagnosis_id ?? '') || `actual_constraint_${stableSha256({ ...value, diagnosis_id: undefined })}` !== value.diagnosis_id || value.actual_component_status !== 'UNKNOWN' || TOKEN_DRIVER_COMPONENT_TYPES.some((type) => value.actual_component_values?.[type] !== null) || !Array.isArray(value.findings) || value.findings.length !== 4 || value.findings.some((item) => !['SUPPORTED','PARTIAL','NOT_SUPPORTED','UNKNOWN'].includes(item.status)) || value.metadata?.actual_component_fabrication !== 0 || value.metadata?.fixed_multiplier !== false) { const error = new Error('Actual Total Constraint Diagnosis V0.1 is invalid.'); error.code = 'ACTUAL_CONSTRAINT_DIAGNOSIS_INVALID'; throw error; }
  return value;
}
