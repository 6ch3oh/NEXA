import { assertNoSensitiveData } from '../credential-provider.mjs';
import { assertValidWorkGraph, stableSha256 } from './contracts.mjs';
import { buildExecutionSessions } from './session-aware-forecast.mjs';

export const APPLICABILITY_STATUSES = Object.freeze([
  'SHADOW_APPLICABLE',
  'PRODUCTION_PREFERRED',
  'INSUFFICIENT_EVIDENCE',
  'AMBIGUOUS',
  'INVALID_INPUT'
]);

export const ESTIMATOR_SELECTION_POLICY_V01 = Object.freeze({
  schema_version: '0.1',
  record_type: 'ESTIMATOR_SELECTION_POLICY',
  policy_version: 'SHADOW_APPLICABILITY_GATE/V0.1',
  status: 'EXPERIMENTAL',
  eligible_estimators: ['PRODUCTION', 'SHADOW_V1'],
  default_estimator: 'PRODUCTION',
  fallback: {
    INSUFFICIENT_EVIDENCE: 'PRODUCTION',
    AMBIGUOUS: 'PRODUCTION'
  },
  shadow_trigger: {
    minimum_semantic_work_units: 24,
    maximum_execution_sessions: 2,
    minimum_role_model_continuity_ratio: 0.9,
    minimum_reusable_context_repeat_ratio: 0.7
  },
  production_counter_trigger: {
    minimum_execution_sessions: 3,
    role_model_continuity_below: 0.8
  },
  evidence_basis: [
    'Pre-execution Work Graph semantic structure',
    'Execution Session boundaries inferred from role, model class, and explicit safety/context boundaries',
    'Reusable context opportunities declared in planned call context components',
    'Retained fragmented counterevidence and independent prospective continuous-goal support'
  ],
  forbidden_selection_inputs: [
    'goal_id',
    'case_id',
    'actual_tokens',
    'forecast_error',
    'closeout_winner',
    'token_total',
    'token_threshold'
  ],
  truthfulness: {
    actual_available_to_gate: false,
    outcome_available_to_gate: false,
    goal_identity_available_to_gate: false,
    token_total_routing: false,
    fixed_multiplier: false,
    classifier: false,
    randomness: false,
    automatic_production_promotion: false
  }
});

const ratio = (numerator, denominator) => denominator === 0 ? 0 : numerator / denominator;
const round = value => Number(value.toFixed(6));

export function buildApplicabilityFeatureAudit({ graph }) {
  assertNoSensitiveData(graph, 'Estimator applicability graph');
  assertValidWorkGraph(graph);
  const units = graph.work_units;
  const inferred = buildExecutionSessions({ graph });
  let continuousPairs = 0;
  let reusableComponents = 0;
  let repeatedReusableComponents = 0;
  let modelCalls = 0;
  let reviewBoundaries = 0;
  const seenReusable = new Set();

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (index > 0) {
      const previous = units[index - 1];
      if (previous.execution_role === unit.execution_role && previous.recommended_model_class === unit.recommended_model_class) continuousPairs += 1;
    }
    if (unit.review_required || ['CODE_REVIEW', 'FINAL_ACCEPTANCE', 'TEST_ANALYSIS'].includes(unit.task_type)) reviewBoundaries += 1;
    modelCalls += unit.call_estimates.length;
    for (const call of unit.call_estimates) {
      for (const component of call.context_components) {
        if (!component.reusable) continue;
        reusableComponents += 1;
        const key = `${component.component}:${component.tokens}`;
        if (seenReusable.has(key)) repeatedReusableComponents += 1;
        seenReusable.add(key);
      }
    }
  }

  const features = {
    work_unit_count: units.length,
    phase_count: new Set(units.map(unit => unit.phase)).size,
    model_call_count: modelCalls,
    execution_session_count: inferred.sessions.length,
    independent_boundary_count: Math.max(0, inferred.sessions.length - 1),
    review_boundary_count: reviewBoundaries,
    role_model_continuity_ratio: round(ratio(continuousPairs, Math.max(0, units.length - 1))),
    context_reset_pressure: round(ratio(Math.max(0, inferred.sessions.length - 1), Math.max(0, units.length - 1))),
    reusable_context_component_count: reusableComponents,
    repeated_reusable_context_component_count: repeatedReusableComponents,
    reusable_context_repeat_ratio: round(ratio(repeatedReusableComponents, reusableComponents)),
    execution_mode: inferred.execution_mode
  };
  const audit = {
    schema_version: '0.1',
    record_type: 'APPLICABILITY_FEATURE_AUDIT',
    audit_id: '',
    graph_id: graph.graph_id,
    path_type: graph.path_type,
    features,
    session_boundary_reasons: inferred.sessions.map(session => session.reset_reason),
    input_boundary: {
      pre_execution_only: true,
      actual_received: false,
      outcome_received: false,
      goal_identity_received: false,
      token_totals_used_for_routing: false
    },
    metadata: {
      feature_engine: 'APPLICABILITY_FEATURE_AUDIT/V0.1',
      actual_fields: null,
      fixed_multiplier: false
    }
  };
  audit.audit_id = `applicability_audit_${stableSha256({ ...audit, audit_id: undefined })}`;
  return audit;
}

