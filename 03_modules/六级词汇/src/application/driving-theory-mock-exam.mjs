import { createHash, randomInt, randomUUID } from 'node:crypto';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { DRIVING_THEORY_USER_PDF_COLLECTION_ID } from '../import/driving-theory-user-pdf-pilot.mjs';

export const DRIVING_THEORY_MOCK_EXAM_VERSION = '0.1';
export const DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT = 100;
export const DRIVING_THEORY_MOCK_EXAM_PASS_SCORE = 90;
export const DrivingTheoryMockExamStatus = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  ABANDONED: 'ABANDONED',
});

const SESSION_KEYS = [
  'schemaVersion', 'sessionId', 'collectionId', 'createdAt', 'updatedAt',
  'questionCount', 'questionIds', 'currentIndex', 'answers', 'submittedAt',
  'score', 'passResult', 'correctCount', 'wrongCount', 'unansweredCount', 'status',
];

export function createSeededMockExamRng(seed) {
  if (typeof seed !== 'string' || seed.trim() === '') throw new TypeError('non-empty seed required');
  let state = createHash('sha256').update(seed, 'utf8').digest().readUInt32LE(0) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function selectDrivingTheoryMockExamQuestionIds({ contents, seed, rng }) {
  if (!Array.isArray(contents) || contents.length < DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT) throw new TypeError('at least 100 Driving contents required');
  const ids = contents.map((content) => requireText(content?.contentId, 'content.contentId'));
  if (new Set(ids).size !== ids.length) throw new TypeError('Driving content identities must be unique');
  const random = seed === undefined ? (rng ?? productionRng) : createSeededMockExamRng(seed);
  if (typeof random !== 'function') throw new TypeError('rng function required');
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new TypeError('rng must return [0, 1)');
    const swap = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return deepFreeze(shuffled.slice(0, DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT));
}

export function createDrivingTheoryMockExamSession({
  sessionId = `driving-mock-exam:${randomUUID()}`,
  questionIds,
  createdAt,
  collectionId = DRIVING_THEORY_USER_PDF_COLLECTION_ID,
}) {
  const timestamp = requireCanonicalIsoDateTime(createdAt, 'createdAt');
  return validateDrivingTheoryMockExamSession({
    schemaVersion: DRIVING_THEORY_MOCK_EXAM_VERSION,
    sessionId,
    collectionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    questionCount: DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT,
    questionIds,
    currentIndex: 0,
    answers: [],
    submittedAt: null,
    score: null,
    passResult: null,
    correctCount: null,
    wrongCount: null,
    unansweredCount: null,
    status: DrivingTheoryMockExamStatus.IN_PROGRESS,
  });
}

export function validateDrivingTheoryMockExamSession(input) {
  requireObject(input, 'session');
  requireExactKeys(input, SESSION_KEYS, 'session');
  if (input.schemaVersion !== DRIVING_THEORY_MOCK_EXAM_VERSION) throw new TypeError(`session.schemaVersion must be ${DRIVING_THEORY_MOCK_EXAM_VERSION}`);
  const sessionId = requireText(input.sessionId, 'session.sessionId');
  const collectionId = requireText(input.collectionId, 'session.collectionId');
  if (collectionId !== DRIVING_THEORY_USER_PDF_COLLECTION_ID) throw new TypeError('session.collectionId must be the Driving collection');
  const createdAt = requireCanonicalIsoDateTime(input.createdAt, 'session.createdAt');
  const updatedAt = requireCanonicalIsoDateTime(input.updatedAt, 'session.updatedAt');
  if (updatedAt < createdAt) throw new TypeError('session.updatedAt cannot precede createdAt');
  if (input.questionCount !== DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT) throw new TypeError('session.questionCount must be 100');
  if (!Array.isArray(input.questionIds) || input.questionIds.length !== DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT) throw new TypeError('session.questionIds must contain 100 identities');
  const questionIds = input.questionIds.map((id) => requireText(id, 'session.questionIds[]'));
  if (new Set(questionIds).size !== questionIds.length) throw new TypeError('session.questionIds must be unique');
  requireInteger(input.currentIndex, 'session.currentIndex', 0, 99);
  if (!Array.isArray(input.answers)) throw new TypeError('session.answers array required');
  const answers = input.answers.map((answer) => validateAnswer(answer, questionIds));
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) throw new TypeError('session answers must be unique by questionId');
  const status = Object.values(DrivingTheoryMockExamStatus).includes(input.status) ? input.status : fail('unsupported session.status');
  const resultFields = ['score', 'correctCount', 'wrongCount', 'unansweredCount'];
  if (status === DrivingTheoryMockExamStatus.SUBMITTED) {
    requireCanonicalIsoDateTime(input.submittedAt, 'session.submittedAt');
    for (const key of resultFields) requireInteger(input[key], `session.${key}`, 0, 100);
    if (typeof input.passResult !== 'boolean') throw new TypeError('session.passResult boolean required');
    if (input.correctCount + input.wrongCount + input.unansweredCount !== 100) throw new TypeError('submitted result counts must reconcile to 100');
    if (input.score !== input.correctCount) throw new TypeError('score must equal correctCount');
    if (input.passResult !== (input.score >= DRIVING_THEORY_MOCK_EXAM_PASS_SCORE)) throw new TypeError('passResult does not match score');
  } else {
    if (input.submittedAt !== null || input.passResult !== null || resultFields.some((key) => input[key] !== null)) throw new TypeError('non-submitted session cannot contain score fields');
  }
  return deepFreeze({
    schemaVersion: DRIVING_THEORY_MOCK_EXAM_VERSION,
    sessionId,
    collectionId,
    createdAt,
    updatedAt,
    questionCount: DRIVING_THEORY_MOCK_EXAM_QUESTION_COUNT,
    questionIds: deepFreeze([...questionIds]),
    currentIndex: input.currentIndex,
    answers: deepFreeze(answers),
    submittedAt: input.submittedAt,
    score: input.score,
    passResult: input.passResult,
    correctCount: input.correctCount,
    wrongCount: input.wrongCount,
    unansweredCount: input.unansweredCount,
    status,
  });
}

