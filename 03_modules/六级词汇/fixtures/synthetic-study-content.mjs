import { createMultipleChoiceContent, createQuestionAnswerContent } from '../src/index.mjs';

export const SYNTHETIC_STUDY_CONTENT_MARKER = 'TEST / SYNTHETIC';
export const SYNTHETIC_STUDY_CONTENT_TIMESTAMP = '2026-08-13T00:00:00.000Z';

export const SYNTHETIC_QA_CONTENT = createQuestionAnswerContent({
  contentId: 'qa:test:capital-france',
  contentType: 'question_answer',
  question: 'TEST / SYNTHETIC: What is the capital of France?',
  answer: 'Paris',
  explanation: 'Synthetic question used only for local tests.',
  tags: ['test', 'synthetic', 'geography'],
  sourceRef: 'test:synthetic-question-bank',
  createdAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
  updatedAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
});

export const SYNTHETIC_MC_CONTENT = createMultipleChoiceContent({
  contentId: 'mc:test:two-plus-two',
  contentType: 'multiple_choice',
  question: 'TEST / SYNTHETIC: 2 + 2 = ?',
  answer: '4',
  options: ['3', '4', '5'],
  correctAnswer: '4',
  explanation: 'Synthetic arithmetic item used only for local tests.',
  tags: ['test', 'synthetic', 'arithmetic'],
  sourceRef: 'test:synthetic-question-bank',
  createdAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
  updatedAt: SYNTHETIC_STUDY_CONTENT_TIMESTAMP,
});

export const SYNTHETIC_STUDY_CONTENTS = Object.freeze([SYNTHETIC_QA_CONTENT, SYNTHETIC_MC_CONTENT]);
