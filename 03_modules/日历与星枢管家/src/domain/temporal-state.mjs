export const TEMPORAL_STATES = Object.freeze({
  EXACT: 'exact',
  DATE_ONLY: 'date_only',
  AMBIGUOUS: 'ambiguous',
  RELATIVE_UNRESOLVED: 'relative_unresolved',
  UNSCHEDULED: 'unscheduled',
});

export const TEMPORAL_STATE_LIST = Object.freeze([
  TEMPORAL_STATES.EXACT,
  TEMPORAL_STATES.DATE_ONLY,
  TEMPORAL_STATES.AMBIGUOUS,
  TEMPORAL_STATES.RELATIVE_UNRESOLVED,
  TEMPORAL_STATES.UNSCHEDULED,
]);

export function isTemporalState(value) {
  return TEMPORAL_STATE_LIST.includes(value);
}

export function assertTemporalState(value, fieldName = 'time_state') {
  if (!isTemporalState(value)) {
    throw new TypeError(
      `Invalid ${fieldName} "${String(value)}"; expected one of: ${TEMPORAL_STATE_LIST.join(', ')}`,
    );
  }
  return value;
}