export function createDrivingTheoryMockExamRuntime({
  catalog,
  collectionId = DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  persistence,
  metadataFor = () => null,
  clock = () => new Date().toISOString(),
  idFactory = () => `driving-mock-exam:${randomUUID()}`,
  rng = productionRng,
}) {
  if (collectionId !== DRIVING_THEORY_USER_PDF_COLLECTION_ID) throw new TypeError('Driving collection identity required');
  if (typeof catalog?.list !== 'function' || typeof catalog?.get !== 'function' || catalog.count() !== 500) throw new TypeError('formal 500-item Driving catalog required');
  if (typeof persistence?.load !== 'function' || typeof persistence?.save !== 'function') throw new TypeError('mock exam persistence required');
  if (typeof metadataFor !== 'function') throw new TypeError('metadataFor function required');
  let document;
  let chain = Promise.resolve();
  const ready = persistence.load().then((loaded) => {
    for (const session of loaded.sessions) validateAgainstCatalog(session);
    if (loaded.activeSessionId !== null) {
      const active = loaded.sessions.find((session) => session.sessionId === loaded.activeSessionId);
      if (!active || active.status !== DrivingTheoryMockExamStatus.IN_PROGRESS) throw new TypeError('active mock exam identity is invalid');
    }
    document = loaded;
  });

  function exclusive(operation) {
    const run = chain.then(async () => { await ready; return operation(); });
    chain = run.catch(() => {});
    return run;
  }

  async function save(next) {
    document = await persistence.save(next);
    return document;
  }

  async function landing() {
    await ready;
    const active = document.activeSessionId === null ? null : findSession(document.activeSessionId);
    return deepFreeze({
      ok: true,
      contract: contractSummary(),
      activeSession: active ? sessionSummary(active) : null,
      history: deepFreeze([...document.sessions].reverse().map(sessionSummary)),
    });
  }

  function start({ seed } = {}) {
    return exclusive(async () => {
      if (document.activeSessionId !== null) return failure('ACTIVE_MOCK_EXAM_EXISTS', 'continue or abandon the active mock exam first');
      const timestamp = requireCanonicalIsoDateTime(clock(), 'clock()');
      const questionIds = selectDrivingTheoryMockExamQuestionIds({ contents: catalog.list(), ...(seed === undefined ? { rng } : { seed }) });
      const session = createDrivingTheoryMockExamSession({ sessionId: idFactory(), questionIds, createdAt: timestamp, collectionId });
      validateAgainstCatalog(session);
      await save({ ...document, activeSessionId: session.sessionId, sessions: [...document.sessions, session] });
      return deepFreeze({ ok: true, session: sessionView(session) });
    });
  }

  async function active() {
    await ready;
    if (document.activeSessionId === null) return failure('ACTIVE_MOCK_EXAM_NOT_FOUND', 'no active mock exam');
    return deepFreeze({ ok: true, session: sessionView(findSession(document.activeSessionId)) });
  }

  function answer({ sessionId, questionId, selectedOption }) {
    return mutateInProgress(sessionId, (session, timestamp) => {
      const content = requireContent(questionId);
      if (!session.questionIds.includes(questionId)) throw coded('QUESTION_NOT_IN_SESSION', 'question does not belong to this mock exam');
      if (!content.options.includes(selectedOption)) throw coded('INVALID_EXAM_ANSWER', 'selected option is not valid for this question');
      const answers = session.answers.filter((item) => item.questionId !== questionId);
      answers.push({ questionId, selectedOption, answeredAt: timestamp });
      return { ...session, answers, updatedAt: timestamp };
    });
  }

  function navigate({ sessionId, index }) {
    requireInteger(index, 'index', 0, 99);
    return mutateInProgress(sessionId, (session, timestamp) => ({ ...session, currentIndex: index, updatedAt: timestamp }));
  }

  function submit({ sessionId, confirmIncomplete = false }) {
    return exclusive(async () => {
      const session = requireInProgress(sessionId);
      const unanswered = 100 - session.answers.length;
      if (unanswered > 0 && confirmIncomplete !== true) {
        return deepFreeze({ ok: true, requiresConfirmation: true, unansweredCount: unanswered, session: sessionView(session) });
      }
      const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer.selectedOption]));
      let correctCount = 0;
      let wrongCount = 0;
      for (const questionId of session.questionIds) {
        const selected = answerMap.get(questionId);
        if (selected === undefined) continue;
        if (selected === requireContent(questionId).correctAnswer) correctCount += 1;
        else wrongCount += 1;
      }
      const timestamp = requireCanonicalIsoDateTime(clock(), 'clock()');
      const submitted = validateDrivingTheoryMockExamSession({
        ...session,
        updatedAt: timestamp,
        submittedAt: timestamp,
        score: correctCount,
        passResult: correctCount >= DRIVING_THEORY_MOCK_EXAM_PASS_SCORE,
        correctCount,
        wrongCount,
        unansweredCount: unanswered,
        status: DrivingTheoryMockExamStatus.SUBMITTED,
      });
      await replaceSession(submitted, null);
      return deepFreeze({ ok: true, requiresConfirmation: false, result: resultView(submitted) });
    });
  }

  function abandon({ sessionId }) {
    return exclusive(async () => {
      const session = requireInProgress(sessionId);
      const timestamp = requireCanonicalIsoDateTime(clock(), 'clock()');
      const abandoned = validateDrivingTheoryMockExamSession({ ...session, updatedAt: timestamp, status: DrivingTheoryMockExamStatus.ABANDONED });
      await replaceSession(abandoned, null);
      return deepFreeze({ ok: true, session: sessionSummary(abandoned) });
    });
  }

  async function result(sessionId) {
    await ready;
    const session = findSession(sessionId);
    if (session.status !== DrivingTheoryMockExamStatus.SUBMITTED) return failure('MOCK_EXAM_NOT_SUBMITTED', 'mock exam has no formal result');
    return deepFreeze({ ok: true, result: resultView(session) });
  }

  async function review(sessionId, kind = 'wrong') {
    await ready;
    const session = findSession(sessionId);
    if (session.status !== DrivingTheoryMockExamStatus.SUBMITTED) return failure('MOCK_EXAM_NOT_SUBMITTED', 'mock exam must be submitted before review');
    if (!['wrong', 'all'].includes(kind)) throw new TypeError('review kind must be wrong or all');
    const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer.selectedOption]));
    const questions = session.questionIds.map((questionId, index) => {
      const content = requireContent(questionId);
      const selectedOption = answerMap.get(questionId) ?? null;
      const correct = selectedOption === content.correctAnswer;
      return {
        number: index + 1,
        questionId,
        question: content.question,
        options: content.options,
        selectedOption,
        correctAnswer: content.correctAnswer,
        explanation: content.explanation,
        correct,
        unanswered: selectedOption === null,
        metadata: safeMetadata(questionId),
      };
    }).filter((question) => kind === 'all' || (!question.correct && !question.unanswered));
    return deepFreeze({ ok: true, session: sessionSummary(session), kind, questions: deepFreeze(questions) });
  }

  function mutateInProgress(sessionId, mutator) {
    return exclusive(async () => {
      const session = requireInProgress(sessionId);
      const timestamp = requireCanonicalIsoDateTime(clock(), 'clock()');
      const next = validateDrivingTheoryMockExamSession(mutator(session, timestamp));
      validateAgainstCatalog(next);
      await replaceSession(next, next.sessionId);
      return deepFreeze({ ok: true, session: sessionView(next) });
    });
  }

  async function replaceSession(session, activeSessionId) {
    await save({ ...document, activeSessionId, sessions: document.sessions.map((item) => item.sessionId === session.sessionId ? session : item) });
  }

  function findSession(sessionId) {
    const canonicalId = requireText(sessionId, 'sessionId');
    const session = document.sessions.find((item) => item.sessionId === canonicalId);
    if (!session) throw coded('MOCK_EXAM_SESSION_NOT_FOUND', 'mock exam session not found');
    return session;
  }

  function requireInProgress(sessionId) {
    const session = findSession(sessionId);
    if (session.sessionId !== document.activeSessionId || session.status !== DrivingTheoryMockExamStatus.IN_PROGRESS) throw coded('MOCK_EXAM_NOT_IN_PROGRESS', 'mock exam is not in progress');
    return session;
  }

  function requireContent(questionId) {
    const content = catalog.get(questionId);
    if (!content) throw coded('MOCK_EXAM_CONTENT_MISSING', `Driving question is missing: ${questionId}`);
    return content;
  }

  function validateAgainstCatalog(session) {
    for (const questionId of session.questionIds) requireContent(questionId);
    for (const answer of session.answers) {
      if (!requireContent(answer.questionId).options.includes(answer.selectedOption)) throw new TypeError(`persisted answer is invalid: ${answer.questionId}`);
    }
  }

  function sessionView(session) {
    const answerMap = new Map(session.answers.map((answer) => [answer.questionId, answer.selectedOption]));
    const questionId = session.questionIds[session.currentIndex];
    const content = requireContent(questionId);
    return deepFreeze({
      ...sessionSummary(session),
      questionIds: session.questionIds,
      currentIndex: session.currentIndex,
      answeredQuestionIds: deepFreeze(session.answers.map((answer) => answer.questionId)),
      unansweredCount: 100 - session.answers.length,
      currentQuestion: {
        number: session.currentIndex + 1,
        questionId,
        question: content.question,
        options: content.options,
        selectedOption: answerMap.get(questionId) ?? null,
        metadata: safeMetadata(questionId),
      },
    });
  }

  function resultView(session) {
    return deepFreeze({ ...sessionSummary(session), score: session.score, passResult: session.passResult, correctCount: session.correctCount, wrongCount: session.wrongCount, unansweredCount: session.unansweredCount });
  }

  function safeMetadata(questionId) {
    const metadata = metadataFor(questionId);
    return metadata === null ? null : JSON.parse(JSON.stringify(metadata));
  }

  return Object.freeze({
    runtimeVersion: DRIVING_THEORY_MOCK_EXAM_VERSION,
    contract: contractSummary(),
    landing,
    start,
    active,
    answer,
    navigate,
    submit,
    abandon,
    result,
    review,
  });
}

