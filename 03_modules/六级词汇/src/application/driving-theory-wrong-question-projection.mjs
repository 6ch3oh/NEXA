import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { DRIVING_THEORY_USER_PDF_COLLECTION_ID } from '../import/driving-theory-user-pdf-pilot.mjs';
import { decodeRatingEvidence } from './rating-evidence-codec.mjs';
import { ReviewRating } from '../scheduler/rating-contract.mjs';
import { DrivingTheoryMockExamStatus } from './driving-theory-mock-exam.mjs';

export const DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION = '0.1';
export const DRIVING_THEORY_WRONG_QUESTION_RULES = deepFreeze({
  recentWindowDays: 7,
  repeatedWrongThreshold: 2,
});
export const DrivingTheoryWrongQuestionFilter = deepFreeze({
  ALL: 'all',
  RECENT: 'recent',
  REPEATED: 'repeated',
  MOCK_EXAM: 'mock-exam',
  NEEDS_REINFORCEMENT: 'needs-reinforcement',
});

export function createDrivingTheoryWrongQuestionProjection({
  catalog,
  adapter,
  progressStore,
  reviewRecordStore,
  mockExamPersistence,
  metadataFor = () => null,
  clock = () => new Date().toISOString(),
  rules = DRIVING_THEORY_WRONG_QUESTION_RULES,
}) {
  if (typeof catalog?.list !== 'function' || typeof catalog?.get !== 'function' || catalog.count() !== 500) throw new TypeError('formal 500-item Driving catalog required');
  if (adapter?.collectionId !== DRIVING_THEORY_USER_PDF_COLLECTION_ID || typeof adapter?.adapt !== 'function') throw new TypeError('Driving question adapter required');
  if (typeof progressStore?.getState !== 'function' || typeof reviewRecordStore?.list !== 'function') throw new TypeError('existing learner stores required');
  if (typeof mockExamPersistence?.load !== 'function') throw new TypeError('existing mock exam persistence required');
  if (typeof metadataFor !== 'function') throw new TypeError('metadataFor function required');
  const policy = validateRules(rules);

  async function project() {
    const now = requireCanonicalIsoDateTime(clock(), 'clock()');
    const recentFloor = new Date(Date.parse(now) - policy.recentWindowDays * 86_400_000).toISOString();
    const document = await mockExamPersistence.load();
    const contentByItemId = new Map();
    const facts = new Map();
    for (const content of catalog.list()) {
      const itemId = adapter.adapt(content).studyItem.itemId;
      contentByItemId.set(itemId, content.contentId);
      facts.set(content.contentId, emptyFact(content, itemId));
    }

    const submittedSessions = document.sessions
      .filter((session) => session.status === DrivingTheoryMockExamStatus.SUBMITTED)
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
    const sessionFacts = new Map();
    for (const session of submittedSessions) {
      const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer]));
      const wrongQuestionIds = [];
      const unansweredQuestionIds = [];
      for (const questionId of session.questionIds) {
        const content = requireContent(questionId);
        const fact = facts.get(questionId);
        const answer = answerMap.get(questionId);
        if (!answer) {
          fact.unansweredExamCount += 1;
          unansweredQuestionIds.push(questionId);
        } else if (answer.selectedOption !== content.correctAnswer) {
          fact.mockExamWrongCount += 1;
          fact.lastWrongAt = latest(fact.lastWrongAt, session.submittedAt);
          fact.recentExamIds.push(session.sessionId);
          wrongQuestionIds.push(questionId);
        } else {
          fact.lastCorrectAt = latest(fact.lastCorrectAt, session.submittedAt);
        }
      }
      sessionFacts.set(session.sessionId, deepFreeze({
        sessionId: session.sessionId,
        submittedAt: session.submittedAt,
        score: session.score,
        passResult: session.passResult,
        wrongCount: session.wrongCount,
        unansweredCount: session.unansweredCount,
        wrongQuestionIds: deepFreeze(wrongQuestionIds),
        unansweredQuestionIds: deepFreeze(unansweredQuestionIds),
      }));
    }

    for (const record of reviewRecordStore.list()) {
      const contentId = contentByItemId.get(record.entryId);
      if (!contentId) continue;
      const rating = decodeRatingEvidence(record);
      if (rating !== ReviewRating.AGAIN) continue;
      const fact = facts.get(contentId);
      fact.studyDifficultyCount += 1;
      fact.lastStudyDifficultyAt = latest(fact.lastStudyDifficultyAt, record.reviewedAt);
    }

    const items = [...facts.values()].map((fact) => finalizeFact(fact, recentFloor));
    return deepFreeze({ now, recentFloor, items: deepFreeze(items), sessionFacts, submittedSessions: deepFreeze([...sessionFacts.values()]) });
  }

  async function overview() {
    const data = await project();
    const historical = data.items.filter(hasHistoricalWeakness);
    const actualWrong = historical.filter((item) => item.mockExamWrongCount > 0);
    const recent = actualWrong.filter((item) => item.categories.includes('RECENT_WRONG'));
    const repeated = actualWrong.filter((item) => item.categories.includes('REPEATED_WRONG'));
    const needs = historical.filter((item) => item.categories.includes('NEEDS_REINFORCEMENT'));
    const masteredHistorical = historical.filter((item) => item.mastered);
    const latestExam = data.submittedSessions.at(-1) ?? null;
    return deepFreeze({
      ok: true,
      projectionVersion: DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION,
      sourceOfTruth: deepFreeze(['Mock Exam SUBMITTED answers', 'LearnerProgress', 'rating ReviewRecord', 'Driving StudyItem identity']),
      studyCorrectnessHistoryStatus: 'PARTIAL',
      studyCorrectnessHistoryNote: 'Study Mode permanently stores user Rating evidence, not answer correctness; AGAIN is shown only as a learning-difficulty fact.',
      rules: policy,
      statistics: deepFreeze({
        wrongQuestionCount: actualWrong.length,
        recentWrongCount: recent.length,
        repeatedWrongCount: repeated.length,
        needsReinforcementCount: needs.length,
        studyDifficultyQuestionCount: historical.filter((item) => item.studyDifficultyCount > 0).length,
        masteredHistoricalWrongCount: masteredHistorical.filter((item) => item.mockExamWrongCount > 0).length,
        lastWrongAt: actualWrong.map((item) => item.lastWrongAt).filter(Boolean).sort().at(-1) ?? null,
        latestExamWrongCount: latestExam?.wrongCount ?? 0,
        latestExamUnansweredCount: latestExam?.unansweredCount ?? 0,
      }),
      recentExams: deepFreeze([...data.submittedSessions].reverse()),
    });
  }

  async function list({
    filter = DrivingTheoryWrongQuestionFilter.NEEDS_REINFORCEMENT,
    sessionId = null,
    includeMastered = false,
    includeUnanswered = false,
  } = {}) {
    if (!Object.values(DrivingTheoryWrongQuestionFilter).includes(filter)) throw new TypeError('unsupported wrong-question filter');
    const data = await project();
    let items;
    if (sessionId !== null) {
      const session = data.sessionFacts.get(requireText(sessionId, 'sessionId'));
      if (!session) throw coded('SUBMITTED_EXAM_NOT_FOUND', 'submitted mock exam was not found');
      const selected = new Set(session.wrongQuestionIds);
      if (includeUnanswered) for (const questionId of session.unansweredQuestionIds) selected.add(questionId);
      items = data.items.filter((item) => selected.has(item.questionIdentity)).map((item) => deepFreeze({
        ...item,
        selectedFromUnanswered: !session.wrongQuestionIds.includes(item.questionIdentity),
      }));
    } else {
      items = data.items.filter((item) => matchesFilter(item, filter));
    }
    if (!includeMastered) items = items.filter((item) => !item.mastered);
    items.sort(compareItems);
    return deepFreeze({
      ok: true,
      projectionVersion: DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION,
      filter,
      sessionId,
      includeMastered,
      includeUnanswered,
      total: items.length,
      items: deepFreeze(items),
    });
  }

  async function createTrainingQueue(options = {}) {
    const result = await list({ ...options, includeMastered: false });
    return deepFreeze({
      ok: true,
      queueVersion: DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION,
      source: 'READ_ONLY_PROJECTION',
      persisted: false,
      filter: result.filter,
      sessionId: result.sessionId,
      includeUnanswered: result.includeUnanswered,
      questionIds: deepFreeze(result.items.map((item) => item.questionIdentity)),
      total: result.total,
    });
  }

  function requireContent(questionId) {
    const content = catalog.get(questionId);
    if (!content) throw coded('DRIVING_QUESTION_NOT_FOUND', `Driving question is missing: ${questionId}`);
    return content;
  }

  return deepFreeze({
    projectionVersion: DRIVING_THEORY_WRONG_QUESTION_PROJECTION_VERSION,
    rules: policy,
    overview,
    list,
    createTrainingQueue,
  });

  function emptyFact(content, itemId) {
    return {
      questionIdentity: content.contentId,
      studyItemIdentity: itemId,
      sourceCollection: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
      question: content.question,
      mockExamWrongCount: 0,
      unansweredExamCount: 0,
      lastWrongAt: null,
      lastCorrectAt: null,
      recentExamIds: [],
      studyDifficultyCount: 0,
      lastStudyDifficultyAt: null,
    };
  }

  function finalizeFact(fact, recentFloor) {
    const state = progressStore.getState(fact.studyItemIdentity);
    const mastered = state?.progress.stage === 'mastered';
    const categories = [];
    if (fact.lastWrongAt !== null && fact.lastWrongAt >= recentFloor) categories.push('RECENT_WRONG');
    if (fact.mockExamWrongCount >= policy.repeatedWrongThreshold) categories.push('REPEATED_WRONG');
    if (fact.mockExamWrongCount > 0) categories.push('MOCK_EXAM_WRONG');
    if (!mastered && (fact.mockExamWrongCount > 0 || fact.studyDifficultyCount > 0)) categories.push('NEEDS_REINFORCEMENT');
    const metadata = metadataFor(fact.questionIdentity);
    return deepFreeze({
      questionIdentity: fact.questionIdentity,
      studyItemIdentity: fact.studyItemIdentity,
      sourceCollection: fact.sourceCollection,
      question: fact.question,
      wrongCount: fact.mockExamWrongCount,
      mockExamWrongCount: fact.mockExamWrongCount,
      studyWrongCount: null,
      studyDifficultyCount: fact.studyDifficultyCount,
      unansweredExamCount: fact.unansweredExamCount,
      lastWrongAt: fact.lastWrongAt,
      lastCorrectAt: fact.lastCorrectAt,
      lastStudyDifficultyAt: fact.lastStudyDifficultyAt,
      recentExamIds: deepFreeze([...new Set(fact.recentExamIds)].reverse()),
      currentLearningState: state?.progress.stage ?? 'new',
      currentDueAt: state?.progress.nextReviewAt ?? null,
      mastered,
      imageRequired: metadata?.imageRequired === true,
      metadata: metadata == null ? null : deepFreeze(JSON.parse(JSON.stringify(metadata))),
      categories: deepFreeze(categories),
      priorityReasons: deepFreeze([
        ...(fact.mockExamWrongCount > 0 ? [`模拟考试实际答错 ${fact.mockExamWrongCount} 次`] : []),
        ...(fact.studyDifficultyCount > 0 ? [`学习评分“不会” ${fact.studyDifficultyCount} 次`] : []),
      ]),
      selectedFromUnanswered: false,
    });
  }
}

