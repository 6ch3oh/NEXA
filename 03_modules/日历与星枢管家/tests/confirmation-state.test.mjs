import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONFIRMATION_STATES,
  CONFIRMATION_STATE_LIST,
  createConfirmation,
  validateConfirmation,
  transitionConfirmation,
  canTransitionConfirmation,
  isConfirmationExpiredAt,
} from '../src/domain/confirmation-state.mjs';
import { createCommand, validateCommand } from '../src/commands/contract.mjs';
import { evaluateCommandPolicy, COMMAND_POLICY_DECISIONS } from '../src/rules/command-policy.mjs';

const REQUESTED = '2026-08-10T08:00:00+08:00';
const EXPIRES = '2026-08-10T09:00:00+08:00';

function requiredConfirmation(overrides = {}) {
  return createConfirmation({
    confirmation_id: 'confirmation_1',
    command_id: 'command_1',
    state: CONFIRMATION_STATES.REQUIRED,
    reason: 'Explicit user confirmation is required',
    requested_at: REQUESTED,
    expires_at: EXPIRES,
    ...overrides,
  });
}

test('confirmation state contract exposes all six fixed states', () => {
  assert.deepEqual(CONFIRMATION_STATE_LIST, [
    'not_required', 'required', 'pending', 'confirmed', 'rejected', 'expired',
  ]);
});

test('not_required carries the full contract with null lifecycle timestamps', () => {
  const confirmation = createConfirmation({
    confirmation_id: 'none', command_id: 'read', state: 'not_required', reason: '',
  });
  assert.deepEqual(confirmation, {
    confirmation_id: 'none', command_id: 'read', state: 'not_required', reason: '',
    requested_at: null, resolved_at: null, expires_at: null,
  });
});

test('required transitions deterministically through pending to confirmed', () => {
  const required = requiredConfirmation();
  const pending = transitionConfirmation(required, 'pending', { now: '2026-08-10T08:01:00+08:00' });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.resolved_at, null);
  const confirmed = transitionConfirmation(pending, 'confirmed', {
    now: '2026-08-10T08:05:00+08:00', reason: 'User confirmed',
  });
  assert.equal(confirmed.state, 'confirmed');
  assert.equal(confirmed.resolved_at, '2026-08-10T08:05:00+08:00');
  assert.equal(confirmed.reason, 'User confirmed');
});

test('confirmation can be rejected or expire only at its explicit boundary', () => {
  const rejected = transitionConfirmation(requiredConfirmation(), 'rejected', {
    now: '2026-08-10T08:10:00+08:00', reason: 'No',
  });
  assert.equal(rejected.state, 'rejected');
  assert.equal(isConfirmationExpiredAt(rejected, EXPIRES), true);
  assert.throws(
    () => transitionConfirmation(requiredConfirmation(), 'expired', { now: '2026-08-10T08:59:59+08:00' }),
    /before expires_at/,
  );
  const expired = transitionConfirmation(requiredConfirmation(), 'expired', { now: EXPIRES });
  assert.equal(expired.state, 'expired');
});

test('terminal and illegal confirmation transitions fail closed', () => {
  assert.equal(canTransitionConfirmation('pending', 'confirmed'), true);
  assert.equal(canTransitionConfirmation('confirmed', 'pending'), false);
  const confirmed = transitionConfirmation(requiredConfirmation(), 'confirmed', {
    now: '2026-08-10T08:05:00+08:00',
  });
  assert.throws(() => transitionConfirmation(confirmed, 'pending', { now: '2026-08-10T08:06:00+08:00' }), /Illegal/);
  assert.throws(() => validateConfirmation({ state: 'guessed' }), /Invalid state/);
  assert.throws(() => requiredConfirmation({ requested_at: '2026-08-10T08:00:00' }), /explicit offset/);
});

test('Command Schema V0.2 preserves legacy calls and adds deterministic defaults', () => {
  const legacy = createCommand({
    command_id: 'legacy', command_type: 'task.list', payload: {}, created_at: REQUESTED,
  });
  assert.equal(legacy.confirmation_state, 'not_required');
  assert.equal(legacy.source, 'local');
  const high = createCommand({ command_id: 'high', command_type: 'task.delete', payload: {}, created_at: REQUESTED });
  assert.equal(high.requires_confirmation, true);
  assert.equal(high.confirmation_state, 'required');
});

test('Command Schema V0.2 rejects inconsistent confirmation state', () => {
  assert.throws(() => validateCommand({
    command_id: 'bad', command_type: 'task.list', payload: {}, created_at: REQUESTED,
    risk_level: 'low', requires_confirmation: false, confirmation_state: 'confirmed', source: 'local',
  }), /not_required/);
  assert.throws(() => createCommand({
    command_type: 'task.delete', payload: {}, created_at: REQUESTED, confirmation_state: 'not_required',
  }), /cannot use/);
});

test('confirmation fixtures validate and produce the declared policy decisions', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/confirmation-cases.json', import.meta.url), 'utf8'));
  assert.equal(fixture.cases.length, 6);
  for (const item of fixture.cases) {
    assert.equal(validateConfirmation(item.confirmation).state, item.confirmation.state, item.name);
    const command = createCommand(item.command);
    const policy = evaluateCommandPolicy(command);
    assert.equal(policy.decision, item.expected_policy, item.name);
    assert.equal(policy.executable, false, 'policy never executes commands');
  }
});

test('confirmed allows only at policy layer while rejected and expired deny', () => {
  const base = {
    command_type: 'task.delete', payload: { id: 't' }, created_at: REQUESTED,
    requires_confirmation: true, source: 'local',
  };
  assert.equal(evaluateCommandPolicy(createCommand({ ...base, confirmation_state: 'confirmed' })).decision, COMMAND_POLICY_DECISIONS.ALLOW);
  assert.equal(evaluateCommandPolicy(createCommand({ ...base, confirmation_state: 'rejected' })).decision, COMMAND_POLICY_DECISIONS.DENY);
  assert.equal(evaluateCommandPolicy(createCommand({ ...base, confirmation_state: 'expired' })).decision, COMMAND_POLICY_DECISIONS.DENY);
});

test('unknown, malformed, and untrusted commands fail closed', () => {
  assert.equal(evaluateCommandPolicy({
    command_id: 'unknown', command_type: 'task.launch', payload: {}, created_at: REQUESTED,
    risk_level: 'low', requires_confirmation: false, confirmation_state: 'not_required', source: 'local',
  }).decision, 'deny');
  assert.equal(evaluateCommandPolicy(null).decision, 'deny');
  assert.equal(evaluateCommandPolicy(createCommand({
    command_type: 'task.list', payload: {}, created_at: REQUESTED, source: 'remote',
  })).decision, 'deny');
});
