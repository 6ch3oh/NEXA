import { createHash } from 'node:crypto';
import { deepFreeze, requireCanonicalIsoDateTime } from '../domain/shared.mjs';
import { createMultipleChoiceContent, createQuestionAnswerContent } from '../content/question-answer-content.mjs';

export const GENERIC_STUDY_CONTENT_IMPORTER_VERSION = '0.1';
export const GenericStudyImportFormat = Object.freeze({ JSON: 'JSON', CSV: 'CSV', MARKDOWN: 'MARKDOWN' });
export const GenericStudySourceClassification = Object.freeze({
  USER_PROVIDED: 'USER_PROVIDED', THIRD_PARTY: 'THIRD_PARTY', SYNTHETIC: 'SYNTHETIC', UNKNOWN_SOURCE: 'UNKNOWN_SOURCE',
});

export function createGenericStudySourceDescriptor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('source object required');
  if (!Object.values(GenericStudySourceClassification).includes(input.classification)) throw new TypeError('unsupported source classification');
  const sourceRef = requireText(input.sourceRef, 'source.sourceRef');
  const licenseId = optionalText(input.licenseId, 'source.licenseId');
  const evidenceRef = optionalText(input.evidenceRef, 'source.evidenceRef');
  if (input.classification === GenericStudySourceClassification.THIRD_PARTY && (licenseId === null || evidenceRef === null)) {
    throw new TypeError('THIRD_PARTY source requires licenseId and evidenceRef');
  }
  return deepFreeze({
    sourceVersion: GENERIC_STUDY_CONTENT_IMPORTER_VERSION,
    classification: input.classification,
    sourceRef,
    licenseId,
    evidenceRef,
    importedAt: requireCanonicalIsoDateTime(input.importedAt, 'source.importedAt'),
  });
}

export function createGenericStudyContentImporter({ format, catalog, source }) {
  if (!Object.values(GenericStudyImportFormat).includes(format)) throw new TypeError(`unsupported generic import format: ${format}`);
  if (typeof catalog?.addMany !== 'function' || typeof catalog?.get !== 'function') throw new TypeError('catalog addMany/get required');
  const descriptor = createGenericStudySourceDescriptor(source);

  function preview(input) {
    try {
      const raw = parseInput(format, input);
      const contents = raw.map((item, index) => createCanonicalContent(item, index, descriptor));
      const ids = contents.map((item) => item.contentId);
      if (new Set(ids).size !== ids.length) return failure('DUPLICATE_CONTENT_ID', 'input contains duplicate contentId');
      const conflicts = ids.filter((id) => catalog.get(id) !== null);
      if (conflicts.length > 0) return failure('CATALOG_CONFLICT', 'content already exists', { contentIds: conflicts });
      return deepFreeze({
        ok: true,
        importerVersion: GENERIC_STUDY_CONTENT_IMPORTER_VERSION,
        format,
        source: descriptor,
        contentCount: contents.length,
        contentDigest: createHash('sha256').update(JSON.stringify(contents)).digest('hex'),
        contents,
        mutationCount: 0,
      });
    } catch (error) {
      return failure('INVALID_CONTENT_IMPORT', error.message);
    }
  }

  function validate(input) {
    const result = preview(input);
    if (!result.ok) return result;
    const { contents, ...summary } = result;
    return deepFreeze(summary);
  }

  function importContents(input) {
    const result = preview(input);
    if (!result.ok) return result;
    try {
      catalog.addMany(result.contents);
      return deepFreeze({
        ok: true,
        importerVersion: GENERIC_STUDY_CONTENT_IMPORTER_VERSION,
        format,
        source: descriptor,
        importedCount: result.contentCount,
        contentIds: result.contents.map((item) => item.contentId),
        contentDigest: result.contentDigest,
      });
    } catch (error) {
      return failure('CATALOG_REJECTED', error.message);
    }
  }
  return Object.freeze({ importerVersion: GENERIC_STUDY_CONTENT_IMPORTER_VERSION, format, source: descriptor, validate, preview, import: importContents });
}

