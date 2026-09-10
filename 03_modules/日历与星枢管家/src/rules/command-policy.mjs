import { validateCommand, RISK_LEVELS } from '../commands/contract.mjs';
import { CONFIRMATION_STATES } from '../domain/confirmation-state.mjs';

export const COMMAND_POLICY_DECISIONS = Object.freeze({
  ALLOW: 'allow',
  REQUIRE_CONFIRMATION: 'require_confirmation',
  DENY: 'deny',
});

function decision(command, value, reason) {
  return Object.freeze({
    command_id: typeof command?.command_id === 'string' ? command.command_id : null,
    command_type: typeof command?.command_type === 'string' ? command.command_type : null,
    decision: value,
    reason,
    executable: false,
  });
}

export function evaluateCommandPolicy(command) {
  let normalized;
  try {
    normalized = validateCommand(command);
  } catch (error) {
    return decision(command, COMMAND_POLICY_DECISIONS.DENY, `invalid_or_unknown_command:${error.message}`);
  }

  if (normalized.source !== 'local') {
    return decision(normalized, COMMAND_POLICY_DECISIONS.DENY, 'untrusted_command_source');
  }
  if (normalized.confirmation_state === CONFIRMATION_STATES.REJECTED) {
    return decision(normalized, COMMAND_POLICY_DECISIONS.DENY, 'confirmation_rejected');
  }
  if (normalized.confirmation_state === CONFIRMATION_STATES.EXPIRED) {
    return decision(normalized, COMMAND_POLICY_DECISIONS.DENY, 'confirmation_expired');
  }
  if (normalized.requires_confirmation) {
    if (normalized.confirmation_state === CONFIRMATION_STATES.CONFIRMED) {
      return decision(normalized, COMMAND_POLICY_DECISIONS.ALLOW, 'confirmed_by_policy_only');
    }
    return decision(normalized, COMMAND_POLICY_DECISIONS.REQUIRE_CONFIRMATION, 'confirmation_not_resolved');
  }
  if (
    normalized.risk_level === RISK_LEVELS.LOW &&
    (normalized.command_type === 'task.list' || normalized.command_type === 'calendar.list')
  ) {
    return decision(normalized, COMMAND_POLICY_DECISIONS.ALLOW, 'local_read_allowed');
  }
  return decision(normalized, COMMAND_POLICY_DECISIONS.ALLOW, 'confirmation_not_required_by_contract');
}

export const decideCommandPolicy = evaluateCommandPolicy;
