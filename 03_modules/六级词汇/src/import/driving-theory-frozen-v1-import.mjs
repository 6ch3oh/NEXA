import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative } from 'node:path';
import {
  DRIVING_THEORY_USER_PDF_COLLECTION_ID,
  DRIVING_THEORY_USER_PDF_PILOT_ITEMS,
  DRIVING_THEORY_USER_PDF_SHA256,
  DRIVING_THEORY_USER_PDF_SOURCE_ID,
  DRIVING_THEORY_USER_PDF_TIMESTAMP,
} from './driving-theory-user-pdf-pilot.mjs';
import { createMultipleChoiceContent } from '../content/question-answer-content.mjs';
import { calculateStudyContentDigest, createStudyContentPackageManifest } from './study-content-package-contract.mjs';
import { GenericStudySourceClassification } from './generic-study-content-importer.mjs';
import { createStudyCollection, StudyCollectionType } from '../study/study-collection.mjs';

export const DRIVING_THEORY_FROZEN_V1_IMPORT_VERSION = '1.0';
export const DRIVING_THEORY_FROZEN_DATASET_ID = 'DRIVING_THEORY_FROZEN_DATASET_V1';
export const DRIVING_THEORY_FROZEN_DATASET_VERSION = '1.0.0';
export const DRIVING_THEORY_FROZEN_DATASET_SHA256 = 'a8e6323b7a83fd29ab2e757398171b3eaac9605c4ee0b48e45ac523f11298d31';
export const DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256 = '5ce16e3101d0c6f3c7808444812f3c90689d1a9f53ea246581ee7a8e8c6d8d9e';
export const DRIVING_THEORY_PRIVATE_COLLECTION_NAME = '科目一 · 我的资料';
export const DRIVING_THEORY_FROZEN_AT = '2026-08-23T00:00:00.000Z';

const FROZEN_RELATIVE_ROOT = join('staging', 'driving-theory-user-source', 'frozen', 'v1');
const pilotByContentId = new Map(DRIVING_THEORY_USER_PDF_PILOT_ITEMS.map((item) => [item.content.contentId, item]));

export async function loadDrivingTheoryFrozenV1({ moduleRoot, verifyMedia = true }) {
  requireAbsoluteDirectory(moduleRoot);
  const root = join(moduleRoot, FROZEN_RELATIVE_ROOT);
  const [dataset, freezeManifest, qaLedger] = await Promise.all([
    readJson(join(root, 'driving-theory-frozen-dataset-v1.json')),
    readJson(join(root, 'freeze-manifest.json')),
    readJson(join(root, 'final-qa-ledger.json')),
  ]);
  const packageData = createDrivingTheoryFrozenV1Package({ dataset, freezeManifest, qaLedger });
  const media = verifyMedia ? await verifyFrozenMedia({ moduleRoot, items: dataset.items }) : summarizeMedia(dataset.items);
  return Object.freeze({ ...packageData, media });
}

export function createDrivingTheoryFrozenV1Package({ dataset, freezeManifest, qaLedger }) {
  const integrity = verifyFrozenDocuments({ dataset, freezeManifest, qaLedger });
  const contents = Object.freeze(dataset.items.map(toFormalContent));
  const manifest = createStudyContentPackageManifest({
    packageId: 'driving-theory-private-frozen-v1',
    packageVersion: DRIVING_THEORY_FROZEN_DATASET_VERSION,
    collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
    contentType: 'multiple_choice',
    itemCount: contents.length,
    contentDigest: calculateStudyContentDigest(contents),
    provenance: {
      sourceId: DRIVING_THEORY_USER_PDF_SOURCE_ID,
      classification: GenericStudySourceClassification.USER_PROVIDED,
      title: '科目一精简500题＋新规题-先看我.pdf',
      official: false,
      publicExamAuthority: null,
      originUrl: null,
      licenseId: null,
      evidenceRefs: [
        `sha256:${DRIVING_THEORY_USER_PDF_SHA256}`,
        `frozen-dataset:${DRIVING_THEORY_FROZEN_DATASET_ID}:${DRIVING_THEORY_FROZEN_DATASET_SHA256}`,
        `qa-ledger:${DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256}`,
      ],
      acquiredAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
      permissions: { localStorage: true, modification: true, redistribution: false },
      notes: 'PRIVATE LOCAL ONLY; USER_PROVIDED; THIRD_PARTY_SOURCE_UNVERIFIED; official=false; redistribution NOT_ESTABLISHED; NEXA_BUNDLING_ALLOWED=false',
    },
    createdAt: DRIVING_THEORY_FROZEN_AT,
  });
  const collection = createStudyCollection({
    collectionId: DRIVING_THEORY_USER_PDF_COLLECTION_ID,
    type: StudyCollectionType.QUESTION_BANK,
    title: DRIVING_THEORY_PRIVATE_COLLECTION_NAME,
    description: '用户提供的第三方来源未验证资料，仅限本地私有学习；非官方内容，不随 NEXA 打包或再分发。',
    source: DRIVING_THEORY_USER_PDF_SOURCE_ID,
    createdAt: DRIVING_THEORY_USER_PDF_TIMESTAMP,
    updatedAt: DRIVING_THEORY_FROZEN_AT,
  });
  const itemByContentId = new Map(dataset.items.map((item) => [item.studyItemIdentity, item]));
  return Object.freeze({
    importVersion: DRIVING_THEORY_FROZEN_V1_IMPORT_VERSION,
    dataset,
    freezeManifest,
    qaLedger,
    integrity,
    contents,
    manifest,
    collection,
    packageInput: JSON.stringify({ schemaVersion: '0.1', contents }),
    getFrozenItem(contentId) { return itemByContentId.get(contentId) ?? null; },
  });
}

