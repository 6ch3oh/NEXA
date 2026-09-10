import { createHash } from 'node:crypto';

export const DRIVING_SOURCE_SHA256 = '3409364b3f56ade44ce8940ade9cc15cccb7035e7eac5cef668c1de3ac83def9';
export const OCR_DRAFT_SCHEMA_VERSION = '1.0';

export const QaDisposition = Object.freeze({
  AUTO_QA_CANDIDATE_PASS: 'AUTO_QA_CANDIDATE_PASS',
  MANUAL_QA_REQUIRED: 'MANUAL_QA_REQUIRED',
  EXTRACTION_BLOCKED: 'EXTRACTION_BLOCKED',
});

export const WarningPriority = Object.freeze({
  OCR_EXECUTION_FAILED: 'P0',
  QUESTION_EMPTY: 'P0',
  ANSWER_MISSING: 'P0',
  ANSWER_AMBIGUOUS: 'P0',
  ANSWER_NOT_IN_OPTIONS: 'P0',
  ANSWER_PARSING_CONFLICT: 'P0',
  OPTION_MISSING: 'P0',
  OPTION_EMPTY: 'P0',
  MEDIA_MISSING: 'P0',
  NEGATION_TERM_RISK: 'P1',
  NUMERIC_CONTENT_RISK: 'P1',
  QUESTION_TRUNCATED: 'P1',
  LAYOUT_UNEXPECTED: 'P1',
  SAME_QUESTION_DIFFERENT_ANSWER: 'P1',
  SAME_QUESTION_DIFFERENT_OPTIONS: 'P1',
  EXPLANATION_EMPTY: 'P2',
  EXPLANATION_TOO_SHORT: 'P2',
  EXPLANATION_TRUNCATED: 'P2',
  ANSWER_EXPLANATION_CONFLICT: 'P1',
  OCR_GARBAGE_IN_EXPLANATION: 'P2',
  OCR_LOW_CONFIDENCE: 'P2',
  OPTION_LABEL_DUPLICATED: 'P2',
  OPTION_LABEL_MISSING: 'P2',
  OPTION_ORDER_ABNORMAL: 'P2',
  OPTION_COUNT_UNEXPECTED: 'P0',
  OPTION_TEXT_SUSPECT: 'P2',
  UNUSUAL_CHARACTER_SEQUENCE: 'P2',
  EXACT_QUESTION_DUPLICATE: 'P2',
  NORMALIZED_QUESTION_DUPLICATE: 'P2',
});

const TYPE_TEXTS = new Set(['单选', '判断', '新规题']);
const NEGATION_TERMS = ['不', '不得', '不准', '禁止', '无需', '错误'];
const NUMERIC_PATTERN = /(?:\d|百分之|公里|千米|米|小时|分钟|秒|元|年|月|日|车道)/u;
const CALIBRATED_WARNING_CODES = new Set([
  'NEGATION_TERM_RISK',
  'NUMERIC_CONTENT_RISK',
  'QUESTION_TRUNCATED',
  'LAYOUT_UNEXPECTED',
  'OPTION_LABEL_MISSING',
  'OPTION_TEXT_SUSPECT',
  'EXACT_QUESTION_DUPLICATE',
  'NORMALIZED_QUESTION_DUPLICATE',
  'SAME_QUESTION_DIFFERENT_ANSWER',
  'SAME_QUESTION_DIFFERENT_OPTIONS',
]);

