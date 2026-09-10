import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCommand,
  validateCommand,
  COMMAND_TYPES,
  RISK_LEVELS,
  RISK_LEVEL_LIST,
  defaultRiskForCommandType,
} from '../src/commands/contract.mjs';

const ISO = '2026-08-10T09:00:00.000Z';

test('command envelope carries the full contract fields', () => {
  const cmd = createCommand({
    command_id: 'cmd_1',
    command_type: 'task.create',
    payload: { id: 't1', title: 'Write report' },
    created_at: ISO,
    risk_level: RISK_LEVELS.LOW,
  });
  assert.equal(cmd.command_id, 'cmd_1');
  assert.equal(cmd.command_type, 'task.create');
  assert.deepEqual(cmd.payload, { id: 't1', title: 'Write report' });
  assert.equal(cmd.created_at, ISO);
  assert.equal(cmd.risk_level, RISK_LEVELS.LOW);
  assert.equal(cmd.requires_confirmation, false);
});

test('all reserved task/calendar command types are valid', () => {
  for (const type of COMMAND_TYPES) {
    const cmd = createCommand({ command_id: `cmd_${type}`, command_type: type, payload: {}, created_at: ISO });
    assert.equal(cmd.command_type, type);
  }
  assert.equal(COMMAND_TYPES.length, 10);
});

test('high risk requires confirmation; low/medium do not by default', () => {
  const high = createCommand({ command_type: 'task.delete', payload: { id: 't1' }, created_at: ISO });
  assert.equal(high.risk_level, RISK_LEVELS.HIGH);
  assert.equal(high.requires_confirmation, true);
  assert.throws(
    () =>
      validateCommand({
        command_id: 'c',
        command_type: 'task.delete',
        payload: {},
        created_at: ISO,
        risk_level: RISK_LEVELS.HIGH,
        requires_confirmation: false,
      }),
    /requires_confirmation/,
  );
  const low = createCommand({ command_type: 'task.list', payload: {}, created_at: ISO });
  assert.equal(low.risk_level, RISK_LEVELS.LOW);
  assert.equal(low.requires_confirmation, false);
});

test('default risk mapping is deterministic', () => {
  assert.equal(defaultRiskForCommandType('task.list'), RISK_LEVELS.LOW);
  assert.equal(defaultRiskForCommandType('calendar.update'), RISK_LEVELS.MEDIUM);
  assert.equal(defaultRiskForCommandType('task.complete'), RISK_LEVELS.MEDIUM);
  assert.equal(defaultRiskForCommandType('calendar.delete'), RISK_LEVELS.HIGH);
  assert.equal(defaultRiskForCommandType('unknown.command'), RISK_LEVELS.LOW);
});

test('risk levels are the fixed low|medium|high enum', () => {
  assert.deepEqual(RISK_LEVEL_LIST, [RISK_LEVELS.LOW, RISK_LEVELS.MEDIUM, RISK_LEVELS.HIGH]);
});

test('invalid envelopes are rejected', () => {
  assert.throws(() => createCommand({ command_type: 'task.frobnicate', payload: {} }), /Unsupported command_type/);
  assert.throws(() => createCommand({ command_type: 'task.create', payload: null }), /payload/);
  assert.throws(() => createCommand({ command_type: 'task.create', payload: [] }), /payload/);
  assert.throws(() => createCommand({ command_type: 'task.create', payload: {}, created_at: 'yesterday' }), /created_at/);
  assert.throws(() => createCommand({ command_type: 'task.create', payload: {}, risk_level: 'extreme' }), /risk_level/);
  assert.throws(() => validateCommand(null), /must be an object/);
});

test('generated command_id and created_at are valid when omitted', () => {
  const cmd = createCommand({ command_type: 'task.create', payload: {} });
  assert.ok(cmd.command_id.startsWith('cmd_'));
  assert.ok(!Number.isNaN(Date.parse(cmd.created_at)));
  assert.equal(cmd.requires_confirmation, false);
});

test('explicit requires_confirmation can force confirmation on medium risk', () => {
  const cmd = createCommand({
    command_type: 'task.update',
    payload: {},
    created_at: ISO,
    requires_confirmation: true,
  });
  assert.equal(cmd.risk_level, RISK_LEVELS.MEDIUM);
  assert.equal(cmd.requires_confirmation, true);
});
