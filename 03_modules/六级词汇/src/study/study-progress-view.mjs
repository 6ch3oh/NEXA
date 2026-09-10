import { validateLearnerProgress } from '../domain/learner-progress.mjs';
import { deepFreeze } from '../domain/shared.mjs';
import { canonicalStudyIdentifier } from './study-shared.mjs';

export const STUDY_PROGRESS_VIEW_VERSION = '0.1';

export function createStudyProgressView({ itemId, learnerProgress }) {
  validateLearnerProgress(learnerProgress);
  return deepFreeze({
    viewVersion: STUDY_PROGRESS_VIEW_VERSION,
    itemId: canonicalStudyIdentifier(itemId, 'itemId'),
    learnerId: learnerProgress.learnerId,
    stage: learnerProgress.stage,
    masteryScore: learnerProgress.masteryScore,
    reviewCount: learnerProgress.reviewCount,
    correctCount: learnerProgress.correctCount,
    incorrectCount: learnerProgress.incorrectCount,
    streak: learnerProgress.streak,
    lapseCount: learnerProgress.lapseCount,
    lastReviewedAt: learnerProgress.lastReviewedAt,
    dueAt: learnerProgress.nextReviewAt,
    updatedAt: learnerProgress.updatedAt,
    authorityRef: Object.freeze({
      authorityType: 'learner-progress',
      entityId: learnerProgress.entryId,
    }),
  });
}
