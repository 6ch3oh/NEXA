import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  DrivingTheoryWrongQuestionFilter,
  ReviewRating,
  calculateMockExamDocumentHash,
  createDrivingTheoryMockExamRuntime,
  createDrivingTheoryWrongQuestionProjection,
  createEmptyMockExamDocument,
  createFsrsSchedulerAdapter,
  createGenericStudyRuntime,
  createInMemoryStudyContentCatalog,
  createLearnerDataPartition,
  createLearnerSnapshot,
  createQuestionAnswerStudyAdapter,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  evaluateMultipleChoiceAnswer,
  loadDrivingTheoryFrozenV1,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const frozen = await loadDrivingTheoryFrozenV1({ moduleRoot, verifyMedia:false });

test('wrong-question overview is rebuilt from submitted exam answers and truthful Study difficulty facts', async () => {
  const scenario = await createScenario();
  const overview = await scenario.projection.overview();
  assert.equal(overview.studyCorrectnessHistoryStatus, 'PARTIAL');
  assert.deepEqual(overview.sourceOfTruth, ['Mock Exam SUBMITTED answers', 'LearnerProgress', 'rating ReviewRecord', 'Driving StudyItem identity']);
  assert.deepEqual(overview.statistics, {
    wrongQuestionCount:2,
    recentWrongCount:2,
    repeatedWrongCount:1,
    needsReinforcementCount:2,
    studyDifficultyQuestionCount:1,
    masteredHistoricalWrongCount:1,
    lastWrongAt:'2026-08-24T01:04:00.000Z',
    latestExamWrongCount:1,
    latestExamUnansweredCount:99,
  });
  assert.equal(overview.recentExams.length, 2);
});

test('recent, repeated, mock-exam and reinforcement filters use centralized explainable rules', async () => {
  const scenario = await createScenario();
  const repeatedHistory = await scenario.projection.list({ filter:DrivingTheoryWrongQuestionFilter.REPEATED, includeMastered:true });
  assert.equal(repeatedHistory.total, 1);
  assert.equal(repeatedHistory.items[0].questionIdentity, scenario.repeatedId);
  assert.equal(repeatedHistory.items[0].wrongCount, 2);
  assert.equal(repeatedHistory.items[0].studyWrongCount, null);
  assert.equal(repeatedHistory.items[0].mastered, true);
  assert.equal((await scenario.projection.list({ filter:DrivingTheoryWrongQuestionFilter.REPEATED })).total, 0);

  const needs = await scenario.projection.list({ filter:DrivingTheoryWrongQuestionFilter.NEEDS_REINFORCEMENT });
  assert.deepEqual(new Set(needs.items.map((item) => item.questionIdentity)), new Set([scenario.singleWrongId, scenario.studyDifficultyId]));
  assert.equal(needs.items.find((item) => item.questionIdentity === scenario.studyDifficultyId).priorityReasons[0], '学习评分“不会” 1 次');
  assert.equal(needs.items.find((item) => item.questionIdentity === scenario.studyDifficultyId).mockExamWrongCount, 0);
});

test('exam-specific projection excludes abandoned answers and keeps unanswered separate from wrong', async () => {
  const scenario = await createScenario();
  const examWrong = await scenario.projection.list({ sessionId:scenario.firstSessionId, includeMastered:true });
  assert.deepEqual(new Set(examWrong.items.map((item) => item.questionIdentity)), new Set([scenario.repeatedId, scenario.singleWrongId]));
  assert.equal(examWrong.items.every((item) => item.selectedFromUnanswered === false), true);

  const withUnanswered = await scenario.projection.list({ sessionId:scenario.firstSessionId, includeUnanswered:true });
  assert.equal(withUnanswered.total, 99);
  assert.equal(withUnanswered.items.filter((item) => item.selectedFromUnanswered).length, 98);
  assert.equal(withUnanswered.items.some((item) => item.questionIdentity === scenario.abandonedWrongId), false);
});

