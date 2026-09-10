import {
  CET6_CONTRACT_VERSION,
  deepFreeze,
  normalizeIdentifier,
  requireCanonicalValue,
  requireExactKeys,
  requireRequiredKeys,
} from '../domain/shared.mjs';

export const LEARNER_IDENTITY_VERSION = '0.1';
export const DEFAULT_LOCAL_LEARNER_ID = 'local-default';

const LEARNER_IDENTITY_KEYS = ['schemaVersion', 'learnerId'];

export class LearnerIdentityError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'LearnerIdentityError';
    this.code = code;
  }
}

export function normalizeLearnerId(value = DEFAULT_LOCAL_LEARNER_ID, path = 'learnerId') {
  try {
    return normalizeIdentifier(value, path);
  } catch (error) {
    throw new LearnerIdentityError('INVALID_LEARNER_ID', error.message);
  }
}

export function validateLearnerIdentity(value) {
  requireExactKeys(value, LEARNER_IDENTITY_KEYS, 'learnerIdentity');
  requireRequiredKeys(value, LEARNER_IDENTITY_KEYS, 'learnerIdentity');
  if (value.schemaVersion !== CET6_CONTRACT_VERSION) {
    throw new LearnerIdentityError(
      'UNSUPPORTED_LEARNER_IDENTITY_VERSION',
      `learnerIdentity.schemaVersion must be ${CET6_CONTRACT_VERSION}`,
    );
  }
  requireCanonicalValue(
    value.learnerId,
    normalizeLearnerId(value.learnerId, 'learnerIdentity.learnerId'),
    'learnerIdentity.learnerId',
  );
  return value;
}

export function createLearnerIdentity(input = {}) {
  requireExactKeys(input, LEARNER_IDENTITY_KEYS, 'input');
  if (input.schemaVersion !== undefined && input.schemaVersion !== CET6_CONTRACT_VERSION) {
    throw new LearnerIdentityError(
      'UNSUPPORTED_LEARNER_IDENTITY_VERSION',
      `input.schemaVersion must be ${CET6_CONTRACT_VERSION}`,
    );
  }
  const identity = {
    schemaVersion: CET6_CONTRACT_VERSION,
    learnerId: normalizeLearnerId(input.learnerId ?? DEFAULT_LOCAL_LEARNER_ID, 'input.learnerId'),
  };
  validateLearnerIdentity(identity);
  return deepFreeze(identity);
}