function invalidDecision(error) {
  const value = {
    schema_version: '0.1', record_type: 'ESTIMATOR_APPLICABILITY_DECISION', decision_id: '',
    policy_version: ESTIMATOR_SELECTION_POLICY_V01.policy_version, status: 'INVALID_INPUT', selected_estimator: null,
    fallback_applied: false, feature_audit_id: null, feature_snapshot: null,
    trigger_results: { shadow_trigger: false, production_counter_trigger: false },
    reason_codes: ['WORK_GRAPH_INVALID'], explanation: ['The supplied Work Graph did not satisfy the canonical contract.'],
    invalid_input_code: error?.code ?? 'WORK_GRAPH_INVALID',
    input_boundary: { pre_execution_only: true, actual_received: false, outcome_received: false, goal_identity_received: false, token_totals_used_for_routing: false },
    metadata: { experimental_only: true, production_default_changed: false }
  };
  value.decision_id = `applicability_decision_${stableSha256({ ...value, decision_id: undefined })}`;
  return value;
}

export function evaluateEstimatorApplicability({ graph }) {
  let audit;
  try { audit = buildApplicabilityFeatureAudit({ graph }); } catch (error) { return { audit: null, decision: invalidDecision(error) }; }
  const f = audit.features;
  const insufficient = f.work_unit_count < 6 || f.model_call_count < f.work_unit_count || f.reusable_context_component_count === 0;
  const shadow = !insufficient
    && f.work_unit_count >= ESTIMATOR_SELECTION_POLICY_V01.shadow_trigger.minimum_semantic_work_units
    && f.execution_session_count <= ESTIMATOR_SELECTION_POLICY_V01.shadow_trigger.maximum_execution_sessions
    && f.role_model_continuity_ratio >= ESTIMATOR_SELECTION_POLICY_V01.shadow_trigger.minimum_role_model_continuity_ratio
    && f.reusable_context_repeat_ratio >= ESTIMATOR_SELECTION_POLICY_V01.shadow_trigger.minimum_reusable_context_repeat_ratio;
  const production = !insufficient
    && (f.execution_session_count >= ESTIMATOR_SELECTION_POLICY_V01.production_counter_trigger.minimum_execution_sessions
      || f.role_model_continuity_ratio < ESTIMATOR_SELECTION_POLICY_V01.production_counter_trigger.role_model_continuity_below);

  let status;
  let selected;
  let fallback = false;
  let reasons;
  if (insufficient) { status = 'INSUFFICIENT_EVIDENCE'; selected = 'PRODUCTION'; fallback = true; reasons = ['SEMANTIC_EVIDENCE_INSUFFICIENT', 'CONSERVATIVE_PRODUCTION_FALLBACK']; }
  else if (shadow && production) { status = 'AMBIGUOUS'; selected = 'PRODUCTION'; fallback = true; reasons = ['CONFLICTING_TRIGGER_EVIDENCE', 'CONSERVATIVE_PRODUCTION_FALLBACK']; }
  else if (shadow) { status = 'SHADOW_APPLICABLE'; selected = 'SHADOW_V1'; reasons = ['LONG_CONTINUOUS_WORK_GRAPH', 'LOW_SESSION_FRAGMENTATION', 'HIGH_ROLE_MODEL_CONTINUITY', 'REUSABLE_CONTEXT_OPPORTUNITY']; }
  else if (production) { status = 'PRODUCTION_PREFERRED'; selected = 'PRODUCTION'; reasons = ['FRAGMENTED_EXECUTION_STRUCTURE', 'PRODUCTION_COUNTER_TRIGGER']; }
  else { status = 'AMBIGUOUS'; selected = 'PRODUCTION'; fallback = true; reasons = ['NO_DECISIVE_SEMANTIC_TRIGGER', 'CONSERVATIVE_PRODUCTION_FALLBACK']; }

  const decision = {
    schema_version: '0.1', record_type: 'ESTIMATOR_APPLICABILITY_DECISION', decision_id: '',
    policy_version: ESTIMATOR_SELECTION_POLICY_V01.policy_version, status, selected_estimator: selected,
    fallback_applied: fallback, feature_audit_id: audit.audit_id, feature_snapshot: structuredClone(f),
    trigger_results: { shadow_trigger: shadow, production_counter_trigger: production },
    reason_codes: reasons,
    explanation: reasons.map(reason => reason.replaceAll('_', ' ').toLowerCase()),
    invalid_input_code: null,
    input_boundary: structuredClone(audit.input_boundary),
    metadata: { experimental_only: true, production_default_changed: false }
  };
  decision.decision_id = `applicability_decision_${stableSha256({ ...decision, decision_id: undefined })}`;
  return { audit, decision };
}

export function renderApplicabilityMarkdown({ audit, decision }) {
  const f = audit?.features;
  return `# Estimator Applicability Decision\n\n- Status: \`${decision.status}\`\n- Selected estimator: \`${decision.selected_estimator ?? 'NONE'}\`\n- Fallback applied: \`${decision.fallback_applied}\`\n- Policy: \`${decision.policy_version}\`\n- Decision ID: \`${decision.decision_id}\`\n\n## Pre-execution semantic features\n\n${f ? `| Feature | Value |\n|---|---:|\n| Work Units | ${f.work_unit_count} |\n| Model calls | ${f.model_call_count} |\n| Execution Sessions | ${f.execution_session_count} |\n| Role/model continuity | ${f.role_model_continuity_ratio} |\n| Context reset pressure | ${f.context_reset_pressure} |\n| Reusable context repeat ratio | ${f.reusable_context_repeat_ratio} |` : 'INVALID INPUT'}\n\n## Reasons\n\n${decision.reason_codes.map(x => `- \`${x}\``).join('\n')}\n\n## Hindsight firewall\n\n- Actual available to Gate: \`false\`\n- Outcome available to Gate: \`false\`\n- Goal identity available to Gate: \`false\`\n- Token total routing: \`false\`\n- Production default changed: \`false\`\n`;
}
