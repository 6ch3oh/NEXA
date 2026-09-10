import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  DRIVING_THEORY_USER_PDF_COLLECTION,
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  ReviewRating,
  calculateMockExamDocumentHash,
  createDrivingTheoryMockExamRuntime,
  createEmptyMockExamDocument,
  createFsrsSchedulerAdapter,
  createGenericStudyRuntime,
  createInMemoryStudyContentCatalog,
  createLearnerDataPartition,
  createLearnerSnapshot,
  createLocalMockExamPersistence,
  createQuestionAnswerStudyAdapter,
  createReviewScheduler,
  createSimpleSchedulerAdapter,
  loadDrivingTheoryFrozenV1,
  selectDrivingTheoryMockExamQuestionIds,
} from '../src/index.mjs';

const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixedTime = '2026-08-23T18:00:00.000Z';
const frozen = await loadDrivingTheoryFrozenV1({ moduleRoot, verifyMedia: false });

test('seeded 500-to-100 assembly is unique, Driving-only, reproducible and media/type safe', () => {
  const first = selectDrivingTheoryMockExamQuestionIds({ contents: frozen.contents, seed: 'mock-exam-seed-a' });
  const repeat = selectDrivingTheoryMockExamQuestionIds({ contents: frozen.contents, seed: 'mock-exam-seed-a' });
  const other = selectDrivingTheoryMockExamQuestionIds({ contents: frozen.contents, seed: 'mock-exam-seed-b' });
  assert.equal(first.length, 100);
  assert.equal(new Set(first).size, 100);
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, other);
  const formalIds = new Set(frozen.contents.map((content) => content.contentId));
  assert.equal(first.every((id) => formalIds.has(id)), true);
  const selected = first.map((id) => frozen.getFrozenItem(id));
  assert.equal(selected.every((item) => item.canonicalContentType === 'multiple_choice'), true);
  assert.ok(selected.some((item) => item.imageRequired));
  assert.ok(selected.some((item) => item.sourceQuestionType === 'TRUE_FALSE'));
  for (const item of selected.filter((candidate) => candidate.sourceQuestionType === 'TRUE_FALSE')) {
    assert.deepEqual(frozen.contents.find((content) => content.contentId === item.studyItemIdentity).options, ['正确', '错误']);
  }
});

test('in-progress exam allows answer edits and never exposes correctness before submit', async () => {
  const runtime = createRuntime({ persistence: inMemoryPersistence(), seedId: 'edit' });
  const started = await runtime.start({ seed: 'answer-edit' });
  const question = started.session.currentQuestion;
  const content = frozen.contents.find((item) => item.contentId === question.questionId);
  const wrong = content.options.find((option) => option !== content.correctAnswer);
  const first = await runtime.answer({ sessionId: started.session.sessionId, questionId: question.questionId, selectedOption: wrong });
  assert.equal(first.session.answeredQuestionIds.length, 1);
  const edited = await runtime.answer({ sessionId: started.session.sessionId, questionId: question.questionId, selectedOption: content.correctAnswer });
  assert.equal(edited.session.answeredQuestionIds.length, 1);
  assert.equal(edited.session.currentQuestion.selectedOption, content.correctAnswer);
  assert.equal(JSON.stringify(edited).includes('correctAnswer'), false);
  assert.equal(JSON.stringify(edited).includes('explanation'), false);
});

test('scoring contract proves 100 PASS, 90 PASS, 89 FAIL and 0 FAIL', async () => {
  for (const scenario of [
    { correct: 100, expectedScore: 100, pass: true },
    { correct: 90, expectedScore: 90, pass: true },
    { correct: 89, expectedScore: 89, pass: false },
    { correct: 0, expectedScore: 0, pass: false },
  ]) {
    const runtime = createRuntime({ persistence: inMemoryPersistence(), seedId: `score-${scenario.correct}` });
    const started = await runtime.start({ seed: `score-seed-${scenario.correct}` });
    await answerCount(runtime, started.session, scenario.correct, 100 - scenario.correct);
    const submitted = await runtime.submit({ sessionId: started.session.sessionId });
    assert.equal(submitted.requiresConfirmation, false);
    assert.equal(submitted.result.score, scenario.expectedScore);
    assert.equal(submitted.result.passResult, scenario.pass);
    assert.equal(submitted.result.correctCount, scenario.correct);
    assert.equal(submitted.result.wrongCount, 100 - scenario.correct);
    assert.equal(submitted.result.unansweredCount, 0);
    assert.equal(submitted.result.correctCount + submitted.result.wrongCount + submitted.result.unansweredCount, 100);
  }
});

