import { assertNoSensitiveData } from '../credential-provider.mjs';
import { stableSha256 } from './contracts.mjs';
import { ESTIMATOR_SELECTION_POLICY_V01, evaluateEstimatorApplicability } from './estimator-applicability.mjs';

function triple(value, type) {
  if (type === 'PRODUCTION') return {
    optimistic: value.optimistic_path.total_tokens,
    expected: value.expected_path.total_tokens,
    conservative: value.conservative_path.total_tokens
  };
  const path = name => value[name]?.total_tokens ?? value.paths?.[name]?.total_tokens;
  return { optimistic: path('optimistic'), expected: path('expected'), conservative: path('conservative') };
}

function identity(value, type) { return type === 'PRODUCTION' ? value.forecast_id : (value.shadow_forecast_id ?? value.expected?.shadow_id ?? null); }

export function createConditionalForecast({ graph, productionForecast, shadowForecast, source_refs = {} }) {
  assertNoSensitiveData({ graph, productionForecast, shadowForecast }, 'Conditional estimator input');
  const { audit, decision } = evaluateEstimatorApplicability({ graph });
  if (decision.status === 'INVALID_INPUT') return { status: 'INVALID_INPUT', audit, decision, conditional_forecast: null };
  const production = triple(productionForecast, 'PRODUCTION');
  const shadow = triple(shadowForecast, 'SHADOW_V1');
  if (Object.values(production).some(x => !Number.isInteger(x) || x < 0) || Object.values(shadow).some(x => !Number.isInteger(x) || x < 0)) {
    const error = new Error('Both estimator paths must provide non-negative integer Forecast values.'); error.code = 'CONDITIONAL_FORECAST_PATH_INVALID'; throw error;
  }
  const selected = decision.selected_estimator === 'SHADOW_V1' ? shadow : production;
  const selectedSource = decision.selected_estimator === 'SHADOW_V1' ? shadowForecast : productionForecast;
  const value = {
    schema_version: '0.1', record_type: 'CONDITIONAL_FORECAST', conditional_forecast_id: '',
    policy_version: ESTIMATOR_SELECTION_POLICY_V01.policy_version, policy_status: 'EXPERIMENTAL',
    decision_id: decision.decision_id, applicability_status: decision.status, selected_estimator: decision.selected_estimator,
    fallback_applied: decision.fallback_applied,
    selected_forecast_identity: identity(selectedSource, decision.selected_estimator),
    selected_forecast: structuredClone(selected),
    estimator_candidates: {
      production: { identity: identity(productionForecast, 'PRODUCTION'), forecast: production, source_ref: source_refs.production ?? null },
      shadow_v1: { identity: identity(shadowForecast, 'SHADOW_V1'), forecast: shadow, source_ref: source_refs.shadow_v1 ?? null }
    },
    graph_id: graph.graph_id, feature_audit_id: audit.audit_id,
    truthfulness: { selected_path_recalculated: false, production_mutated: false, shadow_v1_mutated: false, actual_used_for_selection: false, outcome_used_for_selection: false, token_total_used_for_selection: false, fixed_multiplier: false, production_default_changed: false },
    metadata: { experimental_only: true, automatic_routing_authorized: false }
  };
  value.conditional_forecast_id = `conditional_forecast_${stableSha256({ ...value, conditional_forecast_id: undefined })}`;
  return { status: 'READY', audit, decision, conditional_forecast: value };
}

