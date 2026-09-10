import { stableSha256 } from './contracts.mjs';

function lexicalTokens(value) { return Math.max(1, Math.ceil(String(value ?? '').normalize('NFC').length / 4)); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }

function purposes(unit) {
  const result = [{ name: 'primary_execution', feedback: false, acceptance_reread: false }];
  if (unit.tests_required) result.push({ name: 'test_feedback_analysis', feedback: true, acceptance_reread: false });
  if (unit.task_type === 'DEBUG') result.push({ name: 'diagnosis_and_repair', feedback: true, acceptance_reread: false });
  if (unit.review_required) result.push({ name: 'review_or_acceptance', feedback: false, acceptance_reread: true });
  return result;
}

function contextComponents(unit, brief, purpose, callIndex) {
  const components = [
    { component: 'task_instruction', tokens: 90 + lexicalTokens(unit.description) + lexicalTokens(unit.expected_output), reusable: true },
    { component: 'project_brief', tokens: 140 + lexicalTokens(brief.project_goal) + lexicalTokens(brief.product_scope.join(' ')) + lexicalTokens(brief.planned_features.join(' ')), reusable: true },
    { component: 'required_context', tokens: 80 + lexicalTokens(unit.required_context.join(' ')), reusable: true },
    { component: 'existing_files', tokens: unit.estimated_files_read * 650, reusable: true },
    { component: 'contracts_and_interfaces', tokens: (unit.task_type === 'ARCHITECTURE' || unit.task_type === 'INTEGRATION' || unit.task_type === 'LEGACY_RECONCILIATION' ? 900 : 240), reusable: true },
  ];
  if (purpose.feedback) components.push({ component: 'test_or_diagnostic_feedback', tokens: 550 + unit.risk_factors.length * 130, reusable: false });
  if (purpose.acceptance_reread) components.push({ component: 'acceptance_context_refresh', tokens: 300 + unit.estimated_files_changed * 320, reusable: false });
  if (callIndex > 0) components.push({ component: 'prior_execution_summary', tokens: 260 + unit.estimated_files_changed * 120, reusable: false });
  return components;
}

function outputComponents(unit, purpose) {
  const components = [{ component: 'structured_response', tokens: 80 + lexicalTokens(unit.expected_output) }];
  if (['CODE_IMPLEMENTATION','DEBUG','INTEGRATION','LEGACY_RECONCILIATION'].includes(unit.task_type)) components.push({ component: 'code_or_contract_changes', tokens: 480 + unit.estimated_files_changed * 720 });
  if (unit.tests_required) components.push({ component: purpose.feedback ? 'test_analysis' : 'test_definition', tokens: purpose.feedback ? 430 : 620 });
  if (unit.task_type === 'DOCUMENTATION' || unit.task_type === 'FINAL_ACCEPTANCE' || unit.task_type === 'CODE_REVIEW') components.push({ component: 'report_or_findings', tokens: 620 + unit.source_facts.length * 80 });
  return components;
}

export function estimateCallsForWorkUnit(unit, brief) {
  const plan = purposes(unit);
  return plan.map((purpose, index) => {
    const context = contextComponents(unit, brief, purpose, index);
    const output = outputComponents(unit, purpose);
    const inputTokens = sum(context.map((item) => item.tokens));
    const cachedInputTokens = index === 0 ? 0 : sum(context.filter((item) => item.reusable).map((item) => item.tokens));
    const outputTokens = sum(output.map((item) => item.tokens));
    const reasoningTokens = ['CHAT_REASONING','CODEX'].includes(unit.recommended_model_class)
      ? 180 + lexicalTokens(unit.description) * 2 + unit.risk_factors.length * 100 + (purpose.feedback ? 260 : 0)
      : null;
    const callId = `call_${stableSha256({ work_unit_id: unit.work_unit_id, purpose: purpose.name, index })}`;
    return {
      call_id: callId, purpose: purpose.name, model_class: unit.recommended_model_class,
      execution_role: unit.execution_role, billing_mode: unit.billing_mode,
      input_tokens: inputTokens, cached_input_tokens: cachedInputTokens, output_tokens: outputTokens,
      reasoning_tokens: reasoningTokens, total_tokens: inputTokens + outputTokens + (reasoningTokens ?? 0),
      context_components: context, output_components: output,
      estimate_basis: [
        `semantic_task_type:${unit.task_type}`,
        `project_features:${brief.planned_features.length}`,
        `files_read:${unit.estimated_files_read}`,
        `files_changed:${unit.estimated_files_changed}`,
        `call_purpose:${purpose.name}`,
      ],
    };
  });
}
