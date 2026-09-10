import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DRIVING_THEORY_USER_PDF_PILOT_ITEMS } from '../src/import/driving-theory-user-pdf-pilot.mjs';

const root = new URL('../staging/driving-theory-user-source/frozen/v1/', import.meta.url);
const dataset = JSON.parse(await readFile(new URL('driving-theory-frozen-dataset-v1.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('freeze-manifest.json', root), 'utf8'));
const ledger = JSON.parse(await readFile(new URL('final-qa-ledger.json', root), 'utf8'));
const manualEvidence = JSON.parse(await readFile(new URL('manual-qa-evidence.json', root), 'utf8'));
const autoEvidence = JSON.parse(await readFile(new URL('auto-freeze-sample-evidence.json', root), 'utf8'));
const duplicateAudit = JSON.parse(await readFile(new URL('duplicate-conflict-final-audit.json', root), 'utf8'));
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');

test('all 40 manual pages have complete source visual checks and final dispositions', () => {
  assert.equal(manualEvidence.rows.length, 40);
  assert.deepEqual(manualEvidence.summary, {
    P0: 4, P1: 18, P2: 18,
    qualified: 40, qualifiedWithSourceWarning: 0, rejected: 0,
    correctionAppliedCount: 35, userDecisionRequiredCount: 0,
  });
  assert.ok(manualEvidence.rows.every((row) => row.finalDisposition === 'QUALIFIED'));
  assert.ok(manualEvidence.rows.every((row) => Object.values(row.checks).every(Boolean)));
});

test('500 final dispositions reconcile with no process states or silent drops', () => {
  assert.equal(dataset.items.length, 500);
  assert.equal(dataset.qualifiedCount + dataset.qualifiedWithSourceWarningCount + dataset.rejectedCount, 500);
  assert.equal(new Set(dataset.items.map((item) => item.sourcePage)).size, 500);
  assert.ok(dataset.items.every((item) => ['QUALIFIED', 'QUALIFIED_WITH_SOURCE_WARNING', 'REJECTED'].includes(item.finalDisposition)));
  assert.ok(dataset.items.every((item) => !['MANUAL_QA_REQUIRED', 'AUTO_QA_CANDIDATE_PASS'].includes(item.finalDisposition)));
});

test('dataset and QA ledger hashes are stable and independently reproducible', () => {
  assert.equal(sha256(canonicalStringify(dataset.items)), dataset.datasetSha256);
  const { qaLedgerSha256, ...ledgerPayload } = ledger;
  assert.equal(sha256(canonicalStringify(ledgerPayload)), qaLedgerSha256);
  assert.equal(manifest.CONTENT_HASH, dataset.datasetSha256);
  assert.equal(manifest.QA_LEDGER_HASH, qaLedgerSha256);
});

test('freeze manifest is complete, private-local and explicitly not imported', () => {
  assert.equal(manifest.DATASET_ID, 'DRIVING_THEORY_FROZEN_DATASET_V1');
  assert.equal(manifest.DATASET_VERSION, '1.0.0');
  assert.equal(manifest.ITEM_COUNT, 500);
  assert.equal(manifest.QUALIFIED_COUNT, 500);
  assert.equal(manifest.WARNING_COUNT, 0);
  assert.equal(manifest.REJECTED_COUNT, 0);
  assert.match(manifest.CONTENT_HASH, /^[a-f0-9]{64}$/);
  assert.match(manifest.MEDIA_HASH_SUMMARY.aggregateSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.QA_LEDGER_HASH, /^[a-f0-9]{64}$/);
  assert.equal(manifest.PRIVATE_LOCAL_ONLY, true);
  assert.equal(manifest.NEXA_BUNDLING_ALLOWED, false);
  assert.equal(manifest.FORMAL_IMPORT_PERFORMED, false);
  assert.equal(manifest.DRIVING_COLLECTION_COUNT, 20);
  assert.match(gitignore, /^staging\/driving-theory-user-source\/frozen\/$/m);
});

test('Pilot 20 study and source identities are preserved exactly', () => {
  const frozenPilot = dataset.items.filter((item) => item.pilotIdentityPreserved);
  assert.equal(frozenPilot.length, 20);
  assert.deepEqual(frozenPilot.map((item) => item.studyItemIdentity), DRIVING_THEORY_USER_PDF_PILOT_ITEMS.map((item) => item.content.contentId));
  assert.deepEqual(frozenPilot.map((item) => item.sourceQuestionIdentity), DRIVING_THEORY_USER_PDF_PILOT_ITEMS.map((item) => item.sourceQuestionIdentity));
  assert.equal(manifest.PILOT_20_IDENTITY_PRESERVED, true);
});

test('true duplicate/conflict audit uses question, options and media identity', () => {
  assert.equal(duplicateAudit.identityRule, 'NORMALIZED_QUESTION + ORDERED_OPTIONS_IDENTITY + MEDIA_SHA256');
  assert.equal(duplicateAudit.auditedItemCount, 500);
  assert.equal(duplicateAudit.trueDuplicateCount, 0);
  assert.equal(duplicateAudit.trueAnswerConflictCount, 0);
  assert.equal(duplicateAudit.duplicateDisposition, 'NONE_REQUIRED');
});

test('64-page auto evidence is stratified and the zero-defect gate passes', () => {
  assert.ok(autoEvidence.count >= 60);
  assert.deepEqual(Object.keys(autoEvidence.layoutBreakdown).sort(), ['MC_IMAGE', 'MC_TEXT', 'TRUE_FALSE_IMAGE', 'TRUE_FALSE_TEXT']);
  assert.ok((autoEvidence.pdfThirdBreakdown.FRONT ?? 0) > 0);
  assert.ok((autoEvidence.pdfThirdBreakdown.MIDDLE ?? 0) > 0);
  assert.ok((autoEvidence.pdfThirdBreakdown.BACK ?? 0) > 0);
  assert.ok(Object.keys(autoEvidence.imageCategoryBreakdown).length >= 7);
  assert.equal(autoEvidence.materialDefectCount, 0);
  assert.equal(autoEvidence.systemicQaGapFound, false);
  assert.equal(autoEvidence.gate, 'PASS_ZERO_MATERIAL_DEFECTS');
  assert.ok(autoEvidence.rows.every((row) => Object.values(row.checks).every(Boolean)));
});

test('final counts and required media identities match the authoritative 500-item baseline', () => {
  assert.deepEqual(dataset.questionTypeCounts, { MC: 303, TRUE_FALSE: 197 });
  assert.equal(dataset.imageRequiredCount, 147);
  assert.equal(dataset.textOnlyCount, 353);
  assert.equal(dataset.items.filter((item) => item.imageRequired).length, 147);
  assert.ok(dataset.items.filter((item) => item.imageRequired).every((item) => /^[a-f0-9]{64}$/.test(item.mediaIdentitySha256)));
  assert.equal(ledger.finalStatus, 'PASS_500_FINAL_DISPOSITIONS_RECONCILED');
});

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
