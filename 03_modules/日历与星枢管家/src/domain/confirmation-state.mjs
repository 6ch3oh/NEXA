import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';

export const CONFIRMATION_STATES = Object.freeze({
  NOT_REQUIRED: 'not_required',
  REQUIRED: 'required',
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});

export const CONFIRMATION_STATE_LIST = Object.freeze(Object.values(CONFIRMATION_STATES));

export const TERMINAL_CONFIRMATION_STATES = Object.freeze([
  CONFIRMATION_STATES.NOT_REQUIRED,
  CONFIRMATION_STATES.CONFIRMED,
  CONFIRMATION_STATES.REJECTED,
  CONFIRMATION_STATES.EXPIRED,
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [CONFIRMATION_STATES.NOT_REQUIRED]: Object.freeze([]),
  [CONFIRMATION_STATES.REQUIRED]: Object.freeze([
    CONFIRMATION_STATES.PENDING,
    CONFIRMATION_STATES.CONFIRMED,
    CONFIRMATION_STATES.REJECTED,
    CONFIRMATION_STATES.EXPIRED,
  ]),
  [CONFIRMATION_STATES.PENDING]: Object.freeze([
    CONFIRMATION_STATES.CONFIRMED,
    CONFIRMATION_STATES.REJECTED,
    CONFIRMATION_STATES.EXPIRED,
  ]),
  [CONFIRMATION_STATES.CONFIRMED]: Object.freeze([]),
  [CONFIRMATION_STATES.REJECTED]: Object.freeze([]),
  [CONFIRMATION_STATES.EXPIRED]: Object.freeze([]),
});

function hasExplicitOffset(value) {
  return typeof value === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(value);
}

function assertTimestamp(value, fieldName, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (!isValidIsoTimestamp(value) || !hasExplicitOffset(value)) {
    throw new TypeError(`${fieldName} must be an ISO timestamp with an explicit offset or Z`);
  }
  return value;
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

export function isConfirmationState(value) {
  return CONFIRMATION_STATE_LIST.includes(value);
}

export function assertConfirmationState(value, fieldName = 'state') {
  if (!isConfirmationState(value)) {
    throw new TypeError(
      `Invalid ${fieldName} "${String(value)}"; expected one of: ${CONFIRMATION_STATE_LIST.join(', ')}`,
    );
  }
  return value;
}

export function isTerminalConfirmationState(value) {
  assertConfirmationState(value);
  return TERMINAL_CONFIRMATION_STATES.includes(value);
}

export function canTransitionConfirmation(fromState, toState) {
  assertConfirmationState(fromState, 'fromState');
  assertConfirmationState(toState, 'toState');
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

export function validateConfirmation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Confirmation must be an object');
  }

  const state = assertConfirmationState(input.state);
  const requestedAt = assertTimestamp(input.requested_at ?? null, 'requested_at', { nullable: true });
  const resolvedAt = assertTimestamp(input.resolved_at ?? null, 'resolved_at', { nullable: true });
  const expiresAt = assertTimestamp(input.expires_at ?? null, 'expires_at', { nullable: true });

  assertNonEmptyString(input.confirmation_id, 'confirmation_id');
  assertNonEmptyString(input.command_id, 'command_id');
  if (typeof input.reason !== 'string') {
    throw new TypeError('reason must be a string');
  }

  if (state === CONFIRMATION_STATES.NOT_REQUIRED) {
    if (requestedAt != null || resolvedAt != null || expiresAt != null) {
      throw new TypeError('not_required confirmation must not carry lifecycle timestamps');
    }
  } else if (requestedAt == null) {
    throw new TypeError(`${state} confirmation requires requested_at`);
  }

  const resolved = [
    CONFIRMATION_STATES.CONFIRMED,
    CONFIRMATION_STATES.REJECTED,
    CONFIRMATION_STATES.EXPIRED,
  ].includes(state);
  if (resolved && resolvedAt == null) {
    throw new TypeError(`${state} confirmation requires resolved_at`);
  }
  if (!resolved && resolvedAt != null) {
    throw new TypeError(`${state} confirmation must not carry resolved_at`);
  }
  if (requestedAt != null && expiresAt != null && Date.parse(expiresAt) < Date.parse(requestedAt)) {
    throw new RangeError('expires_at must not be earlier than requested_at');
  }
  if (requestedAt != null && resolvedAt != null && Date.parse(resolvedAt) < Date.parse(requestedAt)) {
    throw new RangeError('resolved_at must not be earlier than requested_at');
  }

  return Object.freeze({
    confirmation_id: input.confirmation_id,
    command_id: input.command_id,
    state,
    reason: input.reason,
    requested_at: requestedAt,
    resolved_at: resolvedAt,
    expires_at: expiresAt,
  });
}

export function createConfirmation(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('createConfirmation expects an object');
  }
  const state = input.state ?? CONFIRMATION_STATES.REQUIRED;
  return validateConfirmation({
    confirmation_id: input.confirmation_id,
    command_id: input.command_id,
    state,
    reason: input.reason ?? '',
    requested_at: state === CONFIRMATION_STATES.NOT_REQUIRED ? null : (input.requested_at ?? null),
    resolved_at: input.resolved_at ?? null,
    expires_at: state === CONFIRMATION_STATES.NOT_REQUIRED ? null : (input.expires_at ?? null),
  });
}

export function isConfirmationExpiredAt(confirmation, now) {
  const current = validateConfirmation(confirmation);
  const instant = assertTimestamp(now, 'now');
  return current.expires_at != null && Date.parse(instant) >= Date.parse(current.expires_at);
}

export function transitionConfirmation(confirmation, nextState, { now, reason } = {}) {
  const current = validateConfirmation(confirmation);
  assertConfirmationState(nextState, 'nextState');
  if (!canTransitionConfirmation(current.state, nextState)) {
    throw new Error(`Illegal confirmation transition: ${current.state} -> ${nextState}`);
  }
  const transitionAt = assertTimestamp(now, 'now');
  if (
    nextState !== CONFIRMATION_STATES.EXPIRED &&
    current.expires_at != null &&
    Date.parse(transitionAt) >= Date.parse(current.expires_at)
  ) {
    throw new Error('Expired confirmation cannot be confirmed or rejected');
  }
  if (
    nextState === CONFIRMATION_STATES.EXPIRED &&
    current.expires_at != null &&
    Date.parse(transitionAt) < Date.parse(current.expires_at)
  ) {
    throw new Error('Confirmation cannot expire before expires_at');
  }
  if (reason != null && typeof reason !== 'string') {
    throw new TypeError('reason must be a string when provided');
  }

  const resolved = [
    CONFIRMATION_STATES.CONFIRMED,
    CONFIRMATION_STATES.REJECTED,
    CONFIRMATION_STATES.EXPIRED,
  ].includes(nextState);
  return validateConfirmation({
    ...current,
    state: nextState,
    reason: reason ?? current.reason,
    resolved_at: resolved ? transitionAt : null,
  });
}

export const createConfirmationState = createConfirmation;
export const validateConfirmationState = validateConfirmation;
export const transitionConfirmationState = transitionConfirmation;
