import { deepFreeze, normalizeIdentifier, normalizeUniqueStrings, requireCanonicalIsoDateTime, requireExactKeys, requirePlainObject } from '../domain/shared.mjs';

export const QUESTION_ANSWER_CONTENT_VERSION = '0.1';

export function createQuestionAnswerContent(input) {
  return createContent(input, 'question_answer', []);
}

export function createMultipleChoiceContent(input) {
  const content = createContent(input, 'multiple_choice', ['options', 'correctAnswer']);
  if (!Array.isArray(input.options) || input.options.length < 2) throw new TypeError('options must contain at least two values');
  const options = input.options.map((option, index) => requireText(option, `options[${index}]`));
  const correctAnswer = requireText(input.correctAnswer, 'correctAnswer');
  if (!options.includes(correctAnswer)) throw new TypeError('correctAnswer must match an option');
  return deepFreeze({ ...content, options, correctAnswer });
}

export function evaluateMultipleChoiceAnswer(content, selectedOption) {
  if (content?.contentType !== 'multiple_choice' || !Array.isArray(content.options)) throw new TypeError('multiple-choice content required');
  const selected = requireText(selectedOption, 'selectedOption');
  if (!content.options.includes(selected)) throw new TypeError('selectedOption must match an option');
  return deepFreeze({
    contentId: content.contentId,
    selectedOption: selected,
    correct: selected === content.correctAnswer,
    correctAnswer: content.correctAnswer,
    explanation: content.explanation,
  });
}

function createContent(input, contentType, additionalKeys) {
  requirePlainObject(input, 'content');
  requireExactKeys(input, [
    'schemaVersion', 'contentId', 'contentType', 'question', 'answer', 'explanation', 'tags',
    'sourceRef', 'createdAt', 'updatedAt', ...additionalKeys,
  ], 'content');
  if (input.schemaVersion !== undefined && input.schemaVersion !== QUESTION_ANSWER_CONTENT_VERSION) throw new TypeError('unsupported content schemaVersion');
  if (input.contentType !== undefined && input.contentType !== contentType) throw new TypeError(`contentType must be ${contentType}`);
  const content = {
    schemaVersion: QUESTION_ANSWER_CONTENT_VERSION,
    contentId: normalizeIdentifier(input.contentId, 'contentId'),
    contentType,
    question: requireText(input.question, 'question'),
    answer: requireText(input.answer ?? input.correctAnswer, 'answer'),
    explanation: input.explanation == null ? null : requireText(input.explanation, 'explanation'),
    tags: normalizeUniqueStrings(input.tags ?? [], 'tags', { maxItems: 50, maxLength: 64, lowercase: true }),
    sourceRef: requireText(input.sourceRef, 'sourceRef'),
    createdAt: requireCanonicalIsoDateTime(input.createdAt, 'createdAt'),
    updatedAt: requireCanonicalIsoDateTime(input.updatedAt, 'updatedAt'),
  };
  if (content.updatedAt < content.createdAt) throw new TypeError('updatedAt must not precede createdAt');
  return deepFreeze(content);
}

function requireText(value, path) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} must be a non-empty string`);
  return value.trim();
}