test('training queue is identity-only, non-persistent and selection does not mutate learner state or Today Queue', async () => {
  const scenario = await createScenario();
  const plan = scenario.study.createPlan({ dailyNewLimit:7, dailyReviewLimit:3, dailyTotalLimit:10 });
  const beforeSnapshot = createLearnerSnapshot(scenario.partition, { createdAt:scenario.snapshotAt, updatedAt:scenario.snapshotAt });
  const beforeQueue = scenario.study.queue.build({ now:'2026-08-24T02:00:00.000Z', plan });
  const queue = await scenario.projection.createTrainingQueue({ sessionId:scenario.firstSessionId });
  const afterSnapshot = createLearnerSnapshot(scenario.partition, { createdAt:scenario.snapshotAt, updatedAt:scenario.snapshotAt });
  const afterQueue = scenario.study.queue.build({ now:'2026-08-24T02:00:00.000Z', plan });
  assert.deepEqual(queue, {
    ok:true,
    queueVersion:'0.1',
    source:'READ_ONLY_PROJECTION',
    persisted:false,
    filter:'needs-reinforcement',
    sessionId:scenario.firstSessionId,
    includeUnanswered:false,
    questionIds:[scenario.singleWrongId],
    total:1,
  });
  assert.deepEqual(afterSnapshot, beforeSnapshot);
  assert.deepEqual(afterQueue, beforeQueue);
  assert.deepEqual(plan, scenario.study.createPlan({ dailyNewLimit:7, dailyReviewLimit:3, dailyTotalLimit:10 }));
});

test('training reuses answer feedback and Generic Rating without coupling correctness to Rating', async () => {
  const scenario = await createScenario();
  const content = frozen.contents.find((item) => item.contentId === scenario.singleWrongId);
  const snapshotBeforeAnswer = createLearnerSnapshot(scenario.partition, { createdAt:scenario.snapshotAt, updatedAt:scenario.snapshotAt });
  const feedback = evaluateMultipleChoiceAnswer(content, content.correctAnswer);
  assert.equal(feedback.correct, true);
  assert.deepEqual(createLearnerSnapshot(scenario.partition, { createdAt:scenario.snapshotAt, updatedAt:scenario.snapshotAt }), snapshotBeforeAnswer);

  const first = scenario.study.session.rate(content.contentId, ReviewRating.AGAIN, { at:'2026-08-24T02:00:00.000Z' });
  const second = scenario.study.session.rate(content.contentId, ReviewRating.AGAIN, { at:'2026-08-24T02:01:00.000Z' });
  assert.equal(first.schedule.dueAt, '2026-08-24T02:01:00.000Z');
  assert.equal(second.schedule.dueAt, '2026-08-24T02:11:00.000Z');
  assert.equal(scenario.study.progressStore.getState(scenario.study.adapter.adapt(content).studyItem.itemId).progress.incorrectCount, 2);
});

test('mastered history survives restart projection but is absent from the default reinforcement queue', async () => {
  const scenario = await createScenario();
  const restarted = createProjection(scenario);
  const before = await scenario.projection.overview();
  const after = await restarted.overview();
  assert.deepEqual(after, before);
  const history = await restarted.list({ filter:DrivingTheoryWrongQuestionFilter.ALL, includeMastered:true });
  assert.equal(history.items.some((item) => item.questionIdentity === scenario.repeatedId && item.mastered), true);
  const training = await restarted.createTrainingQueue({ filter:DrivingTheoryWrongQuestionFilter.ALL });
  assert.equal(training.questionIds.includes(scenario.repeatedId), false);
});