export function verifyFrozenDocuments({ dataset, freezeManifest, qaLedger }) {
  requireObject(dataset, 'dataset');
  requireObject(freezeManifest, 'freezeManifest');
  requireObject(qaLedger, 'qaLedger');
  const datasetHash = sha256(canonicalStringify(dataset.items));
  const { qaLedgerSha256: ledgerDeclaredHash, ...ledgerPayload } = qaLedger;
  const qaLedgerHash = sha256(canonicalStringify(ledgerPayload));
  assert(dataset.datasetId === DRIVING_THEORY_FROZEN_DATASET_ID, 'FROZEN_DATASET_ID_MISMATCH');
  assert(dataset.datasetVersion === DRIVING_THEORY_FROZEN_DATASET_VERSION, 'FROZEN_DATASET_VERSION_MISMATCH');
  assert(datasetHash === DRIVING_THEORY_FROZEN_DATASET_SHA256 && dataset.datasetSha256 === datasetHash, 'FROZEN_DATASET_SHA256_MISMATCH');
  assert(freezeManifest.CONTENT_HASH === datasetHash && freezeManifest.ITEM_COUNT === 500, 'FREEZE_MANIFEST_DATASET_MISMATCH');
  assert(freezeManifest.SOURCE_SHA256 === DRIVING_THEORY_USER_PDF_SHA256, 'SOURCE_SHA256_MISMATCH');
  assert(freezeManifest.SOURCE_CLASSIFICATION === 'USER_PROVIDED', 'SOURCE_CLASSIFICATION_MISMATCH');
  assert(freezeManifest.SOURCE_ORIGIN_CLASSIFICATION === 'THIRD_PARTY_SOURCE_UNVERIFIED', 'SOURCE_ORIGIN_CLASSIFICATION_MISMATCH');
  assert(freezeManifest.OFFICIAL === false && freezeManifest.NEXA_BUNDLING_ALLOWED === false, 'SOURCE_RIGHTS_BOUNDARY_MISMATCH');
  assert(ledgerDeclaredHash === DRIVING_THEORY_FROZEN_QA_LEDGER_SHA256 && qaLedgerHash === ledgerDeclaredHash, 'QA_LEDGER_SHA256_MISMATCH');
  assert(freezeManifest.QA_LEDGER_HASH === qaLedgerHash && qaLedger.finalStatus === 'PASS_500_FINAL_DISPOSITIONS_RECONCILED', 'QA_LEDGER_STATUS_MISMATCH');
  assert(dataset.items.length === 500 && new Set(dataset.items.map((item) => item.studyItemIdentity)).size === 500, 'FROZEN_ITEM_RECONCILIATION_FAILED');
  assert(dataset.items.every((item) => item.finalDisposition === 'QUALIFIED'), 'FROZEN_ITEM_NOT_QUALIFIED');
  assert(dataset.questionTypeCounts.MC === 303 && dataset.questionTypeCounts.TRUE_FALSE === 197, 'FROZEN_QUESTION_TYPE_COUNT_MISMATCH');
  assert(dataset.imageRequiredCount === 147 && dataset.textOnlyCount === 353, 'FROZEN_MEDIA_COUNT_MISMATCH');
  assert(dataset.items.filter((item) => item.pilotIdentityPreserved).length === 20, 'PILOT_20_IDENTITY_COUNT_MISMATCH');
  for (const frozen of dataset.items.filter((item) => item.pilotIdentityPreserved)) {
    const pilot = pilotByContentId.get(frozen.studyItemIdentity);
    assert(pilot, `PILOT_IDENTITY_MISSING:${frozen.studyItemIdentity}`);
    assert(frozen.sourceQuestionIdentity === pilot.sourceQuestionIdentity, `PILOT_SOURCE_IDENTITY_MISMATCH:${frozen.studyItemIdentity}`);
    assert(frozen.question === pilot.content.question, `PILOT_QUESTION_MISMATCH:${frozen.studyItemIdentity}`);
    assert(canonicalStringify(frozen.options) === canonicalStringify(pilot.content.options), `PILOT_OPTIONS_MISMATCH:${frozen.studyItemIdentity}`);
    assert(frozen.correctAnswer === pilot.content.correctAnswer, `PILOT_ANSWER_MISMATCH:${frozen.studyItemIdentity}`);
  }
  return Object.freeze({
    status: 'PASS',
    datasetIdentityMatch: true,
    qaLedgerIdentityMatch: true,
    datasetSha256: datasetHash,
    qaLedgerSha256: qaLedgerHash,
    itemCount: 500,
    pilotIdentityPreserved: true,
  });
}

