import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QaDisposition,
  applyDuplicateWarnings,
  chooseAutoPassSample,
  parseDrivingTheoryOcrRecord,
} from '../scripts/lib/driving-theory-ocr-draft-qa.mjs';

test('fixed page geometry yields a complete MC draft without external knowledge', () => {
  const draft = parseDrivingTheoryOcrRecord(record({
    type: '单选', question: ['安全行车应怎样操作？'], options: ['降低速度', '加速通过', '连续鸣笛', '占用对向车道'], answer: 'A', explanation: ['看到安全行车，选择降低速度'], image: false,
  }));
  assert.equal(draft.sourceQuestionType, 'MC');
  assert.deepEqual(draft.options, ['降低速度', '加速通过', '连续鸣笛', '占用对向车道']);
  assert.equal(draft.correctAnswerDraft, '降低速度');
  assert.equal(draft.qaDisposition, QaDisposition.AUTO_QA_CANDIDATE_PASS);
});

test('true/false remains multiple choice while preserving source type', () => {
  const draft = parseDrivingTheoryOcrRecord(record({
    type: '判断', question: ['驾驶人应当安全驾驶。'], options: ['正确', '错误'], answer: 'A', explanation: ['安全驾驶是基本要求'], image: false,
  }));
  assert.equal(draft.sourceQuestionType, 'TRUE_FALSE');
  assert.equal(draft.canonicalContentType, 'multiple_choice');
  assert.deepEqual(draft.options, ['正确', '错误']);
});

test('missing source answer is P0 and never auto-passes', () => {
  const input = record({ type: '单选', question: ['应当怎样做？'], options: ['甲选项', '乙选项', '丙选项', '丁选项'], answer: null, explanation: ['测试解析内容'], image: false });
  const draft = parseDrivingTheoryOcrRecord(input);
  assert.ok(draft.warningCodes.includes('ANSWER_MISSING'));
  assert.equal(draft.qaPriority, 'P0');
  assert.equal(draft.qaDisposition, QaDisposition.MANUAL_QA_REQUIRED);
});

test('image gap requires a deterministic private crop and missing media is P0', () => {
  const draft = parseDrivingTheoryOcrRecord(record({
    type: '单选', question: ['图中标志是什么？'], options: ['甲标志', '乙标志', '丙标志', '丁标志'], answer: 'B', explanation: ['根据图中标志选择'], image: true,
  }));
  assert.equal(draft.imageRequired, true);
  assert.ok(draft.derivedMediaCandidate.cropRegion.height > 0);
  assert.ok(draft.warningCodes.includes('MEDIA_MISSING'));
  assert.equal(draft.qaPriority, 'P0');
});

test('duplicates and conflicts are surfaced without choosing a correct answer', () => {
  const first = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['相同问题？'], options: ['甲选项', '乙选项', '丙选项', '丁选项'], answer: 'A', explanation: ['测试解析内容'], image: false, page: 200 }));
  const second = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['相同问题？'], options: ['甲选项', '乙选项', '丙选项', '丁选项'], answer: 'B', explanation: ['测试解析内容'], image: false, page: 201 }));
  const audit = applyDuplicateWarnings([first, second]);
  assert.equal(audit.answerConflictGroups, 1);
  assert.ok(first.warningCodes.includes('SAME_QUESTION_DIFFERENT_ANSWER'));
  assert.equal(first.qaPriority, 'P1');
});

test('same wording and options with different media identities are not duplicates or answer conflicts', () => {
  const first = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['在这条车道行驶的最低车速是多少？'], options: ['60公里/小时', '90公里/小时', '100公里/小时', '110公里/小时'], answer: 'B', explanation: ['按图中车道判断'], image: true, page: 395 }), { mediaPresent: true });
  const second = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['在这条车道行驶的最低车速是多少？'], options: ['60公里/小时', '90公里/小时', '100公里/小时', '110公里/小时'], answer: 'C', explanation: ['按图中车道判断'], image: true, page: 396 }), { mediaPresent: true });
  first.mediaIdentitySha256 = 'a'.repeat(64);
  second.mediaIdentitySha256 = 'b'.repeat(64);
  const audit = applyDuplicateWarnings([first, second]);
  assert.equal(audit.exactDuplicateGroups, 0);
  assert.equal(audit.answerConflictGroups, 0);
  assert.ok(!first.warningCodes.includes('SAME_QUESTION_DIFFERENT_ANSWER'));
});

test('negation and numeric presence alone do not create semantic risk warnings', () => {
  const draft = parseDrivingTheoryOcrRecord(record({
    type: '单选', question: ['在4车道道路上，以下哪项不得实施？'], options: ['安全减速', '依次通行', '保持车距', '违法超车'], answer: 'D', explanation: ['完整解析内容'], image: false,
  }));
  assert.ok(!draft.warningCodes.includes('NEGATION_TERM_RISK'));
  assert.ok(!draft.warningCodes.includes('NUMERIC_CONTENT_RISK'));
  assert.equal(draft.qaDisposition, QaDisposition.AUTO_QA_CANDIDATE_PASS);
});

test('normal numeric and abbreviation options are not suspicious', () => {
  const numeric = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['限速选项是什么？'], options: ['30', '40', '50', '60'], answer: 'A', explanation: ['完整解析内容'], image: false }));
  const abbreviation = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['自适应巡航缩写是什么？'], options: ['FCW', 'BSD', 'ACC', 'AEB'], answer: 'C', explanation: ['完整解析内容'], image: false }));
  assert.ok(!numeric.warningCodes.includes('OPTION_TEXT_SUSPECT'));
  assert.ok(!abbreviation.warningCodes.includes('OPTION_TEXT_SUSPECT'));
});