export function parseDrivingTheoryOcrRecord(record, { mediaPresent = false } = {}) {
  const page = Number(record.page);
  const entries = makeEntries(record);
  const warningCodes = new Set();
  if (record.status === 'BLOCKED') {
    warningCodes.add('OCR_EXECUTION_FAILED');
    return finalizeDraft({
      page,
      sourceQuestionType: 'UNRESOLVED',
      question: '',
      options: [],
      sourceAnswerSignal: null,
      correctAnswerDraft: null,
      explanation: '',
      imageRequired: false,
      derivedMediaCandidate: null,
      confidence: emptyConfidence(record),
      layoutVariant: 'UNRESOLVED',
      warningCodes,
      optionEvidence: [],
    });
  }

  const sourceQuestionType = entries.some((entry) => compact(entry.text) === '判断') ? 'TRUE_FALSE' : 'MC';
  const expectedOptionCount = sourceQuestionType === 'TRUE_FALSE' ? 2 : 4;
  const answerEntries = entries.filter((entry) => /答案\s*[A-D]/iu.test(entry.text.normalize('NFKC')));
  if (answerEntries.length === 0) warningCodes.add('ANSWER_MISSING');
  if (answerEntries.length > 1) warningCodes.add('ANSWER_AMBIGUOUS');
  const answerEntry = answerEntries[0] ?? null;
  const answerMatch = answerEntry?.text.normalize('NFKC').match(/答案\s*([A-D])/iu) ?? null;
  const sourceAnswerSignal = answerMatch?.[1]?.toUpperCase() ?? null;
  const answerIndex = sourceAnswerSignal ? sourceAnswerSignal.charCodeAt(0) - 65 : -1;

  const questionEntries = selectQuestionEntries(entries, answerEntry);
  const question = joinText(questionEntries);
  if (!question) warningCodes.add('QUESTION_EMPTY');
  if (questionLooksStructurallyTruncated(question)) warningCodes.add('QUESTION_TRUNCATED');
  if (semanticMarkerHasLowConfidence(questionEntries, (text) => NEGATION_TERMS.some((term) => text.includes(term)))) warningCodes.add('NEGATION_TERM_RISK');
  if (semanticMarkerHasLowConfidence(questionEntries, (text) => NUMERIC_PATTERN.test(text))) warningCodes.add('NUMERIC_CONTENT_RISK');
  if (/[?？!！]{2,}|[A-Za-z]{4,}\d|[�□■]{1,}/u.test(question)) warningCodes.add('UNUSUAL_CHARACTER_SEQUENCE');

  const answerY = answerEntry?.yMin ?? inferAnswerY(entries);
  const optionEvidence = selectOptionRows(entries, questionEntries, answerEntry, expectedOptionCount, answerY);
  const options = optionEvidence.map((row) => row.text);
  if (options.length !== expectedOptionCount) warningCodes.add('OPTION_COUNT_UNEXPECTED');
  optionEvidence.forEach((row) => {
    if (!row.text) warningCodes.add('OPTION_EMPTY');
    if (optionTextLooksSuspicious(row.text)) warningCodes.add('OPTION_TEXT_SUSPECT');
  });
  if (options.some((option) => !option)) warningCodes.add('OPTION_MISSING');
  if (new Set(options.filter(Boolean).map(normalizeQuestion)).size !== options.filter(Boolean).length) warningCodes.add('OPTION_TEXT_SUSPECT');
  const observedLabels = optionEvidence.flatMap((row) => row.observedLabels);
  if (new Set(observedLabels).size !== observedLabels.length) warningCodes.add('OPTION_LABEL_DUPLICATED');
  if (optionEvidence.some((row, index) => row.rowIndex !== index)) warningCodes.add('OPTION_ORDER_ABNORMAL');

  const correctAnswerDraft = answerIndex >= 0 && answerIndex < options.length ? options[answerIndex] : null;
  if (sourceAnswerSignal && !correctAnswerDraft) warningCodes.add('ANSWER_NOT_IN_OPTIONS');

  const explanationEntries = answerEntry
    ? entries.filter((entry) => entry.index > answerEntry.index && !isPageLabel(entry.text))
    : [];
  const explanation = joinText(explanationEntries);
  if (!explanation) warningCodes.add('EXPLANATION_EMPTY');
  if (explanation && normalizeQuestion(explanation).length < 6) warningCodes.add('EXPLANATION_TOO_SHORT');
  if (explanation && /[:：,，、/]$/u.test(explanation)) warningCodes.add('EXPLANATION_TRUNCATED');
  if (/[�□■]{1,}|[?？!！]{3,}/u.test(explanation)) warningCodes.add('OCR_GARBAGE_IN_EXPLANATION');
  const explanationAnswer = explanation.match(/(?:答案|选项|选择|选)\s*([A-D])/iu)?.[1]?.toUpperCase() ?? null;
  if (explanationAnswer && sourceAnswerSignal && explanationAnswer !== sourceAnswerSignal) warningCodes.add('ANSWER_EXPLANATION_CONFLICT');

  const firstOption = optionEvidence.find((row) => row.y !== null);
  const questionBottom = questionEntries.length ? Math.max(...questionEntries.map((entry) => entry.yMax)) : null;
  const imageGap = firstOption?.y !== null && questionBottom !== null ? firstOption.y - questionBottom : 0;
  const imageRequired = imageGap > 700;
  const imageWidth = Number(record.imageWidth ?? 2480);
  const imageHeight = Number(record.imageHeight ?? 3508);
  const cropY = questionBottom === null ? null : Math.max(220, Math.round(questionBottom + 70));
  const cropBottom = firstOption?.y === null ? null : Math.round(firstOption.y - 80);
  const cropRegion = imageRequired && cropY !== null && cropBottom !== null && cropBottom > cropY
    ? { x: 240, y: cropY, width: imageWidth - 480, height: cropBottom - cropY }
    : null;
  const derivedMediaCandidate = imageRequired && cropRegion
    ? {
        relativePath: `staging/driving-theory-user-source/media/draft-candidates/page-${String(page).padStart(3, '0')}-question.jpg`,
        cropRegion,
        derivationMethod: 'LOCAL_PIXEL_CROP_FROM_DECRYPTED_DCT_PAGE; NO_AI; NO_WATERMARK_REMOVAL; NO_COLOR_TRANSFORM',
        privateLocalOnly: true,
      }
    : null;
  if (imageRequired && (!cropRegion || !mediaPresent)) warningCodes.add('MEDIA_MISSING');

  const semanticEntries = [...questionEntries, ...optionEvidence.flatMap((row) => row.entries), ...(answerEntry ? [answerEntry] : []), ...explanationEntries];
  const confidence = confidenceEvidence(semanticEntries, record);
  if (confidence.minimum !== null && confidence.minimum < 0.8) warningCodes.add('OCR_LOW_CONFIDENCE');

  const rowSpacingOk = optionEvidence.every((row) => row.distanceFromExpected === null || row.distanceFromExpected <= 105);
  const assignedIndexes = new Set([
    ...questionEntries.map((entry) => entry.index),
    ...optionEvidence.flatMap((row) => row.entries.map((entry) => entry.index)),
  ]);
  const unassignedOptionText = entries.filter((entry) =>
    (!answerEntry || entry.index < answerEntry.index)
    && !assignedIndexes.has(entry.index)
    && !isHeader(entry.text)
    && !isOptionLabel(entry.text)
    && entry.xMin >= 250
    && normalizeQuestion(entry.text).length >= 2
    && !(imageRequired && cropRegion && entry.yMin >= cropRegion.y && entry.yMax <= cropRegion.y + cropRegion.height)
  );
  if (!answerEntry || !questionEntries.length || !rowSpacingOk || unassignedOptionText.length) warningCodes.add('LAYOUT_UNEXPECTED');
  if (options.some((option) => !option) || warningCodes.has('OPTION_LABEL_DUPLICATED') || warningCodes.has('OPTION_ORDER_ABNORMAL')) warningCodes.add('OPTION_LABEL_MISSING');
  const layoutVariant = `${sourceQuestionType}_${imageRequired ? 'IMAGE' : 'TEXT'}`;

  return finalizeDraft({
    page,
    sourceQuestionType,
    question,
    options,
    sourceAnswerSignal,
    correctAnswerDraft,
    explanation,
    imageRequired,
    derivedMediaCandidate,
    confidence,
    layoutVariant,
    warningCodes,
    optionEvidence: optionEvidence.map(({ entries: _entries, ...row }) => row),
    layoutEvidence: {
      rowSpacingOk,
      unassignedOptionTextCount: unassignedOptionText.length,
      unassignedOptionText: unassignedOptionText.map((entry) => entry.text),
    },
  });
}

