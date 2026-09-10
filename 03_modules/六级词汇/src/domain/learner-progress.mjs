import {
  CET6_CONTRACT_VERSION,
  assertVersion,
  deepFreeze,
  fail,
  normalizeIdentifier,
  requireCanonicalIsoDateTime,
  requireCanonicalValue,
  requireEnum,
  requireExactKeys,
  requireInteger,
  requireRequiredKeys,
} from './shared.mjs';

export const LearningStage = Object.freeze({
  NEW: 'new',
  LEARNING: 'learning',
  REVIEWING: 'reviewing',
  MASTERED: 'mastered',
  SUSPENDED: 'suspended',
});

const PROGRESS_KEYS = [
  'schemaVersion', 'learnerId', 'entryId', 'stage', 'masteryScore', 'reviewCount',
  'correctCount', 'incorrectCount', 'streak', 'lapseCount', 'lastReviewedAt',
  'nextReviewAt', 'updatedAt',
];

export function validateLearnerProgress(value) {
  requireExactKeys(value, PROGRESS_KEYS, 'progress');
  requireRequiredKeys(value, PROGRESS_KEYS, 'progress');
  assertVersion(value.schemaVersion, 'progress.schemaVersion');
  requireCanonicalValue(
    value.learnerId,
    normalizeIdentifier(value.learnerId, 'progress.learnerId'),
    'progress.learnerId',
  );
  requireCanonicalValue(value.entryId, normalizeIdentifier(value.entryId, 'progress.entryId'), 'progress.entryId');
  requireEnum(value.stage, LearningStage, 'progress.stage');
  requireInteger(value.masteryScore, 'progress.masteryScore', { min: 0, max: 100 });
  requireInteger(value.reviewCount, 'progress.reviewCount', { min: 0 });
  requireInteger(value.correctCount, 'progress.correctCount', { min: 0 });
  requireInteger(value.incorrectCount, 'progress.incorrectCount', { min: 0 });
  requireInteger(value.streak, 'progress.streak', { min: 0 });
  requireInteger(value.lapseCount, 'progress.lapseCount', { min: 0 });
  requireCanonicalIsoDateTime(value.lastReviewedAt, 'progress.lastReviewedAt', { nullable: true });
  requireCanonicalIsoDateTime(value.nextReviewAt, 'progress.nextReviewAt', { nullable: true });
  requireCanonicalIsoDateTime(value.updatedAt, 'progress.updatedAt');

  if (value.correctCount + value.incorrectCount > value.reviewCount) {
    fail('INVALID_COUNT', 'progress.reviewCount', 'must cover correctCount + incorrectCount');
  }
  if (value.streak > value.correctCount) fail('INVALID_COUNT', 'progress.streak', 'must not exceed correctCount');
  if (value.lapseCount > value.incorrectCount) {
    fail('INVALID_COUNT', 'progress.lapseCount', 'must not exceed incorrectCount');
  }
  if (value.reviewCount === 0 && value.lastReviewedAt !== null) {
    fail('INVALID_REVIEW_STATE', 'progress.lastReviewedAt', 'must be null before the first review');
  }
  if (value.reviewCount > 0 && value.lastReviewedAt === null) {
    fail('INVALID_REVIEW_STATE', 'progress.lastReviewedAt', 'required after a review');
  }
  if (value.lastReviewedAt !== null && value.updatedAt < value.lastReviewedAt) {
    fail('INVALID_TIME_ORDER', 'progress.updatedAt', 'must not be earlier than lastReviewedAt');
  }
  if (value.lastReviewedAt !== null && value.nextReviewAt !== null && value.nextReviewAt < value.lastReviewedAt) {
    fail('INVALID_TIME_ORDER', 'progress.nextReviewAt', 'must not be earlier than lastReviewedAt');
  }
  if (value.stage === LearningStage.NEW) {
    const hasLearningState = value.masteryScore !== 0 || value.reviewCount !== 0 || value.correctCount !== 0
      || value.incorrectCount !== 0 || value.streak !== 0 || value.lapseCount !== 0
      || value.lastReviewedAt !== null || value.nextReviewAt !== null;
    if (hasLearningState) fail('INVALID_NEW_STAGE', 'progress', 'new stage cannot contain review history');
  } else if (value.reviewCount === 0) {
    fail('INVALID_REVIEW_STATE', 'progress.reviewCount', 'non-new stage requires at least one review');
  }
  if (value.stage === LearningStage.MASTERED && value.masteryScore < 80) {
    fail('INVALID_MASTERY', 'progress.masteryScore', 'mastered stage requires a score of at least 80');
  }
  if (value.stage === LearningStage.SUSPENDED && value.nextReviewAt !== null) {
    fail('INVALID_SUSPENSION', 'progress.nextReviewAt', 'suspended progress cannot have a scheduled review');
  }
  return value;
}

export function createLearnerProgress(input) {
  requireExactKeys(input, PROGRESS_KEYS, 'input');
  if (input.schemaVersion !== undefined) assertVersion(input.schemaVersion, 'input.schemaVersion');
  const progress = {
    schemaVersion: CET6_CONTRACT_VERSION,
    learnerId: normalizeIdentifier(input.learnerId, 'input.learnerId'),
    entryId: normalizeIdentifier(input.entryId, 'input.entryId'),
    stage: requireEnum(input.stage ?? LearningStage.NEW, LearningStage, 'input.stage'),
    masteryScore: requireInteger(input.masteryScore ?? 0, 'input.masteryScore', { min: 0, max: 100 }),
    reviewCount: requireInteger(input.reviewCount ?? 0, 'input.reviewCount', { min: 0 }),
    correctCount: requireInteger(input.correctCount ?? 0, 'input.correctCount', { min: 0 }),
    incorrectCount: requireInteger(input.incorrectCount ?? 0, 'input.incorrectCount', { min: 0 }),
    streak: requireInteger(input.streak ?? 0, 'input.streak', { min: 0 }),
    lapseCount: requireInteger(input.lapseCount ?? 0, 'input.lapseCount', { min: 0 }),
    lastReviewedAt: requireCanonicalIsoDateTime(input.lastReviewedAt ?? null, 'input.lastReviewedAt', { nullable: true }),
    nextReviewAt: requireCanonicalIsoDateTime(input.nextReviewAt ?? null, 'input.nextReviewAt', { nullable: true }),
    updatedAt: requireCanonicalIsoDateTime(input.updatedAt, 'input.updatedAt'),
  };
  validateLearnerProgress(progress);
  return deepFreeze(progress);
}
