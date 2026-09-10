export const EXPENSE_CLASSIFICATION_VERSION = '0.1';

export const CLASSIFICATION_SOURCES = Object.freeze([
  'legacy',
  'manual',
  'rule',
  'imported',
  'external',
  'ai_future',
]);

export const CLASSIFICATION_METHODS = Object.freeze([
  'legacy_mapping',
  'manual_selection',
  'deterministic_rule',
  'imported_value',
  'external_system',
  'ai_future',
]);

function issue(code, message) {
  return { code, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateExpenseClassification(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [issue('INVALID_CLASSIFICATION', 'classification must be a plain object')] };
  }
  if (typeof input.category !== 'string' || input.category.trim() === '') {
    errors.push(issue('INVALID_CATEGORY', 'classification category must be a non-empty string'));
  }
  if (!CLASSIFICATION_SOURCES.includes(input.source)) {
    errors.push(issue('INVALID_CLASSIFICATION_SOURCE', 'classification source is not supported'));
  }
  if (!CLASSIFICATION_METHODS.includes(input.method)) {
    errors.push(issue('INVALID_CLASSIFICATION_METHOD', 'classification method is not supported'));
  }
  if (typeof input.confirmed !== 'boolean') {
    errors.push(issue('INVALID_CONFIRMED', 'classification confirmed must be boolean'));
  }
  if (input.confidenceReference !== undefined && (typeof input.confidenceReference !== 'string' || input.confidenceReference.trim() === '')) {
    errors.push(issue('INVALID_CONFIDENCE_REFERENCE', 'confidenceReference must be a non-empty string when provided'));
  }
  if (input.provenance !== undefined && !isPlainObject(input.provenance)) {
    errors.push(issue('INVALID_PROVENANCE', 'classification provenance must be a plain object when provided'));
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeExpenseClassification(input) {
  const validation = validateExpenseClassification(input);
  if (!validation.ok) {
    const error = new TypeError(validation.errors[0].message);
    error.code = validation.errors[0].code;
    error.errors = validation.errors;
    throw error;
  }
  return Object.freeze({
    category: input.category.trim(),
    source: input.source,
    method: input.method,
    confirmed: input.confirmed,
    confidenceReference: input.confidenceReference?.trim() || null,
    provenance: structuredClone(input.provenance ?? {}),
  });
}