export function applyDuplicateWarnings(drafts) {
  for (const draft of drafts) {
    draft.warningCodes = draft.warningCodes.filter((code) => ![
      'EXACT_QUESTION_DUPLICATE',
      'NORMALIZED_QUESTION_DUPLICATE',
      'SAME_QUESTION_DIFFERENT_ANSWER',
      'SAME_QUESTION_DIFFERENT_OPTIONS',
    ].includes(code));
  }
  const exactGroups = groupDuplicates(drafts, (draft) => duplicateIdentity(draft, false));
  const normalizedGroups = groupDuplicates(drafts, (draft) => duplicateIdentity(draft, true));
  const answerConflictGroups = [];
  const optionConflictGroups = [];
  for (const group of normalizedGroups) {
    const answers = new Set(group.map((draft) => draft.sourceAnswerSignal).filter(Boolean));
    const options = new Set(group.map((draft) => JSON.stringify(draft.options.map(normalizeQuestion))));
    if (answers.size > 1) answerConflictGroups.push(group);
    if (options.size > 1) optionConflictGroups.push(group);
  }
  for (const group of exactGroups) for (const draft of group) addWarning(draft, 'EXACT_QUESTION_DUPLICATE');
  for (const group of normalizedGroups) for (const draft of group) addWarning(draft, 'NORMALIZED_QUESTION_DUPLICATE');
  for (const group of answerConflictGroups) for (const draft of group) addWarning(draft, 'SAME_QUESTION_DIFFERENT_ANSWER');
  for (const group of optionConflictGroups) for (const draft of group) addWarning(draft, 'SAME_QUESTION_DIFFERENT_OPTIONS');
  drafts.forEach(recalculateDisposition);
  return {
    exactDuplicateGroups: exactGroups.length,
    normalizedDuplicateGroups: normalizedGroups.length,
    answerConflictGroups: answerConflictGroups.length,
    optionConflictGroups: optionConflictGroups.length,
  };
}

