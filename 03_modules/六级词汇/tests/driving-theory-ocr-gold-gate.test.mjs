import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateGoldSet,
  hasAnswerSignal,
  normalizeOcrComparable,
  orderedCharacterCoverage,
} from '../scripts/evaluate-driving-theory-ocr-gold-set.mjs';

test('OCR normalization preserves semantic characters and removes layout punctuation', () => {
  assert.equal(normalizeOcrComparable(' 答案：Ｂ（50%） '), '答案b50%');
});

test('ordered coverage detects substitutions without requiring exact OCR layout', () => {
  assert.equal(orderedCharacterCoverage('路面湿滑，视线受阻', 'B. 路面湿滑，视线受阻'), 1);
  assert.ok(orderedCharacterCoverage('路面湿滑，视线受阻', '路面湿滑，视野受阻') < 1);
});

test('answer signal requires an answer label and the expected option letter', () => {
  assert.equal(hasAnswerSignal(['正确答案：B'], 'B'), true);
  assert.equal(hasAnswerSignal(['正确答案：A'], 'B'), false);
  assert.equal(hasAnswerSignal(['选项中提到了B'], 'B'), false);
});

test('Gold Set evaluation fails missing options and changed answers', () => {
  const item = {
    sourcePage: 2,
    sourceQuestionType: 'MC',
    sourceAnswer: 'B',
    content: {
      question: '测试题目',
      options: ['选项甲', '选项乙'],
      explanation: '测试解析',
    },
  };
  const report = evaluateGoldSet({ records: [{ page: 2, lines: ['测试题目', 'A.选项甲', '答案：A', '测试解析'] }] }, [item]);
  assert.equal(report.status, 'FAIL');
  assert.deepEqual(report.pages[0].reasons, [
    'OPTION_B_FIDELITY_BELOW_GATE',
    'OPTION_B_NOT_EXACT_AFTER_NORMALIZATION',
    'ANSWER_SIGNAL_MISSING_OR_CHANGED',
  ]);
});
