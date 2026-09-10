export const EXPENSE_CONFIDENCE_VERSION = '0.1';

export const CONFIDENCE_SOURCES = Object.freeze([
  'legacy',
  'manual',
  'rule',
  'imported',
  'external',
  'ai_future',
]);

function issue(code, message) {
  return { code, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateExpenseConfidence(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [issue('INVALID_CONFIDENCE', 'confidence must be a plain object')] };
  }
  if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 1) {
    errors.push(issue('INVALID_CONFIDENCE_VALUE', 'confidence value must be a finite number between 0 and 1'));
  }
  if (!CONFIDENCE_SOURCES.includes(input.source)) {
    errors.push(issue('INVALID_CONFIDENCE_SOURCE', 'confidence source is not supported'));
  }
  if (typeof input.reasonCode !== 'string' || input.reasonCode.trim() === '') {
    errors.push(issue('INVALID_REASON_CODE', 'confidence reasonCode must be a non-empty string'));
  }
  if (typeof input.confirmed !== 'boolean') {
    errors.push(issue('INVALID_CONFIRMED', 'confidence confirmed must be boolean'));
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeExpenseConfidence(input) {
  const validation = validateExpenseConfidence(input);
  if (!validation.ok) {
    const error = new TypeError(validation.errors[0].message);
    error.code = validation.errors[0].code;
    error.errors = validation.errors;
    throw error;
  }
  return Object.freeze({
    value: input.value,
    source: input.source,
    reasonCode: input.reasonCode.trim(),
    confirmed: input.confirmed,
  });
}

export function serializeExpenseConfidence(input) {
  return JSON.stringify(normalizeExpenseConfidence(input));
}