export function calibrateDrivingTheoryDraftWarnings(draft) {
  const previous = new Set(draft.warningCodes ?? []);
  draft.warningCodes = [...previous].filter((code) => !CALIBRATED_WARNING_CODES.has(code));
  const warningCodes = new Set(draft.warningCodes);
  const options = Array.isArray(draft.options) ? draft.options : [];
  const expectedOptionCount = draft.sourceQuestionType === 'TRUE_FALSE' ? 2 : draft.sourceQuestionType === 'MC' ? 4 : 0;

  if (questionLooksStructurallyTruncated(draft.question)) warningCodes.add('QUESTION_TRUNCATED');
  if (options.some(optionTextLooksSuspicious) || new Set(options.filter(Boolean).map(normalizeQuestion)).size !== options.filter(Boolean).length) warningCodes.add('OPTION_TEXT_SUSPECT');
  if (options.some((option) => !option) || warningCodes.has('OPTION_LABEL_DUPLICATED') || warningCodes.has('OPTION_ORDER_ABNORMAL')) warningCodes.add('OPTION_LABEL_MISSING');

  const optionLengths = options.filter(Boolean).map((option) => normalizeQuestion(option).length);
  const severeOptionLengthImbalance = optionLengths.length > 1 && Math.min(...optionLengths) <= 3 && Math.max(...optionLengths) >= 12;
  const manyRowsFarFromExpected = (draft.optionEvidence ?? []).filter((row) => Number(row.distanceFromExpected) > 80).length >= 3
    && optionLengths.some((length) => length >= 20);
  const persistedLayoutEvidence = draft.layoutEvidence
    ? draft.layoutEvidence.rowSpacingOk === false || Number(draft.layoutEvidence.unassignedOptionTextCount ?? 0) > 0
    : false;
  if (previous.has('LAYOUT_UNEXPECTED') && (
    warningCodes.has('QUESTION_TRUNCATED')
    || warningCodes.has('OPTION_MISSING')
    || warningCodes.has('OPTION_EMPTY')
    || severeOptionLengthImbalance
    || manyRowsFarFromExpected
    || persistedLayoutEvidence
  )) warningCodes.add('LAYOUT_UNEXPECTED');

  draft.warningCodes = [...warningCodes].sort();
  return recalculateDisposition(draft);
}

export function normalizeQuestion(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{Script=Han}a-z0-9%]+/gu, '');
}

export function chooseAutoPassSample(drafts, count = 24) {
  const candidates = drafts.filter((draft) => draft.qaDisposition === QaDisposition.AUTO_QA_CANDIDATE_PASS);
  const ranked = candidates.map((draft) => ({
    draft,
    stratum: `${draft.sourceQuestionType}:${draft.imageRequired ? 'IMAGE' : 'TEXT'}:${pageThird(draft.sourcePage)}`,
    rank: createHash('sha256').update(draft.sourceQuestionIdentity).digest('hex'),
  })).sort((left, right) => left.rank.localeCompare(right.rank));
  const selected = [];
  const used = new Set();
  for (const stratum of [...new Set(ranked.map((entry) => entry.stratum))].sort()) {
    const entry = ranked.find((candidate) => candidate.stratum === stratum);
    if (entry) {
      selected.push(entry.draft);
      used.add(entry.draft.sourcePage);
    }
  }
  for (const entry of ranked) {
    if (selected.length >= Math.min(count, candidates.length)) break;
    if (!used.has(entry.draft.sourcePage)) selected.push(entry.draft);
  }
  return selected;
}

