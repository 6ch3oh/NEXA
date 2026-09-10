import { CONFIRMATION_STATES } from '../domain/confirmation-state.mjs';
import { evaluateCommandPolicy, COMMAND_POLICY_DECISIONS } from '../rules/command-policy.mjs';

export const CONFIRMATION_GATE_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  CONFIRMATION_REQUIRED: 'confirmation_required',
  DENIED: 'denied',
});

const CONFIRMATION_MANDATORY_COMMAND_TYPES = Object.freeze([
  'task.delete',
  'calendar.delete',
  'planning.confirm_task_time',
  'planning.change_task_time',
  'planning.remove_task_time',
  'planning.confirm_carryover',
  'planning.reject_carryover',
]);

function result(decision, code, reason) {
  return Object.freeze({ decision, code, reason });
}

export function evaluateConfirmationGate(command, policyDecision = evaluateCommandPolicy(command)) {
  if (policyDecision.decision === COMMAND_POLICY_DECISIONS.DENY) {
    return result(CONFIRMATION_GATE_DECISIONS.DENIED, 'DENIED', policyDecision.reason);
  }
  if (policyDecision.decision === COMMAND_POLICY_DECISIONS.REQUIRE_CONFIRMATION) {
    return result(CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED, 'CONFIRMATION_REQUIRED', policyDecision.reason);
  }
  if (policyDecision.decision !== COMMAND_POLICY_DECISIONS.ALLOW) {
    return result(CONFIRMATION_GATE_DECISIONS.DENIED, 'DENIED', 'unknown_policy_decision');
  }
  if ([CONFIRMATION_STATES.REQUIRED, CONFIRMATION_STATES.PENDING].includes(command.confirmation_state)) {
    return result(CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED, 'CONFIRMATION_REQUIRED', 'confirmation_not_resolved');
  }
  if ([CONFIRMATION_STATES.REJECTED, CONFIRMATION_STATES.EXPIRED].includes(command.confirmation_state)) {
    return result(CONFIRMATION_GATE_DECISIONS.DENIED, 'DENIED', `confirmation_${command.confirmation_state}`);
  }
  if (
    CONFIRMATION_MANDATORY_COMMAND_TYPES.includes(command.command_type) &&
    command.confirmation_state !== CONFIRMATION_STATES.CONFIRMED
  ) {
    return result(
      CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED,
      'CONFIRMATION_REQUIRED',
      ['task.delete', 'calendar.delete'].includes(command.command_type)
        ? 'delete_requires_confirmation'
        : 'planning_action_requires_confirmation',
    );
  }
  if ([CONFIRMATION_STATES.NOT_REQUIRED, CONFIRMATION_STATES.CONFIRMED].includes(command.confirmation_state)) {
    return result(CONFIRMATION_GATE_DECISIONS.ALLOW, 'ALLOW', policyDecision.reason);
  }
  return result(CONFIRMATION_GATE_DECISIONS.DENIED, 'DENIED', 'unknown_confirmation_state');
}
