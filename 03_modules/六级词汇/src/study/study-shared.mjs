import {
  deepFreeze,
  normalizeIdentifier,
  normalizeText,
  requireCanonicalValue,
  requireExactKeys,
  requirePlainObject,
  requireRequiredKeys,
} from '../domain/shared.mjs';

export const GENERIC_STUDY_CONTRACT_VERSION = '0.1';

export class GenericStudyContractError extends TypeError {
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = 'GenericStudyContractError';
    this.code = code;
    this.path = path;
  }
}

export function studyFail(code, path, message) {
  throw new GenericStudyContractError(code, path, message);
}

export function assertStudyVersion(value, path) {
  if (value !== GENERIC_STUDY_CONTRACT_VERSION) {
    studyFail('UNSUPPORTED_STUDY_VERSION', path, `must be ${GENERIC_STUDY_CONTRACT_VERSION}`);
  }
}

export function canonicalStudyIdentifier(value, path) {
  try {
    return normalizeIdentifier(value, path);
  } catch (error) {
    studyFail('INVALID_STUDY_IDENTIFIER', path, error.message);
  }
}

export function canonicalStudyText(value, path, options = {}) {
  try {
    return normalizeText(value, path, options);
  } catch (error) {
    studyFail('INVALID_STUDY_TEXT', path, error.message);
  }
}

const AUTHORITY_REF_KEYS = ['authorityType', 'entityId'];

export function createAuthorityRef(input, path = 'authorityRef') {
  requireExactKeys(input, AUTHORITY_REF_KEYS, path);
  requireRequiredKeys(input, AUTHORITY_REF_KEYS, path);
  return deepFreeze({
    authorityType: canonicalStudyIdentifier(input.authorityType, `${path}.authorityType`),
    entityId: canonicalStudyIdentifier(input.entityId, `${path}.entityId`),
  });
}

export function validateAuthorityRef(value, path = 'authorityRef') {
  requireExactKeys(value, AUTHORITY_REF_KEYS, path);
  requireRequiredKeys(value, AUTHORITY_REF_KEYS, path);
  requireCanonicalValue(
    value.authorityType,
    canonicalStudyIdentifier(value.authorityType, `${path}.authorityType`),
    `${path}.authorityType`,
  );
  requireCanonicalValue(
    value.entityId,
    canonicalStudyIdentifier(value.entityId, `${path}.entityId`),
    `${path}.entityId`,
  );
  return value;
}

export function requireStudyObject(value, path) {
  try {
    return requirePlainObject(value, path);
  } catch (error) {
    studyFail('INVALID_STUDY_OBJECT', path, error.message);
  }
}
