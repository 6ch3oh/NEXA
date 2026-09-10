import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../staging/driving-theory-user-source/', import.meta.url);
const draftDocument = JSON.parse(await readFile(new URL('drafts/draft-index.json', root), 'utf8'));
const ledgerDocument = JSON.parse(await readFile(new URL('qa/qa-ledger.json', root), 'utf8'));
const truthDocument = JSON.parse(await readFile(new URL('qa/calibration/visual-truth-set.json', root), 'utf8'));
const afterAudit = JSON.parse(await readFile(new URL('qa/calibration/warning-root-cause-audit-after.json', root), 'utf8'));
const draftByPage = new Map(draftDocument.items.map((item) => [item.sourcePage, item]));
const rowByPage = new Map(ledgerDocument.rows.map((item) => [item.PDF_PAGE, item]));

test('calibration truth set freezes required Gold, P0, P1, P2, auto and layout coverage', () => {
  assert.equal(truthDocument.reviewedPageCount, 183);
  assert.equal(truthDocument.coverage.gold, 20);
  assert.equal(truthDocument.coverage.p0, 4);
  assert.ok(truthDocument.coverage.p1 >= 60);
  assert.ok(truthDocument.coverage.p2 >= 30);
  assert.equal(truthDocument.coverage.autoPass, 24);
  assert.deepEqual(Object.keys(truthDocument.layoutBreakdown).sort(), ['MC_IMAGE', 'MC_TEXT', 'TRUE_FALSE_IMAGE', 'TRUE_FALSE_TEXT']);
  assert.equal(truthDocument.unknownWarningPageCount, 0);
});

test('all real P0 option and answer defects remain manual after calibration', () => {
  for (const page of [225, 230, 278, 355]) {
    const draft = draftByPage.get(page);
    assert.equal(draft.preFreezeQaDisposition, 'MANUAL_QA_REQUIRED');
    assert.equal(draft.preFreezeQaPriority, 'P0');
    assert.ok(draft.preFreezeWarningCodes.includes('OPTION_MISSING'));
    assert.equal(draft.qaDisposition, 'QUALIFIED');
    assert.equal(draft.finalDisposition, 'QUALIFIED');
  }
  assert.equal(ledgerDocument.summary.p0QaCount, 4);
});

test('visually proven false-positive examples no longer trigger presence, label, layout or duplicate warnings', () => {
  assert.ok(!draftByPage.get(92).warningCodes.includes('NUMERIC_CONTENT_RISK'));
  assert.ok(!draftByPage.get(126).warningCodes.includes('NEGATION_TERM_RISK'));
  assert.ok(!draftByPage.get(276).warningCodes.includes('OPTION_TEXT_SUSPECT'));
  assert.ok(!draftByPage.get(395).warningCodes.includes('LAYOUT_UNEXPECTED'));
  assert.ok(!draftByPage.get(395).warningCodes.includes('SAME_QUESTION_DIFFERENT_ANSWER'));
  assert.notEqual(draftByPage.get(395).mediaIdentitySha256, draftByPage.get(396).mediaIdentitySha256);
});

test('visually confirmed non-P0 defects remain in the manual queue', () => {
  for (const page of [21, 25, 32, 125, 156, 158, 179, 340, 347, 373, 496]) {
    assert.equal(draftByPage.get(page).preFreezeQaDisposition, 'MANUAL_QA_REQUIRED', `page ${page}`);
    assert.equal(draftByPage.get(page).qaDisposition, 'QUALIFIED', `page ${page}`);
  }
});

test('Gold 20 and post-calibration auto sample retain the safety boundary', () => {
  const goldRows = ledgerDocument.rows.filter((row) => row.PILOT_GOLD_REFERENCE);
  assert.equal(goldRows.length, 20);
  assert.ok(goldRows.every((row) => row.QA_DISPOSITION === 'AUTO_QA_CANDIDATE_PASS'));
  assert.ok(goldRows.every((row) => row.ANSWER_VALID && row.OPTION_COMPLETE && row.EXPLANATION_PRESENT));
  assert.equal(afterAudit.postCalibrationAutoSample.count, 24);
  assert.equal(afterAudit.postCalibrationAutoSample.visuallyChecked, 24);
  assert.equal(afterAudit.postCalibrationAutoSample.substantiveDefectCount, 0);
});

test('500-page reconciliation and no-import provenance remain unchanged', () => {
  assert.equal(rowByPage.size, 500);
  assert.equal(ledgerDocument.summary.qaLedgerStatus, 'PASS_500_PAGES_ACCOUNTED_FOR');
  assert.equal(ledgerDocument.summary.formalImportPerformed, false);
  assert.equal(ledgerDocument.summary.drivingCollectionCountAfterTask, 20);
  assert.equal(ledgerDocument.summary.externalNetworkActivity, 0);
  assert.equal(ledgerDocument.summary.runtimeNetworkDependency, 0);
});