function hasHistoricalWeakness(item) { return item.mockExamWrongCount > 0 || item.studyDifficultyCount > 0; }
function matchesFilter(item, filter) {
  if (filter === DrivingTheoryWrongQuestionFilter.ALL) return hasHistoricalWeakness(item);
  if (filter === DrivingTheoryWrongQuestionFilter.RECENT) return item.categories.includes('RECENT_WRONG');
  if (filter === DrivingTheoryWrongQuestionFilter.REPEATED) return item.categories.includes('REPEATED_WRONG');
  if (filter === DrivingTheoryWrongQuestionFilter.MOCK_EXAM) return item.categories.includes('MOCK_EXAM_WRONG');
  return item.categories.includes('NEEDS_REINFORCEMENT');
}
function compareItems(left, right) {
  return right.mockExamWrongCount - left.mockExamWrongCount
    || right.studyDifficultyCount - left.studyDifficultyCount
    || String(right.lastWrongAt ?? right.lastStudyDifficultyAt ?? '').localeCompare(String(left.lastWrongAt ?? left.lastStudyDifficultyAt ?? ''))
    || left.questionIdentity.localeCompare(right.questionIdentity);
}
function validateRules(rules) {
  if (!Number.isSafeInteger(rules?.recentWindowDays) || rules.recentWindowDays < 1) throw new TypeError('recentWindowDays positive integer required');
  if (!Number.isSafeInteger(rules?.repeatedWrongThreshold) || rules.repeatedWrongThreshold < 2) throw new TypeError('repeatedWrongThreshold integer >= 2 required');
  return deepFreeze({ recentWindowDays: rules.recentWindowDays, repeatedWrongThreshold: rules.repeatedWrongThreshold });
}
function latest(left, right) { return left === null || right > left ? right : left; }
function requireText(value, path) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} required`); return value.trim(); }
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