export function recalculateDisposition(draft) {
  const priorities = draft.warningCodes.map((code) => WarningPriority[code]).filter(Boolean);
  draft.qaPriority = priorities.includes('P0') ? 'P0' : priorities.includes('P1') ? 'P1' : priorities.includes('P2') ? 'P2' : null;
  draft.qaDisposition = draft.warningCodes.includes('OCR_EXECUTION_FAILED') || draft.warningCodes.includes('QUESTION_EMPTY')
    ? QaDisposition.EXTRACTION_BLOCKED
    : priorities.length
      ? QaDisposition.MANUAL_QA_REQUIRED
      : QaDisposition.AUTO_QA_CANDIDATE_PASS;
  return draft;
}

function finalizeDraft({ page, sourceQuestionType, question, options, sourceAnswerSignal, correctAnswerDraft, explanation, imageRequired, derivedMediaCandidate, confidence, layoutVariant, warningCodes, optionEvidence, layoutEvidence = null }) {
  const draft = {
    schemaVersion: OCR_DRAFT_SCHEMA_VERSION,
    sourcePdfSha256: DRIVING_SOURCE_SHA256,
    sourcePage: page,
    sourceQuestionIdentity: `pdf:${DRIVING_SOURCE_SHA256}:page:${page}`,
    sourceQuestionType,
    canonicalContentType: 'multiple_choice',
    question,
    options,
    sourceAnswerSignal,
    correctAnswerDraft,
    explanation,
    imageRequired,
    derivedMediaCandidate,
    ocrConfidence: confidence,
    optionEvidence,
    layoutEvidence,
    layoutVariant,
    warningCodes: [...warningCodes].sort(),
    sourceClassification: 'USER_PROVIDED',
    sourceOriginClassification: 'THIRD_PARTY_SOURCE_UNVERIFIED',
    official: false,
    redistributionStatus: 'NOT_ESTABLISHED',
    nexaBundlingAllowed: false,
    privateLocalProcessing: true,
    draftOnly: true,
    formalImportAllowed: false,
  };
  return recalculateDisposition(draft);
}

function duplicateIdentity(draft, normalized) {
  const question = normalized ? normalizeQuestion(draft.question) : String(draft.question ?? '').trim();
  if (!question) return '';
  const options = (draft.options ?? []).map((option) => normalized ? normalizeQuestion(option) : String(option ?? '').trim());
  const mediaIdentity = draft.imageRequired
    ? draft.mediaIdentitySha256 ?? draft.derivedMediaCandidate?.sha256 ?? draft.derivedMediaCandidate?.contentSha256 ?? 'MEDIA_IDENTITY_MISSING'
    : 'TEXT_ONLY';
  return JSON.stringify([question, options, mediaIdentity]);
}

