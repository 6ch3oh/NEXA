import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';

export const STUDY_CENTER_HOME_VIEW_MODEL_VERSION = '0.1';

export function createStudyCenterHomeViewModel({ learnerId, collections }) {
  if (!Array.isArray(collections)) throw new TypeError('collections array required');
  function load({ now }) {
    const generatedAt = requireCanonicalIsoDateTime(now, 'now');
    const collectionViews = collections.map((entry) => {
      const queue = entry.queue.build({ now: generatedAt, plan: entry.plan });
      const stats = entry.getStatistics({ day: generatedAt.slice(0, 10), plan: entry.plan });
      return {
        collectionId: entry.collection.collectionId,
        title: entry.collection.title,
        type: entry.collection.type,
        contentType: entry.contentType ?? entry.collection.type,
        totalItems: stats.totalItems ?? Object.values(stats.stages ?? {}).reduce((sum, count) => sum + count, 0),
        plan: entry.plan,
        todayCount: queue.total,
        dueCount: queue.items.filter((item) => item.queueReason !== 'NEW').length,
        relearningCount: queue.items.filter((item) => item.queueReason === 'RELEARNING').length,
        newCount: queue.items.filter((item) => item.queueReason === 'NEW').length,
        completionRate: stats.completionRate,
        masteryRate: stats.masteryRate ?? 0,
        masteredCount: stats.stages?.mastered ?? 0,
        recentActivityCount: stats.todayReview ?? 0,
      };
    });
    return deepFreeze({
      viewModelVersion: STUDY_CENTER_HOME_VIEW_MODEL_VERSION,
      learnerId,
      generatedAt,
      collections: collectionViews,
      todayTotal: collectionViews.reduce((sum, item) => sum + item.todayCount, 0),
      dueTotal: collectionViews.reduce((sum, item) => sum + item.dueCount, 0),
      relearningTotal: collectionViews.reduce((sum, item) => sum + item.relearningCount, 0),
      newTotal: collectionViews.reduce((sum, item) => sum + item.newCount, 0),
      completionRate: collectionViews.length === 0 ? 0
        : Math.round((collectionViews.reduce((sum, item) => sum + item.completionRate, 0) / collectionViews.length) * 100) / 100,
      recentActivityCount: collectionViews.reduce((sum, item) => sum + item.recentActivityCount, 0),
    });
  }
  return Object.freeze({ viewModelVersion: STUDY_CENTER_HOME_VIEW_MODEL_VERSION, load });
}