test('Driving UI exposes three clear modes and a keyboard-accessible responsive training flow', async () => {
  const [ui, styles, server] = await Promise.all([
    readFile(`${moduleRoot}/ui/app.mjs`, 'utf8'),
    readFile(`${moduleRoot}/ui/styles.css`, 'utf8'),
    readFile(`${moduleRoot}/ui/server.mjs`, 'utf8'),
  ]);
  for (const label of ['学习模式', '模拟考试', '错题训练', '最近7天', '反复错题', '开始错题强化']) assert.match(ui, new RegExp(label, 'u'));
  assert.match(ui, /id="wrong-answer-form"/u);
  assert.match(ui, /data-wrong-rate="again"/u);
  assert.match(ui, /答题结果不会自动写成 AGAIN 或 GOOD/u);
  assert.match(ui, /aria-label="错题分类"/u);
  assert.match(server, /\/api\/wrong-questions\/overview/u);
  assert.match(server, /\/api\/wrong-questions\/training/u);
  assert.match(styles, /\.wrong-training/u);
  assert.match(styles, /@media\(max-width:620px\)[^{]*\{/u);
  assert.match(styles, /:focus-visible/u);
});

async function createScenario() {
  const catalog = createInMemoryStudyContentCatalog(frozen.contents);
  const adapter = createQuestionAnswerStudyAdapter({ collectionId:DRIVING_THEORY_USER_PDF_COLLECTION_ID });
  const partition = createLearnerDataPartition();
  const study = createGenericStudyRuntime({
    learnerId:'local-default', collection:frozen.collection, catalog, adapter, partition,
    scheduler:createFsrsSchedulerAdapter({ fallbackScheduler:createSimpleSchedulerAdapter({ legacyScheduler:createReviewScheduler() }) }),
  });
  const persistence = inMemoryPersistence();
  let currentTime = '2026-08-24T00:00:00.000Z';
  let sequence = 0;
  const mock = createDrivingTheoryMockExamRuntime({
    catalog,
    collectionId:DRIVING_THEORY_USER_PDF_COLLECTION_ID,
    persistence,
    metadataFor,
    clock:() => currentTime,
    idFactory:() => `wrong-training-exam:${++sequence}`,
  });

  currentTime = '2026-08-24T00:00:00.000Z';
  const first = await mock.start({ seed:'wrong-training-shared-paper' });
  const repeatedId = first.session.questionIds[0];
  const singleWrongId = first.session.questionIds[3];
  await answerWrong(mock, first.session.sessionId, repeatedId);
  await answerWrong(mock, first.session.sessionId, singleWrongId);
  currentTime = '2026-08-24T00:04:00.000Z';
  await mock.submit({ sessionId:first.session.sessionId, confirmIncomplete:true });

  currentTime = '2026-08-24T01:00:00.000Z';
  const second = await mock.start({ seed:'wrong-training-shared-paper' });
  await answerWrong(mock, second.session.sessionId, repeatedId);
  currentTime = '2026-08-24T01:04:00.000Z';
  await mock.submit({ sessionId:second.session.sessionId, confirmIncomplete:true });

  currentTime = '2026-08-24T01:10:00.000Z';
  const abandoned = await mock.start({ seed:'wrong-training-abandoned-paper' });
  const abandonedWrongId = abandoned.session.questionIds[0];
  await answerWrong(mock, abandoned.session.sessionId, abandonedWrongId);
  await mock.abandon({ sessionId:abandoned.session.sessionId });

  const firstContent = catalog.get(repeatedId);
  study.session.rate(repeatedId, ReviewRating.GOOD, { at:'2026-08-24T01:20:00.000Z' });
  study.session.master(repeatedId, { at:'2026-08-24T01:21:00.000Z' });
  assert.equal(study.progressStore.getState(adapter.adapt(firstContent).studyItem.itemId).progress.stage, 'mastered');

  const used = new Set(first.session.questionIds);
  const studyDifficultyId = frozen.contents.find((item) => !used.has(item.contentId)).contentId;
  study.session.rate(studyDifficultyId, ReviewRating.AGAIN, { at:'2026-08-24T01:30:00.000Z' });
  const scenario = {
    catalog, adapter, partition, study, persistence,
    repeatedId, singleWrongId, studyDifficultyId, abandonedWrongId,
    firstSessionId:first.session.sessionId,
    snapshotAt:'2026-08-24T01:40:00.000Z',
    projection:null,
  };
  scenario.projection = createProjection(scenario);
  return scenario;

  async function answerWrong(runtime, sessionId, questionId) {
    const content = catalog.get(questionId);
    const wrong = content.options.find((option) => option !== content.correctAnswer);
    await runtime.answer({ sessionId, questionId, selectedOption:wrong });
  }
}

function createProjection(scenario) {
  return createDrivingTheoryWrongQuestionProjection({
    catalog:scenario.catalog,
    adapter:scenario.adapter,
    progressStore:scenario.study.progressStore,
    reviewRecordStore:scenario.study.reviewRecordStore,
    mockExamPersistence:scenario.persistence,
    metadataFor,
    clock:() => '2026-08-24T02:00:00.000Z',
  });
}

function metadataFor(questionId) {
  const item = frozen.getFrozenItem(questionId);
  return {
    sourcePage:item.sourcePage,
    sourceQuestionType:item.sourceQuestionType,
    imageRequired:item.imageRequired,
    mediaUrl:item.imageRequired ? `/api/private-media/driving-user-pdf/page-${String(item.sourcePage).padStart(3,'0')}-question.jpg` : null,
    imageAlt:item.imageRequired ? `科目一资料第 ${item.sourcePage} 页题图，仅用于本题作答` : null,
  };
}

function inMemoryPersistence() {
  let document = createEmptyMockExamDocument();
  return {
    async load() { return document; },
    async save(input) {
      const base = { schemaVersion:'0.1', activeSessionId:input.activeSessionId, sessions:input.sessions };
      document = Object.freeze({ ...base, contentHash:calculateMockExamDocumentHash(base) });
      return document;
    },
  };
}
