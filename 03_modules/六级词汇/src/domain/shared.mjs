export const CET6_CONTRACT_VERSION = '0.1';

const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,127})$/;
const ENGLISH_TERM_PATTERN = /^[a-z]+(?:[.'-][a-z]+)*(?: [a-z]+(?:[.'-][a-z]+)*)*$/;

export class Cet6ContractError extends TypeError {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'Cet6ContractError';
    this.code = code;
    this.path = path;
  }
}

export function fail(code, path, message) {
  throw new Cet6ContractError(code, path, message);
}

export function requirePlainObject(value, path) {
  const prototype = value !== null && typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (prototype !== Object.prototype && prototype !== null)) {
    fail('INVALID_TYPE', path, 'plain object required');
  }
  return value;
}

export function requireExactKeys(value, allowedKeys, path) {
  requirePlainObject(value, path);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${path}.${key}`, 'field is not part of the V0.1 contract');
  }
}

export function requireRequiredKeys(value, requiredKeys, path) {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail('MISSING_FIELD', `${path}.${key}`, 'field is required');
  }
}

export function requireCanonicalValue(value, canonical, path) {
  if (value !== canonical) fail('NON_CANONICAL_VALUE', path, `must use canonical value ${canonical}`);
}

export function requireCanonicalStringArray(value, canonical, path) {
  if (value.length !== canonical.length || value.some((item, index) => item !== canonical[index])) {
    fail('NON_CANONICAL_VALUE', path, 'values must already be normalized');
  }
}

export function requireArray(value, path, { min = 0 } = {}) {
  if (!Array.isArray(value)) fail('INVALID_TYPE', path, 'array required');
  if (value.length < min) fail('REQUIRED_VALUE', path, `at least ${min} item(s) required`);
  return value;
}

export function normalizeText(value, path, { max = 2_000, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== 'string') fail('INVALID_TYPE', path, 'string required');
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (normalized === '') fail('REQUIRED_VALUE', path, 'non-empty string required');
  if ([...normalized].length > max) fail('VALUE_TOO_LONG', path, `must not exceed ${max} characters`);
  return normalized;
}

export function normalizeIdentifier(value, path) {
  const normalized = normalizeText(value, path, { max: 128 }).toLowerCase();
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    fail('INVALID_IDENTIFIER', path, 'lowercase identifier using a-z, 0-9, dot, colon, underscore or hyphen required');
  }
  return normalized;
}

export function normalizeHeadword(value, path = 'entry.headword') {
  const display = normalizeText(value, path, { max: 120 }).replace(/[’]/gu, "'");
  const normalized = display.toLowerCase();
  if (!ENGLISH_TERM_PATTERN.test(normalized)) fail('INVALID_HEADWORD', path, 'English word or phrase required');
  return normalized;
}

export function requireEnum(value, definition, path) {
  if (!Object.values(definition).includes(value)) {
    fail('INVALID_ENUM', path, `expected one of ${Object.values(definition).join(', ')}`);
  }
  return value;
}

export function requireInteger(value, path, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('INVALID_NUMBER', path, `safe integer between ${min} and ${max} required`);
  }
  return value;
}

export function requireFiniteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail('INVALID_NUMBER', path, `finite number between ${min} and ${max} required`);
  }
  return value;
}

export function requireCanonicalIsoDateTime(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail('INVALID_TYPE', path, 'canonical UTC date-time string required');
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    fail('INVALID_DATETIME', path, 'canonical UTC date-time such as 2026-08-10T12:00:00.000Z required');
  }
  return value;
}

export function requireNullableString(value, path, { max = 500 } = {}) {
  return normalizeText(value, path, { max, nullable: true });
}

export function normalizeUniqueStrings(value, path, options = {}) {
  const { maxItems = 50, maxLength = 120, lowercase = false, validate } = options;
  requireArray(value, path);
  if (value.length > maxItems) fail('TOO_MANY_ITEMS', path, `must not exceed ${maxItems} items`);
  const normalized = value.map((item, index) => {
    const text = normalizeText(item, `${path}[${index}]`, { max: maxLength });
    const result = lowercase ? text.toLowerCase() : text;
    if (validate) validate(result, `${path}[${index}]`);
    return result;
  });
  if (new Set(normalized).size !== normalized.length) fail('DUPLICATE_VALUE', path, 'duplicate values are not allowed');
  return normalized;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

export function assertVersion(value, path) {
  if (value !== CET6_CONTRACT_VERSION) {
    fail('UNSUPPORTED_VERSION', path, `must be ${CET6_CONTRACT_VERSION}`);
  }
}
