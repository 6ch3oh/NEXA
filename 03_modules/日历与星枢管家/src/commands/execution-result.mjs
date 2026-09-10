import { isValidIsoTimestamp } from '../date/deterministic-parser.mjs';

export const EXECUTION_STATUSES = Object.freeze({
  EXECUTED: 'executed',
  CONFIRMATION_REQUIRED: 'confirmation_required',
  DENIED: 'denied',
  INVALID: 'invalid',
  UNSUPPORTED: 'unsupported',
  DUPLICATE: 'duplicate',
  FAILED: 'failed',
});

export const EXECUTION_CODES = Object.freeze({
  EXECUTED: 'EXECUTED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  DENIED: 'DENIED',
  INVALID_COMMAND: 'INVALID_COMMAND',
  INVALID_COMMAND_PAYLOAD: 'INVALID_COMMAND_PAYLOAD',
  COMMAND_ID_CONFLICT: 'COMMAND_ID_CONFLICT',
  DENY_UNSUPPORTED: 'DENY_UNSUPPORTED',
  DUPLICATE_COMMAND: 'DUPLICATE_COMMAND',
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_ERROR: 'SERVICE_ERROR',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
});

const STATUS_LIST = Object.freeze(Object.values(EXECUTION_STATUSES));

function freezeValue(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeValue(item)])));
  }
  return value;
}

export function sanitizeExecutionError(error) {
  if (!error) return null;
  const redact = (value) => String(value).replace(
    /(api[ _-]?key|secret|token|password|credential)\s*[:=]\s*[^\s,;]+/gi,
    '$1=[REDACTED]',
  );
  const message = typeof error.message === 'string' ? error.message : 'Local command execution failed';
  const safe = {
    name: redact(typeof error.name === 'string' ? error.name : 'Error').slice(0, 100),
    message: redact(message).slice(0, 500),
  };
  if (typeof error.code === 'string') safe.code = error.code.slice(0, 100);
  return Object.freeze(safe);
}

export function createExecutionResult({
  command_id = null,
  status,
  code,
  data = null,
  error = null,
  executed_at,
  receipt_id,
}) {
  if (command_id != null && (typeof command_id !== 'string' || command_id.trim() === '')) {
    throw new TypeError('command_id must be null or a non-empty string');
  }
  if (!STATUS_LIST.includes(status)) throw new TypeError(`Invalid execution status "${status}"`);
  if (typeof code !== 'string' || code.trim() === '') throw new TypeError('code must be a non-empty string');
  if (!isValidIsoTimestamp(executed_at) || !/(Z|[+-]\d{2}:\d{2})$/.test(executed_at)) {
    throw new TypeError('executed_at must be an ISO timestamp with an explicit offset or Z');
  }
  if (typeof receipt_id !== 'string' || receipt_id.trim() === '') throw new TypeError('receipt_id must be a non-empty string');
  return Object.freeze({
    command_id,
    status,
    code,
    data: freezeValue(data),
    error: sanitizeExecutionError(error),
    executed_at,
    receipt_id,
  });
}
