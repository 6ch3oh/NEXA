import { decodeRatingEvidence } from './rating-evidence-codec.mjs';
import { LearningStage } from '../domain/learner-progress.mjs';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { StudyQueueReason } from './cet6-study-queue.mjs';

export const GENERIC_CONTENT_STUDY_QUEUE_VERSION = '0.1';

export function createGenericContentStudyQueue({ learnerId, catalog, adapter, progressStore, reviewRecordStore }) {
  function build({ now, plan }) {
    const generatedAt = requireCanonicalIsoDateTime(now, 'now');
    if (plan.collectionId !== adapter.collectionId) throw new TypeError('plan collection mismatch');
    const candidates = catalog.list().flatMap((content, stableIndex) => {
      const projection = adapter.adapt(content);
      const progressIdentity = projection.studyItem.itemId;
      const state = progressStore.getState(progressIdentity);
      const progress = state?.progress ?? null;
      if (progress?.stage === LearningStage.MASTERED || progress?.stage === LearningStage.SUSPENDED) return [];
      const latest = reviewRecordStore.listByWord(progressIdentity).at(-1);
      const rating = latest ? decodeRatingEvidence(latest) : null;
      const due = progress?.nextReviewAt !== null && progress?.nextReviewAt <= generatedAt;
      const reason = rating === 'again' && due ? StudyQueueReason.RELEARNING
        : progress === null || progress.stage === LearningStage.NEW ? StudyQueueReason.NEW
          : due ? StudyQueueReason.REVIEW_DUE : null;
      if (reason === null) return [];
      return [{ content, projection, state, reason, stableIndex }];
    });
    const priority = { RELEARNING: 0, REVIEW_DUE: 1, NEW: 2 };
    candidates.sort((a, b) => priority[a.reason] - priority[b.reason]
      || (a.state?.progress.nextReviewAt ?? '').localeCompare(b.state?.progress.nextReviewAt ?? '')
      || a.stableIndex - b.stableIndex);
    const selected = [];
    let newCount = 0;
    let reviewCount = 0;
    for (const candidate of candidates) {
      if (selected.length >= plan.dailyTotalLimit) break;
      if (candidate.reason === StudyQueueReason.NEW) {
        if (newCount >= plan.dailyNewLimit) continue;
        newCount += 1;
      } else {
        if (reviewCount >= plan.dailyReviewLimit) continue;
        reviewCount += 1;
      }
      selected.push(candidate);
    }
    const items = selected.map((candidate, index) => {
      const projection = candidate.projection;
      return {
        learnerId,
        collectionId: adapter.collectionId,
        itemId: projection.studyItem.itemId,
        cardId: projection.reviewCards[0].cardId,
        contentId: candidate.content.contentId,
        queueReason: candidate.reason,
        dueAt: candidate.state?.progress.nextReviewAt ?? null,
        position: index + 1,
        total: selected.length,
        presentation: projection.presentation,
      };
    });
    return deepFreeze({ queueVersion: GENERIC_CONTENT_STUDY_QUEUE_VERSION, learnerId, collectionId: adapter.collectionId, generatedAt, plan, items, total: items.length });
  }
  return Object.freeze({ queueVersion: GENERIC_CONTENT_STUDY_QUEUE_VERSION, build });
}