export function compareConditionalReplay({ decision, production_forecast, shadow_forecast, actual_total_tokens, evidence_class, evidence_source_ref }) {
  assertNoSensitiveData({ decision, production_forecast, shadow_forecast, evidence_class, evidence_source_ref }, 'Conditional replay');
  if (!Number.isInteger(actual_total_tokens) || actual_total_tokens < 0) { const error = new Error('Actual total must be a non-negative observed integer.'); error.code = 'CONDITIONAL_REPLAY_ACTUAL_INVALID'; throw error; }
  if (!decision?.decision_id || !['PRODUCTION', 'SHADOW_V1'].includes(decision.selected_estimator)) { const error = new Error('A frozen applicability decision is required.'); error.code = 'CONDITIONAL_REPLAY_DECISION_INVALID'; throw error; }
  const productionError = Math.abs(production_forecast.expected - actual_total_tokens);
  const shadowError = Math.abs(shadow_forecast.expected - actual_total_tokens);
  const selectedError = decision.selected_estimator === 'SHADOW_V1' ? shadowError : productionError;
  const otherError = decision.selected_estimator === 'SHADOW_V1' ? productionError : shadowError;
  const better = productionError === shadowError ? 'TIE' : (productionError < shadowError ? 'PRODUCTION' : 'SHADOW_V1');
  const value = {
    schema_version: '0.1', record_type: 'CONDITIONAL_REPLAY_COMPARISON', replay_id: '',
    decision_id: decision.decision_id, decision_frozen_before_actual: true,
    applicability_status: decision.status, selected_estimator: decision.selected_estimator,
    evidence_class, evidence_source_ref,
    actual_total_tokens,
    production_forecast: structuredClone(production_forecast), shadow_forecast: structuredClone(shadow_forecast),
    production_expected_absolute_error: productionError, shadow_expected_absolute_error: shadowError,
    selected_expected_absolute_error: selectedError, unselected_expected_absolute_error: otherError,
    better_estimator_after_actual: better,
    replay_outcome: better === 'TIE' || better === decision.selected_estimator ? 'SELECTION_SUPPORTED' : (decision.selected_estimator === 'PRODUCTION' ? 'CONSERVATIVE_PRODUCTION_TRADEOFF' : 'SELECTION_NOT_SUPPORTED'),
    truthfulness: { actual_entered_after_decision: true, decision_recomputed_after_actual: false, evidence_class_preserved: true, fixed_multiplier: false },
    metadata: { production_default_changed: false, replay_only: true }
  };
  value.replay_id = `conditional_replay_${stableSha256({ ...value, replay_id: undefined })}`;
  return value;
}

export function renderConditionalReplayMarkdown(records) {
  const rows = records.map(x => `| ${x.evidence_source_ref} | ${x.evidence_class} | ${x.applicability_status} | ${x.selected_estimator} | ${x.production_expected_absolute_error} | ${x.shadow_expected_absolute_error} | ${x.replay_outcome} |`).join('\n');
  return `# Conditional Estimator Replay Report\n\n| Evidence source | Evidence class | Gate | Selected | Production error | Shadow V1 error | Outcome |\n|---|---|---|---|---:|---:|---|\n${rows}\n\n## Integrity\n\n- Decisions frozen before Actual comparison: \`PASS\`\n- Evidence classes preserved: \`PASS\`\n- Goal identity passed to Gate: \`NO\`\n- Actual passed to Gate: \`NO\`\n- Token threshold routing: \`NO\`\n- Fixed multiplier: \`NO\`\n- Production default changed: \`NO\`\n`;
}

export function renderSelectionPolicyMarkdown() {
  const p = ESTIMATOR_SELECTION_POLICY_V01;
  return `# Estimator Selection Policy V0.1\n\n- Status: \`${p.status}\`\n- Default estimator: \`${p.default_estimator}\`\n- Ambiguous fallback: \`${p.fallback.AMBIGUOUS}\`\n- Insufficient-evidence fallback: \`${p.fallback.INSUFFICIENT_EVIDENCE}\`\n- Production default changed: \`NO\`\n\n## Shadow applicability\n\nShadow V1 is applicable only when the pre-execution Work Graph is a sufficiently substantial, continuous execution structure with at most ${p.shadow_trigger.maximum_execution_sessions} inferred Sessions, role/model continuity of at least ${p.shadow_trigger.minimum_role_model_continuity_ratio}, and repeated reusable-context opportunity of at least ${p.shadow_trigger.minimum_reusable_context_repeat_ratio}. Work Unit count is semantic scope evidence, never a Token threshold.\n\n## Counter-trigger\n\nProduction is preferred when execution is fragmented across at least ${p.production_counter_trigger.minimum_execution_sessions} Sessions or role/model continuity is below ${p.production_counter_trigger.role_model_continuity_below}.\n\n## Prohibited selection inputs\n\n${p.forbidden_selection_inputs.map(x => `- \`${x}\``).join('\n')}\n\nThis policy is experimental and does not authorize automatic model routing, quota consumption, API execution, or Production promotion.\n`;
}