export async function resolveFrozenMediaPath({ moduleRoot, frozenItem }) {
  if (!frozenItem?.imageRequired) return null;
  const page = String(frozenItem.sourcePage).padStart(3, '0');
  const relativePath = frozenItem.media?.relativePath
    ?? join('staging', 'driving-theory-user-source', 'derived-media', `page-${page}-question.jpg`);
  const absolutePath = normalize(join(moduleRoot, relativePath));
  assert(isInside(moduleRoot, absolutePath), `MEDIA_PATH_OUTSIDE_MODULE:${frozenItem.studyItemIdentity}`);
  return absolutePath;
}

async function verifyFrozenMedia({ moduleRoot, items }) {
  const rows = [];
  for (const item of items.filter((candidate) => candidate.imageRequired)) {
    const absolutePath = await resolveFrozenMediaPath({ moduleRoot, frozenItem: item });
    const bytes = await readFile(absolutePath);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    assert(actualSha256 === item.mediaIdentitySha256, `MEDIA_SHA256_MISMATCH:${item.studyItemIdentity}`);
    rows.push(Object.freeze({ contentId: item.studyItemIdentity, sourcePage: item.sourcePage, absolutePath, sha256: actualSha256, bytes: bytes.length }));
  }
  assert(rows.length === 147 && new Set(rows.map((row) => row.sha256)).size === 147, 'MEDIA_IDENTITY_RECONCILIATION_FAILED');
  return Object.freeze({ status: 'PASS', count: rows.length, uniqueIdentityCount: 147, rows: Object.freeze(rows) });
}

function summarizeMedia(items) {
  const rows = items.filter((item) => item.imageRequired);
  return Object.freeze({ status: 'NOT_READ', count: rows.length, uniqueIdentityCount: new Set(rows.map((item) => item.mediaIdentitySha256)).size, rows: Object.freeze([]) });
}

function toFormalContent(item) {
  if (item.pilotIdentityPreserved) return pilotByContentId.get(item.studyItemIdentity).content;
  return createMultipleChoiceContent({
    contentId: item.studyItemIdentity,
    contentType: 'multiple_choice',
    question: item.question,
    answer: item.correctAnswer,
    options: item.options,
    correctAnswer: item.correctAnswer,
    explanation: item.explanation,
    tags: [
      'user-provided', 'third-party-source-unverified', 'private-local-full-pack',
      item.sourceQuestionType === 'TRUE_FALSE' ? 'source-true-false' : 'source-mc',
      item.imageRequired ? 'required-question-media' : 'text-only',
    ],
    sourceRef: `${DRIVING_THEORY_USER_PDF_SOURCE_ID}:page:${item.sourcePage}`,
    createdAt: DRIVING_THEORY_FROZEN_AT,
    updatedAt: DRIVING_THEORY_FROZEN_AT,
  });
}

function canonicalStringify(value) { return JSON.stringify(canonicalize(value)); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function sha256(text) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function requireObject(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} object required`); }
function assert(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function requireAbsoluteDirectory(value) { if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError('absolute moduleRoot required'); }
function isInside(root, target) { const rel = relative(normalize(root), normalize(target)); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); }
async function readJson(filePath) { return JSON.parse(await readFile(filePath, 'utf8')); }
