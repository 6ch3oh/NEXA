import { canonicalStudyIdentifier, studyFail } from '../study/study-shared.mjs';

export const REVIEW_RATING_VERSION = '0.1';
export const ReviewRating = Object.freeze({ AGAIN: 'again', HARD: 'hard', GOOD: 'good', EASY: 'easy' });
export const StudyAction = Object.freeze({ MASTERED: 'mastered' });

export function validateReviewRating(value, path = 'rating') {
  const canonical = canonicalStudyIdentifier(value, path);
  if (!Object.values(ReviewRating).includes(canonical)) {
    studyFail('INVALID_REVIEW_RATING', path, `expected one of ${Object.values(ReviewRating).join(', ')}`);
  }
  return canonical;
}

export function validateStudyAction(value, path = 'action') {
  const canonical = canonicalStudyIdentifier(value, path);
  if (!Object.values(StudyAction).includes(canonical)) {
    studyFail('INVALID_STUDY_ACTION', path, `expected one of ${Object.values(StudyAction).join(', ')}`);
  }
  return canonical;
}
