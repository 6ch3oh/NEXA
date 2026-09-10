import { randomUUID } from 'node:crypto';
import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';
import { CONFIRMATION_STATES, assertConfirmationState } from '../domain/confirmation-state.mjs';

export const RISK_LEVELS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

export const RISK_LEVEL_LIST = Object.freeze(Object.values(RISK_LEVELS));

export const DEFAULT_COMMAND_SOURCE = 'local';

export const COMMAND_TYPES = Object.freeze([
  'task.create',
  'task.update',
  'task.complete',
  'task.delete',
  'task.list',
  'calendar.create',
  'calendar.update',
  'calendar.complete',
  'calendar.delete',
  'calendar.list',
]);

// Kept separate so existing consumers that rely on the original V0.2 list keep
// seeing the same ten values while the local execution layer can expose reads.
export const LOCAL_COMMAND_TYPE_EXTENSIONS = Object.freeze([
  'task.get',
  'calendar.get',
]);

export const PLANNING_COMMAND_TYPES = Object.freeze([
  'planning.assign_task_to_day',
  'planning.confirm_task_time',
  'planning.change_task_time',
  'planning.remove_task_time',
  'planning.reorder_tasks',
  'planning.pin_plan',
  'planning.confirm_carryover',
  'planning.reject_carryover',
]);

export const VALID_COMMAND_TYPES = Object.freeze([
  ...COMMAND_TYPES,
  ...LOCAL_COMMAND_TYPE_EXTENSIONS,
  ...PLANNING_COMMAND_TYPES,
]);

const DEFAULT_RISK = new Map([
  ['task.list', RISK_LEVELS.LOW],
  ['task.get', RISK_LEVELS.LOW],
  ['calendar.list', RISK_LEVELS.LOW],
  ['calendar.get', RISK_LEVELS.LOW],
  ['task.create', RISK_LEVELS.LOW],
  ['calendar.create', RISK_LEVELS.LOW],
  ['task.update', RISK_LEVELS.MEDIUM],
  ['calendar.update', RISK_LEVELS.MEDIUM],
  ['task.complete', RISK_LEVELS.MEDIUM],
  ['calendar.complete', RISK_LEVELS.MEDIUM],
  ['task.delete', RISK_LEVELS.HIGH],
  ['calendar.delete', RISK_LEVELS.HIGH],
  ['planning.assign_task_to_day', RISK_LEVELS.MEDIUM],
  ['planning.confirm_task_time', RISK_LEVELS.HIGH],
  ['planning.change_task_time', RISK_LEVELS.HIGH],
  ['planning.remove_task_time', RISK_LEVELS.HIGH],
  ['planning.reorder_tasks', RISK_LEVELS.MEDIUM],
  ['planning.pin_plan', RISK_LEVELS.MEDIUM],
  ['planning.confirm_carryover', RISK_LEVELS.HIGH],
  ['planning.reject_carryover', RISK_LEVELS.HIGH],
]);

export function defaultRiskForCommandType(commandType) {
  return DEFAULT_RISK.get(commandType) ?? RISK_LEVELS.LOW;
}

export function validateCommand(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new TypeError('Command envelope must be an object');
  }
  const { command_id, command_type, payload, created_at, risk_level, requires_confirmation } = envelope;
  if (typeof command_id !== 'string' || command_id.trim() === '') {
    throw new TypeError('command_id must be a non-empty string');
  }
  if (!VALID_COMMAND_TYPES.includes(command_type)) {
    throw new TypeError(`Unsupported command_type "${command_type}"`);
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be a non-null object');
  }
  if (!isValidIsoTimestamp(created_at)) {
    throw new TypeError(`created_at must be a valid ISO timestamp, got "${created_at}"`);
  }
  if (!RISK_LEVEL_LIST.includes(risk_level)) {
    throw new TypeError(`Invalid risk_level "${risk_level}"`);
  }
  const confirmed = requires_confirmation ?? false;
  if (typeof confirmed !== 'boolean') {
    throw new TypeError('requires_confirmation must be a boolean');
  }
  if (risk_level === RISK_LEVELS.HIGH && confirmed !== true) {
    throw new TypeError('Commands with risk_level "high" must set requires_confirmation = true');
  }
  const confirmationState = envelope.confirmation_state ?? (
    confirmed ? CONFIRMATION_STATES.REQUIRED : CONFIRMATION_STATES.NOT_REQUIRED
  );
  assertConfirmationState(confirmationState, 'confirmation_state');
  if (!confirmed && confirmationState !== CONFIRMATION_STATES.NOT_REQUIRED) {
    throw new TypeError('Commands that do not require confirmation must use confirmation_state "not_required"');
  }
  if (confirmed && confirmationState === CONFIRMATION_STATES.NOT_REQUIRED) {
    throw new TypeError('Commands that require confirmation cannot use confirmation_state "not_required"');
  }
  const source = envelope.source ?? DEFAULT_COMMAND_SOURCE;
  if (typeof source !== 'string' || source.trim() === '') {
    throw new TypeError('source must be a non-empty string');
  }
  return Object.freeze({
    command_id,
    command_type,
    payload: Object.freeze({ ...payload }),
    created_at,
    risk_level,
    requires_confirmation: confirmed,
    confirmation_state: confirmationState,
    source,
  });
}

export function createCommand(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createCommand expects an object');
  }
  const command_id = input.command_id ?? `cmd_${randomUUID()}`;
  const command_type = input.command_type;
  const payload = input.payload;
  const created_at = input.created_at ?? new Date().toISOString();
  const risk_level = input.risk_level ?? defaultRiskForCommandType(command_type);
  const requires_confirmation =
    input.requires_confirmation ?? risk_level === RISK_LEVELS.HIGH;
  return validateCommand({
    command_id,
    command_type,
    payload,
    created_at,
    risk_level,
    requires_confirmation: requires_confirmation,
    confirmation_state: input.confirmation_state,
    source: input.source,
  });
}