function questionLooksStructurallyTruncated(question) {
  const value = String(question ?? '').trim();
  if (!value) return false;
  const opens = (value.match(/[（(]/gu) ?? []).length;
  const closes = (value.match(/[）)]/gu) ?? []).length;
  return normalizeQuestion(value).length < 6 || /[:：,，、/（(]$/u.test(value) || opens !== closes;
}

function optionTextLooksSuspicious(option) {
  const value = String(option ?? '').trim();
  const normalized = normalizeQuestion(value);
  return !value || normalized.length < 2 || /^\d{3,}$/u.test(normalized);
}

function semanticMarkerHasLowConfidence(entries, markerPredicate) {
  return entries.some((entry) => markerPredicate(entry.text) && Number(entry.score) < 0.8);
}

function makeEntries(record) {
  return (record.lines ?? []).map((text, index) => {
    const box = record.boxes?.[index] ?? [];
    const xs = box.map((point) => Number(point[0]));
    const ys = box.map((point) => Number(point[1]));
    return {
      index,
      text: String(text).trim(),
      score: Number(record.scores?.[index] ?? 0),
      xMin: xs.length ? Math.min(...xs) : 0,
      yMin: ys.length ? Math.min(...ys) : index * 100,
      yMax: ys.length ? Math.max(...ys) : index * 100 + 60,
    };
  });
}

function selectQuestionEntries(entries, answerEntry) {
  const upper = answerEntry?.yMin ?? Number.POSITIVE_INFINITY;
  const candidates = entries.filter((entry) => entry.yMin < upper && entry.xMin >= 250 && !isHeader(entry.text) && !isOptionLabel(entry.text));
  const first = candidates.filter((entry) => entry.xMin >= 430 && entry.yMin <= 220).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)[0];
  if (!first) return [];
  const selected = candidates.filter((entry) => Math.abs(entry.yMin - first.yMin) <= 35).sort((a, b) => a.xMin - b.xMin);
  let lastY = Math.max(...selected.map((entry) => entry.yMin));
  for (const entry of candidates.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin)) {
    if (selected.includes(entry) || entry.yMin <= lastY + 35) continue;
    const gap = entry.yMin - lastY;
    if (gap > 175) break;
    selected.push(entry);
    lastY = entry.yMin;
  }
  return selected.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
}

function selectOptionRows(entries, questionEntries, answerEntry, count, answerY) {
  const questionIndexes = new Set(questionEntries.map((entry) => entry.index));
  const spacing = 252.5;
  const lastRowY = answerY - 350;
  return Array.from({ length: count }, (_, rowIndex) => {
    const expectedY = lastRowY - spacing * (count - rowIndex - 1);
    const nearby = entries.filter((entry) =>
      (!answerEntry || entry.index < answerEntry.index)
      && !questionIndexes.has(entry.index)
      && !isHeader(entry.text)
      && Math.abs(entry.yMin - expectedY) <= 105
    );
    const observedLabels = nearby.filter((entry) => isOptionLabel(entry.text)).map((entry) => compact(entry.text));
    const content = nearby.filter((entry) => !isOptionLabel(entry.text) && !isPageLabel(entry.text));
    return {
      rowIndex,
      effectiveLabel: String.fromCharCode(65 + rowIndex),
      observedLabels,
      text: joinText(content),
      y: content.length ? Math.min(...content.map((entry) => entry.yMin)) : null,
      expectedY: Math.round(expectedY),
      distanceFromExpected: content.length ? Math.round(Math.abs(Math.min(...content.map((entry) => entry.yMin)) - expectedY)) : null,
      entries: content,
    };
  });
}

function confidenceEvidence(entries, record) {
  const scores = entries.map((entry) => entry.score).filter(Number.isFinite);
  return {
    minimum: scores.length ? round(Math.min(...scores)) : null,
    mean: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    lineCount: scores.length,
    engineElapsedSeconds: Number(record.elapsedSeconds ?? 0),
  };
}

function emptyConfidence(record) {
  return { minimum: null, mean: null, lineCount: 0, engineElapsedSeconds: Number(record.elapsedSeconds ?? 0) };
}

function groupDuplicates(drafts, keyFn) {
  const groups = new Map();
  for (const draft of drafts) {
    const key = keyFn(draft);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(draft);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function addWarning(draft, code) {
  if (!draft.warningCodes.includes(code)) draft.warningCodes.push(code);
  draft.warningCodes.sort();
}

function joinText(entries) {
  return entries.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin).map((entry) => entry.text).join('').replace(/\s+/gu, ' ').trim();
}

function isHeader(text) {
  const value = compact(text);
  return TYPE_TEXTS.has(value) || isPageLabel(value);
}

function isPageLabel(text) {
  return /^第\d+页$/u.test(compact(text));
}

function isOptionLabel(text) {
  return /^[A-D]$/iu.test(compact(text));
}

function compact(text) {
  return String(text).normalize('NFKC').replace(/\s+/gu, '');
}

function inferAnswerY(entries) {
  return entries.length ? Math.max(...entries.map((entry) => entry.yMin)) - 400 : 2000;
}

function pageThird(page) {
  if (page <= 168) return 'FRONT';
  if (page <= 334) return 'MIDDLE';
  return 'BACK';
}

function round(value) {
  return Number(value.toFixed(5));
}
