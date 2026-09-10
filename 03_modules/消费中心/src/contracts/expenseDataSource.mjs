export const EXPENSE_DATA_SOURCE_VERSION = '0.1';

export const EXPENSE_SOURCE_KINDS = Object.freeze([
  'legacy',
  'manual',
  'android_notification',
  'wechat',
  'alipay',
  'bank',
  'import',
  'unknown',
]);

function contractError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(input, field) {
  const value = input[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError('INVALID_DATA_SOURCE', `${field} must be a non-empty string when provided`);
  }
  return value.trim();
}

export function createExpenseDataSource(input) {
  if (!isPlainObject(input)) {
    throw contractError('INVALID_DATA_SOURCE', 'data source must be a plain object');
  }
  if (!EXPENSE_SOURCE_KINDS.includes(input.sourceKind)) {
    throw contractError('INVALID_SOURCE_KIND', 'sourceKind is not supported');
  }
  if (input.provenance !== undefined && !isPlainObject(input.provenance)) {
    throw contractError('INVALID_PROVENANCE', 'data source provenance must be a plain object when provided');
  }

  return Object.freeze({
    sourceKind: input.sourceKind,
    platform: optionalString(input, 'platform') ?? input.sourceKind,
    sourceId: optionalString(input, 'sourceId'),
    externalReference: optionalString(input, 'externalReference'),
    classificationReference: optionalString(input, 'classificationReference'),
    confidenceReference: optionalString(input, 'confidenceReference'),
    provenance: structuredClone(input.provenance ?? {}),
  });
}