function validateAnswer(input, questionIds) {
  requireObject(input, 'answer');
  requireExactKeys(input, ['questionId', 'selectedOption', 'answeredAt'], 'answer');
  const questionId = requireText(input.questionId, 'answer.questionId');
  if (!questionIds.includes(questionId)) throw new TypeError('answer.questionId is not in session');
  return deepFreeze({ questionId, selectedOption: requireText(input.selectedOption, 'answer.selectedOption'), answeredAt: requireCanonicalIsoDateTime(input.answeredAt, 'answer.answeredAt') });
}

function sessionSummary(session) {
  return deepFreeze({
    sessionId: session.sessionId,
    collectionId: session.collectionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    submittedAt: session.submittedAt,
    questionCount: session.questionCount,
    answeredCount: session.answers.length,
    status: session.status,
    score: session.score,
    passResult: session.passResult,
    correctCount: session.correctCount,
    wrongCount: session.wrongCount,
    unansweredCount: session.unansweredCount,
  });
}

function contractSummary() {
  return deepFreeze({ questionCount: 100, passScore: 90, scorePerQuestion: 1, maxScore: 100, collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID, studyProgressBridge: false });
}

function productionRng() { return randomInt(0, 4_294_967_296) / 4_294_967_296; }
function requireObject(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} object required`); }
function requireText(value, path) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} required`); return value.trim(); }
function requireInteger(value, path, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${path} must be an integer from ${min} to ${max}`); return value; }
function requireExactKeys(value, keys, path) { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${path} fields must be exactly: ${expected.join(', ')}`); }
function fail(message) { throw new TypeError(message); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
function failure(code, message) { return deepFreeze({ ok: false, error: { code, message } }); }
