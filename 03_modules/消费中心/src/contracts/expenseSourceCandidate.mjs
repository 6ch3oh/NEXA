import { normalizeExpenseClassification } from '../classification/expenseClassification.mjs';
import { normalizeExpenseConfidence } from '../confidence/expenseConfidence.mjs';
import { createExpenseDataSource } from './expenseDataSource.mjs';

export const EXPENSE_SOURCE_CANDIDATE_VERSION = '0.1';

function candidateError(code, message) {
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
  if (typeof value !== 'string') {
    throw candidateError('INVALID_CANDIDATE', `${field} must be a string when provided`);
  }
  return value;
}

export function createExpenseSourceCandidate(input) {
  if (!isPlainObject(input)) {
    throw candidateError('INVALID_CANDIDATE', 'candidate must be a plain object');
  }
  const source = createExpenseDataSource(input.source);
  if (source.sourceId === null && source.externalReference === null) {
    throw candidateError('MISSING_SOURCE_IDENTITY', 'candidate source requires sourceId or externalReference');
  }
  if (typeof input.occurredAt !== 'string' || input.occurredAt.trim() === '') {
    throw candidateError('MISSING_OCCURRED_AT', 'candidate occurredAt must be a non-empty string');
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    throw candidateError('INVALID_AMOUNT', 'candidate amountCents must be a non-zero integer');
  }
  if (typeof input.merchant !== 'string') {
    throw candidateError('INVALID_MERCHANT', 'candidate merchant must be a string');
  }
  if (input.direction !== 'expense' && input.direction !== 'income') {
    throw candidateError('INVALID_DIRECTION', 'candidate direction must be expense or income');
  }

  const confidence = input.confidence === undefined ? null : normalizeExpenseConfidence(input.confidence);
  const classification = input.classification === undefined ? null : normalizeExpenseClassification(input.classification);

  return Object.freeze({
    source,
    id: optionalString(input, 'id'),
    occurredAt: input.occurredAt.trim(),
    amountCents: input.amountCents,
    merchant: input.merchant,
    direction: input.direction,
    category: optionalString(input, 'category'),
    note: optionalString(input, 'note'),
    currency: optionalString(input, 'currency'),
    createdAt: optionalString(input, 'createdAt'),
    confidence,
    classification,
  });
}

export function expenseCandidateToDomainInput(input) {
  const candidate = createExpenseSourceCandidate(input);
  const sourceIdentity = candidate.source.sourceId ?? candidate.source.externalReference;
  const domainInput = {
    platform: candidate.source.platform,
    sourceId: sourceIdentity,
    occurredAt: candidate.occurredAt,
    amountCents: candidate.amountCents,
    merchant: candidate.merchant,
    direction: candidate.direction,
  };
  if (candidate.id !== null) domainInput.id = candidate.id;
  if (candidate.category !== null) domainInput.category = candidate.category;
  else if (candidate.classification !== null) domainInput.category = candidate.classification.category;
  if (candidate.note !== null) domainInput.note = candidate.note;
  if (candidate.currency !== null) domainInput.currency = candidate.currency;
  if (candidate.createdAt !== null) domainInput.createdAt = candidate.createdAt;
  return { candidate, domainInput };
}