function createCanonicalContent(item, index, source) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`content[${index}] object required`);
  const input = { ...item, sourceRef: item.sourceRef ?? source.sourceRef };
  if (item.contentType === 'question_answer') return createQuestionAnswerContent(input);
  if (item.contentType === 'multiple_choice') return createMultipleChoiceContent(input);
  throw new TypeError(`content[${index}].contentType is unsupported`);
}

function parseInput(format, input) {
  if (typeof input !== 'string') throw new TypeError('import input must be a string');
  if (format === GenericStudyImportFormat.JSON) {
    let parsed;
    try { parsed = JSON.parse(input); } catch { throw new TypeError('invalid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schemaVersion !== '0.1' || !Array.isArray(parsed.contents)) {
      throw new TypeError('JSON root must contain schemaVersion 0.1 and contents array');
    }
    return parsed.contents;
  }
  if (format === GenericStudyImportFormat.CSV) return parseCsv(input);
  return parseMarkdown(input);
}

function parseCsv(input) {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new TypeError('CSV requires a header and at least one row');
  const header = rows[0];
  const required = ['contentId', 'contentType', 'question', 'answer', 'createdAt', 'updatedAt'];
  const allowed = new Set([...required, 'explanation', 'tags', 'sourceRef', 'options', 'correctAnswer']);
  required.forEach((field) => { if (!header.includes(field)) throw new TypeError(`CSV header missing ${field}`); });
  header.forEach((field) => { if (!allowed.has(field)) throw new TypeError(`CSV header contains unsupported field ${field}`); });
  if (new Set(header).size !== header.length) throw new TypeError('CSV header contains duplicate fields');
  return rows.slice(1).filter((row) => row.some((cell) => cell !== '')).map((row) => {
    if (row.length !== header.length) throw new TypeError('CSV row column count does not match header');
    const value = Object.fromEntries(header.map((key, index) => [key, row[index] ?? '']));
    return normalizeTextRecord(value);
  });
}

function parseCsvRows(input) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += character;
  }
  if (quoted) throw new TypeError('CSV contains an unclosed quote');
  if (cell !== '' || row.length > 0) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function parseMarkdown(input) {
  const sections = input.split(/^##\s+/mu).slice(1);
  if (sections.length === 0) throw new TypeError('Markdown requires sections beginning with ## contentId');
  return sections.map((section) => {
    const [idLine, ...lines] = section.split(/\r?\n/u);
    const raw = { contentId: idLine.trim() };
    const allowed = new Set(['type', 'contentType', 'question', 'answer', 'explanation', 'tags', 'sourceRef', 'createdAt', 'updatedAt', 'options', 'correctAnswer']);
    for (const line of lines) {
      const match = /^([A-Za-z]+):\s*(.*)$/u.exec(line.trim());
      if (match) {
        const key = match[1].charAt(0).toLowerCase() + match[1].slice(1);
        if (!allowed.has(key)) throw new TypeError(`Markdown contains unsupported field ${key}`);
        if (Object.hasOwn(raw, key)) throw new TypeError(`Markdown contains duplicate field ${key}`);
        raw[key] = match[2];
      }
    }
    return normalizeTextRecord(raw);
  });
}

function normalizeTextRecord(value) {
  return {
    contentId: value.contentId,
    contentType: value.contentType ?? value.type,
    question: value.question,
    answer: value.answer,
    explanation: value.explanation || null,
    tags: splitList(value.tags),
    sourceRef: value.sourceRef || undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.options ? { options: splitList(value.options), correctAnswer: value.correctAnswer || value.answer } : {}),
  };
}

function splitList(value) { return value ? String(value).split('|').map((item) => item.trim()).filter(Boolean) : []; }
function failure(code, message, details) { return deepFreeze({ ok: false, error: { code, message, ...(details ? { details } : {}) } }); }
function requireText(value, path) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${path} required`); return value.trim(); }
function optionalText(value, path) { return value == null ? null : requireText(value, path); }
