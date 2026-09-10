import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCommand, RISK_LEVELS } from '../src/commands/contract.mjs';
import {
  CONFIRMATION_GATE_DECISIONS,
  evaluateConfirmationGate,
} from '../src/commands/confirmation-gate.mjs';
import { evaluateCommandPolicy } from '../src/rules/command-policy.mjs';

const NOW = '2026-08-10T09:00:00+08:00';

function gate(input) {
  const command = createCommand({ created_at: NOW, ...input });
  return evaluateConfirmationGate(command, evaluateCommandPolicy(command));
}

test('not_required low-risk local read passes the gate', () => {
  const result = gate({ command_id: 'gate_list', command_type: 'task.list', payload: {} });
  assert.equal(result.decision, CONFIRMATION_GATE_DECISIONS.ALLOW);
});

test('required and pending never imply consent', () => {
  for (const confirmation_state of ['required', 'pending']) {
    const result = gate({
      command_id: `gate_${confirmation_state}`,
      command_type: 'task.update',
      payload: { task_id: 'task_1', patch: { title: 'Updated' } },
      requires_confirmation: true,
      confirmation_state,
    });
    assert.equal(result.decision, CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED);
    assert.equal(result.code, 'CONFIRMATION_REQUIRED');
  }
});

test('confirmed passes only when the existing command policy allows', () => {
  const result = gate({
    command_id: 'gate_confirmed',
    command_type: 'task.update',
    payload: { task_id: 'task_1', patch: { title: 'Updated' } },
    requires_confirmation: true,
    confirmation_state: 'confirmed',
  });
  assert.equal(result.decision, CONFIRMATION_GATE_DECISIONS.ALLOW);
});

test('rejected and expired are denied', () => {
  for (const confirmation_state of ['rejected', 'expired']) {
    const result = gate({
      command_id: `gate_${confirmation_state}`,
      command_type: 'task.delete',
      payload: { task_id: 'task_1' },
      confirmation_state,
    });
    assert.equal(result.decision, CONFIRMATION_GATE_DECISIONS.DENIED);
    assert.equal(result.code, 'DENIED');
  }
});

test('delete requires confirmed even when an envelope understates its risk', () => {
  const result = gate({
    command_id: 'gate_delete_understated',
    command_type: 'task.delete',
    payload: { task_id: 'task_1' },
    risk_level: RISK_LEVELS.LOW,
    requires_confirmation: false,
    confirmation_state: 'not_required',
  });
  assert.equal(result.decision, CONFIRMATION_GATE_DECISIONS.CONFIRMATION_REQUIRED);
  assert.equal(result.reason, 'delete_requires_confirmation');
});