test('selected filled marker label absence is not treated as option-label risk', () => {
  const input = record({ type: '单选', question: ['普通安全问题？'], options: ['甲选项', '乙选项', '丙选项', '丁选项'], answer: 'C', explanation: ['普通完整解析'], image: false });
  const selectedLabelIndex = input.lines.indexOf('C');
  input.lines.splice(selectedLabelIndex, 1);
  input.boxes.splice(selectedLabelIndex, 1);
  input.scores.splice(selectedLabelIndex, 1);
  const draft = parseDrivingTheoryOcrRecord(input);
  assert.deepEqual(draft.options, ['甲选项', '乙选项', '丙选项', '丁选项']);
  assert.ok(!draft.warningCodes.includes('OPTION_LABEL_MISSING'));
});

test('image-region OCR text is layout-aware and not treated as unassigned option text', () => {
  const input = record({ type: '单选', question: ['图中标志是什么？'], options: ['甲标志', '乙标志', '丙标志', '丁标志'], answer: 'B', explanation: ['根据图中标志选择'], image: true });
  input.lines.splice(3, 0, '60 km/h');
  input.boxes.splice(3, 0, box(900, 800));
  input.scores.splice(3, 0, 0.99);
  const draft = parseDrivingTheoryOcrRecord(input, { mediaPresent: true });
  assert.ok(!draft.warningCodes.includes('LAYOUT_UNEXPECTED'));
});

test('structural truncation and compacted ordered digits remain safety warnings', () => {
  const truncated = parseDrivingTheoryOcrRecord(record({ type: '判断', question: ['打开后雾灯开关，（'], options: ['正确', '错误'], answer: 'B', explanation: ['普通完整解析'], image: false }));
  const ordered = parseDrivingTheoryOcrRecord(record({ type: '单选', question: ['操作顺序是什么？'], options: ['④③①②', '1234', '③②①④', '②③①④'], answer: 'D', explanation: ['普通完整解析'], image: false }));
  assert.ok(truncated.warningCodes.includes('QUESTION_TRUNCATED'));
  assert.ok(ordered.warningCodes.includes('OPTION_TEXT_SUSPECT'));
});

test('all four layout variants remain classified', () => {
  const variants = [
    ['单选', ['甲选项', '乙选项', '丙选项', '丁选项'], false, 'MC_TEXT'],
    ['单选', ['甲选项', '乙选项', '丙选项', '丁选项'], true, 'MC_IMAGE'],
    ['判断', ['正确', '错误'], false, 'TRUE_FALSE_TEXT'],
    ['判断', ['正确', '错误'], true, 'TRUE_FALSE_IMAGE'],
  ];
  for (const [type, options, image, expected] of variants) {
    const draft = parseDrivingTheoryOcrRecord(record({ type, question: ['完整问题？'], options, answer: 'A', explanation: ['普通完整解析'], image }), { mediaPresent: true });
    assert.equal(draft.layoutVariant, expected);
  }
});

test('auto-pass sampling is deterministic and stratified', () => {
  const drafts = Array.from({ length: 12 }, (_, index) => parseDrivingTheoryOcrRecord(record({
    type: index % 2 ? '判断' : '单选',
    question: [`普通安全问题${index}？`],
    options: index % 2 ? ['正确', '错误'] : ['甲选项', '乙选项', '丙选项', '丁选项'],
    answer: 'A', explanation: ['普通完整解析'], image: false, page: 10 + index,
  })));
  assert.deepEqual(chooseAutoPassSample(drafts, 6).map((item) => item.sourcePage), chooseAutoPassSample(drafts, 6).map((item) => item.sourcePage));
});

test('unassigned option text remains routed to manual QA without label-only over-warning', () => {
  const input = record({ type: '单选', question: ['普通安全问题？'], options: ['甲选项', '乙选项', '丙选项', '丁选项'], answer: 'D', explanation: ['普通完整解析'], image: false });
  input.lines.splice(3, 1);
  input.boxes.splice(3, 1);
  input.scores.splice(3, 1);
  input.lines.splice(3, 0, '未分配的选项残片');
  input.boxes.splice(3, 0, box(470, 390));
  input.scores.splice(3, 0, 0.99);
  input.lines[5] = '';
  const draft = parseDrivingTheoryOcrRecord(input);
  assert.ok(draft.warningCodes.includes('LAYOUT_UNEXPECTED'));
  assert.ok(!draft.warningCodes.includes('OPTION_LABEL_MISSING'));
  assert.equal(draft.qaDisposition, QaDisposition.MANUAL_QA_REQUIRED);
});

function record({ type, question, options, answer, explanation, image, page = 150 }) {
  const optionCount = options.length;
  const firstOptionY = image ? 1450 : 520;
  const answerY = firstOptionY + (optionCount - 1) * 252.5 + 350;
  const lines = [`第${page}页`, type, ...question];
  const boxes = [box(2100, 30), box(300, 120), ...question.map((_, index) => box(470, 115 + index * 130))];
  const scores = lines.map(() => 0.99);
  options.forEach((option, index) => {
    lines.push(String.fromCharCode(65 + index), option);
    boxes.push(box(300, firstOptionY + index * 252.5), box(470, firstOptionY + index * 252.5));
    scores.push(0.99, 0.99);
  });
  if (answer) {
    lines.push(`答案${answer}`);
    boxes.push(box(470, answerY));
    scores.push(0.99);
  }
  explanation.forEach((text, index) => {
    lines.push(text);
    boxes.push(box(470, answerY + 200 + index * 130));
    scores.push(0.99);
  });
  return { page, lines, boxes, scores, imageWidth: 2480, imageHeight: 3508 };
}

function box(x, y) {
  return [[x, y], [x + 600, y], [x + 600, y + 60], [x, y + 60]];
}