test('partial paper requires explicit confirmation and unanswered questions score zero', async () => {
  const runtime = createRuntime({ persistence: inMemoryPersistence(), seedId: 'partial' });
  const started = await runtime.start({ seed: 'partial-seed' });
  await answerCount(runtime, started.session, 30, 10);
  const warning = await runtime.submit({ sessionId: started.session.sessionId });
  assert.equal(warning.requiresConfirmation, true);
  assert.equal(warning.unansweredCount, 60);
  const stillActive = await runtime.active();
  assert.equal(stillActive.session.status, 'IN_PROGRESS');
  const submitted = await runtime.submit({ sessionId: started.session.sessionId, confirmIncomplete: true });
  assert.deepEqual({ score:submitted.result.score, correct:submitted.result.correctCount, wrong:submitted.result.wrongCount, unanswered:submitted.result.unansweredCount, pass:submitted.result.passResult }, { score:30, correct:30, wrong:10, unanswered:60, pass:false });
});

test('submitted result projects wrong answers and all questions without a second mistake domain', async () => {
  const runtime = createRuntime({ persistence: inMemoryPersistence(), seedId: 'review' });
  const started = await runtime.start({ seed: 'review-seed' });
  await answerCount(runtime, started.session, 98, 2);
  const submitted = await runtime.submit({ sessionId: started.session.sessionId });
  const wrong = await runtime.review(submitted.result.sessionId, 'wrong');
  assert.equal(wrong.questions.length, 2);
  assert.equal(wrong.questions.every((item) => !item.correct && item.selectedOption !== null && item.correctAnswer && 'explanation' in item), true);
  assert.ok(wrong.questions.filter((item) => item.metadata?.imageRequired).every((item) => item.metadata.mediaUrl));
  const all = await runtime.review(submitted.result.sessionId, 'all');
  assert.equal(all.questions.length, 100);
  const landing = await runtime.landing();
  assert.equal(landing.history.length, 1);
  assert.equal(landing.history[0].score, 98);
});

test('atomic exam persistence restores fixed order, current index and answers after restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-mock-exam-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'mock-exams.json');
  const persistence = createLocalMockExamPersistence({ filePath });
  const runtime = createRuntime({ persistence, seedId: 'resume' });
  const started = await runtime.start({ seed: 'restart-seed' });
  const first = started.session.currentQuestion;
  await runtime.answer({ sessionId: started.session.sessionId, questionId: first.questionId, selectedOption: first.options[0] });
  await runtime.navigate({ sessionId: started.session.sessionId, index: 31 });

  const restarted = createRuntime({ persistence:createLocalMockExamPersistence({ filePath }), seedId:'unused-after-restart' });
  const restored = await restarted.active();
  assert.equal(restored.ok, true);
  assert.equal(restored.session.sessionId, started.session.sessionId);
  assert.deepEqual(restored.session.questionIds, started.session.questionIds);
  assert.equal(restored.session.currentIndex, 31);
  assert.equal(restored.session.answeredQuestionIds.includes(first.questionId), true);
  assert.equal((await restarted.start()).error.code, 'ACTIVE_MOCK_EXAM_EXISTS');
});

test('abandon is explicit, produces no score and keeps prior history', async () => {
  const runtime = createRuntime({ persistence: inMemoryPersistence(), seedId: 'abandon' });
  const first = await runtime.start({ seed: 'abandon-one' });
  await runtime.answer({ sessionId:first.session.sessionId, questionId:first.session.currentQuestion.questionId, selectedOption:first.session.currentQuestion.options[0] });
  const abandoned = await runtime.abandon({ sessionId:first.session.sessionId });
  assert.equal(abandoned.session.status, 'ABANDONED');
  assert.equal(abandoned.session.score, null);
  const second = await runtime.start({ seed: 'abandon-two' });
  assert.notEqual(second.session.sessionId, first.session.sessionId);
  const landing = await runtime.landing();
  assert.equal(landing.history.some((item) => item.status === 'ABANDONED' && item.score === null), true);
});

test('corrupt exam JSON and integrity mismatch fail closed', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexa-mock-exam-corrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'mock-exams.json');
  const persistence = createLocalMockExamPersistence({ filePath });
  await writeFile(filePath, '{bad', 'utf8');
  await assert.rejects(persistence.load(), (error) => error.code === 'INVALID_MOCK_EXAM_JSON');
  const empty = createEmptyMockExamDocument();
  await writeFile(filePath, `${JSON.stringify({ ...empty, contentHash:'0'.repeat(64) })}\n`, 'utf8');
  await assert.rejects(persistence.load(), (error) => error.code === 'MOCK_EXAM_HASH_MISMATCH');
  assert.match(await readFile(filePath, 'utf8'), /"contentHash":"0000/u);
});

test('exam answers, submit and abandon do not mutate learner, FSRS, mastered or Study Queue', async () => {
  const partition = createLearnerDataPartition();
  const study = createGenericStudyRuntime({
    learnerId:'local-default', collection:frozen.collection,
    catalog:createInMemoryStudyContentCatalog(frozen.contents),
    adapter:createQuestionAnswerStudyAdapter({ collectionId:DRIVING_THEORY_USER_PDF_COLLECTION_ID }),
    partition,
    scheduler:createFsrsSchedulerAdapter({ fallbackScheduler:createSimpleSchedulerAdapter({ legacyScheduler:createReviewScheduler() }) }),
  });
  study.session.rate(frozen.contents[0].contentId, ReviewRating.GOOD, { at:fixedTime });
  study.session.rate(frozen.contents[1].contentId, ReviewRating.GOOD, { at:'2026-08-23T18:01:00.000Z' });
  study.session.master(frozen.contents[1].contentId, { at:'2026-08-23T18:02:00.000Z' });
  const plan = study.createPlan({ dailyNewLimit:7, dailyReviewLimit:3, dailyTotalLimit:10 });
  const beforeSnapshot = createLearnerSnapshot(partition, { createdAt:fixedTime, updatedAt:fixedTime });
  const beforeQueue = study.queue.build({ now:'2026-08-24T18:00:00.000Z', plan });
  const runtime = createRuntime({ persistence:inMemoryPersistence(), seedId:'isolation' });
  const exam = await runtime.start({ seed:'isolation-seed' });
  await answerCount(runtime, exam.session, 20, 10);
  await runtime.submit({ sessionId:exam.session.sessionId, confirmIncomplete:true });
  const abandoned = await runtime.start({ seed:'isolation-abandon' });
  await runtime.abandon({ sessionId:abandoned.session.sessionId });
  const afterSnapshot = createLearnerSnapshot(partition, { createdAt:fixedTime, updatedAt:fixedTime });
  const afterQueue = study.queue.build({ now:'2026-08-24T18:00:00.000Z', plan });
  assert.deepEqual(afterSnapshot, beforeSnapshot);
  assert.deepEqual(afterQueue, beforeQueue);
});

test('mock exam UI preserves native radio semantics and restores focus after an async answer save', async () => {
  const ui = await readFile(join(moduleRoot, 'ui', 'app.mjs'), 'utf8');
  const styles = await readFile(join(moduleRoot, 'ui', 'styles.css'), 'utf8');
  assert.match(ui, /type="radio" name="selectedOption"/u);
  assert.match(ui, /const selectedIndex = controls\.indexOf\(event\.target\)/u);
  assert.match(ui, /\[selectedIndex\]\?\.focus\(\{ preventScroll:true \}\)/u);
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /grid-template-columns:repeat\(5,minmax\(38px,1fr\)\)/u);
});

function createRuntime({ persistence, seedId }) {
  let sequence = 0;
  return createDrivingTheoryMockExamRuntime({
    catalog:createInMemoryStudyContentCatalog(frozen.contents),
    collectionId:DRIVING_THEORY_USER_PDF_COLLECTION_ID,
    persistence,
    metadataFor:(questionId) => {
      const item = frozen.getFrozenItem(questionId);
      return {
        sourcePage:item.sourcePage,
        sourceQuestionType:item.sourceQuestionType,
        imageRequired:item.imageRequired,
        mediaUrl:item.imageRequired ? `/api/private-media/driving-user-pdf/page-${String(item.sourcePage).padStart(3,'0')}-question.jpg` : null,
        imageAlt:item.imageRequired ? `科目一资料第 ${item.sourcePage} 页题图，仅用于本题作答` : null,
      };
    },
    clock:() => fixedTime,
    idFactory:() => `driving-mock-exam:${seedId}:${++sequence}`,
  });
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

async function answerCount(runtime, session, correctCount, wrongCount) {
  for (let index = 0; index < correctCount + wrongCount; index += 1) {
    const questionId = session.questionIds[index];
    const content = frozen.contents.find((item) => item.contentId === questionId);
    const selectedOption = index < correctCount ? content.correctAnswer : content.options.find((option) => option !== content.correctAnswer);
    await runtime.answer({ sessionId:session.sessionId, questionId, selectedOption });
  }
}
