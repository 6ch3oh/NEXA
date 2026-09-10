import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createInMemoryExpenseRepository, createMobileExpenseDraftWorkflow } from '../src/index.mjs';

function safeDraft(overrides = {}) {
  const ref = 'a'.repeat(64);
  return {
    draftId: `mobile:${ref}`,
    sourceReference: ref,
    receivedAt: '2026-09-02T08:00:00.000Z',
    occurredAt: '2026-09-02',
    amountCents: 1280,
    currency: 'CNY',
    merchant: '测试商户',
    direction: 'expense',
    category: 'other',
    platform: 'wechat',
    sourceApplication: 'com.tencent.mm',
    confidence: 0.92,
    parserVersion: '1.0',
    ...overrides,
  };
}

function workflow() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-mobile-drafts-'));
  const repository = createInMemoryExpenseRepository();
  const filePath = path.join(directory, 'drafts.json');
  const instance = createMobileExpenseDraftWorkflow({
    filePath,
    repository,
    now: () => '2026-09-02T08:30:00.000Z',
  });
  return { instance, repository, directory, filePath };
}

function platformDraft(platform, marker, overrides = {}) {
  const sourceReference = marker.repeat(64);
  return safeDraft({
    draftId: `mobile:${sourceReference}`,
    sourceReference,
    platform,
    sourceApplication: `synthetic.${platform}`,
    merchant: `${platform} synthetic merchant`,
    ...overrides,
  });
}

test('mobile notification becomes an idempotent pending draft and not a statistic', () => {
  const state = workflow();
  try {
    const first = state.instance.createDraft(safeDraft());
    const duplicate = state.instance.createDraft(safeDraft());
    assert.equal(first.created, true);
    assert.equal(first.draft.status, 'PENDING');
    assert.equal(duplicate.duplicate, true);
    assert.equal(state.repository.list().length, 0);
    assert.equal(first.draft.sourceApplication, 'com.tencent.mm');
    assert.equal(JSON.stringify(first).includes('raw_text'), false);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('edit, confirm and undo are explicit and reversible', () => {
  const state = workflow();
  try {
    const created = state.instance.createDraft(safeDraft());
    state.instance.updateDraft(created.draft.draftId, { merchant: '修正商户', category: 'food' });
    const confirmed = state.instance.confirmDraft(created.draft.draftId);
    assert.equal(confirmed.draft.status, 'CONFIRMED');
    assert.equal(state.repository.list()[0].merchant, '修正商户');
    assert.equal(state.repository.list()[0].category, 'food');
    const restored = state.instance.undoDraft(created.draft.draftId);
    assert.equal(restored.status, 'PENDING');
    assert.equal(state.repository.list().length, 0);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('ignore can be undone and unsafe fields or identities are refused', () => {
  const state = workflow();
  try {
    const created = state.instance.createDraft(safeDraft());
    assert.equal(state.instance.ignoreDraft(created.draft.draftId).status, 'IGNORED');
    assert.equal(state.instance.undoDraft(created.draft.draftId).status, 'PENDING');
    assert.throws(
      () => state.instance.updateDraft(created.draft.draftId, { rawText: 'secret' }),
      (error) => error.code === 'INVALID_MOBILE_DRAFT_EDIT',
    );
    assert.throws(
      () => state.instance.createDraft(safeDraft({ draftId: 'device-a:event-1' })),
      (error) => error.code === 'INVALID_MOBILE_DRAFT',
    );
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('automatic import accepts WeChat, Alipay, and bank drafts with non-user-confirmed provenance', () => {
  const state = workflow();
  try {
    for (const [platform, marker] of [['wechat', 'a'], ['alipay', 'b'], ['bank', 'c']]) {
      const result = state.instance.autoImportDraft(platformDraft(platform, marker));
      assert.equal(result.created, true, platform);
      assert.equal(result.imported, true, platform);
      assert.equal(result.skipped, false, platform);
      assert.equal(result.draft.status, 'CONFIRMED', platform);
      assert.equal(result.draft.importMode, 'automatic', platform);
      assert.equal(result.draft.canRemove, true, platform);
      assert.equal(result.draft.canUndo, false, platform);
      assert.equal(result.record.platform, platform);
      assert.match(result.record.note, /自动计入/);
      assert.doesNotMatch(result.record.note, /用户确认/);
      assert.equal(result.metadata.source.provenance.userConfirmed, false);
      assert.equal(result.metadata.source.provenance.importMode, 'automatic');
      assert.equal(result.metadata.confidence.confirmed, false);
      assert.equal(result.metadata.classification.confirmed, false);
      assert.equal(result.metadata.classification.source, 'rule');
      assert.equal(result.metadata.classification.method, 'deterministic_rule');
    }
    assert.deepEqual(
      state.repository.list().map((record) => record.platform).sort(),
      ['alipay', 'bank', 'wechat'],
    );
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('automatic import is idempotent for an already confirmed mobile envelope', () => {
  const state = workflow();
  try {
    const input = platformDraft('wechat', 'd');
    const first = state.instance.autoImportDraft(input);
    const beforeReplay = state.repository.list();
    const replay = state.instance.autoImportDraft({ ...input, merchant: 'replay must not overwrite' });
    assert.equal(first.imported, true);
    assert.equal(replay.created, false);
    assert.equal(replay.imported, false);
    assert.equal(replay.skipped, false);
    assert.equal(replay.repaired, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.draft.status, 'CONFIRMED');
    assert.deepEqual(state.repository.list(), beforeReplay);
    assert.equal(state.repository.list().length, 1);
    assert.throws(
      () => state.instance.undoDraft(input.draftId),
      (error) => error.code === 'MOBILE_DRAFT_AUTO_IMPORTED',
    );
    assert.equal(state.repository.list().length, 1);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('a confirmed draft repairs a missing authoritative record before reporting imported', () => {
  const state = workflow();
  try {
    const input = platformDraft('alipay', '3');
    const first = state.instance.autoImportDraft(input);
    assert.equal(first.record !== null, true);
    assert.equal(state.repository.replaceAll([]).ok, true);
    assert.equal(state.repository.list().length, 0);

    const repaired = state.instance.autoImportDraft(input);
    assert.equal(repaired.created, false);
    assert.equal(repaired.imported, true);
    assert.equal(repaired.skipped, false);
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.record?.id, first.record.id);
    assert.equal(repaired.draft.status, 'CONFIRMED');
    assert.equal(repaired.draft.importMode, 'automatic');
    assert.equal(state.repository.list().length, 1);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('historic pending drafts migrate in one idempotent batch and ignored drafts stay ignored', () => {
  const state = workflow();
  try {
    state.instance.createDraft(platformDraft('wechat', 'e'));
    state.instance.createDraft(platformDraft('alipay', 'f'));
    const ignored = state.instance.createDraft(platformDraft('bank', '1'));
    state.instance.ignoreDraft(ignored.draft.draftId);

    const reloaded = createMobileExpenseDraftWorkflow({
      filePath: state.filePath,
      repository: state.repository,
      now: () => '2026-09-04T09:00:00.000Z',
    });
    const first = reloaded.autoImportPendingDrafts();
    assert.deepEqual(
      {
        attempted: first.attempted,
        imported: first.imported,
        duplicates: first.duplicates,
        failed: first.failed,
        remainingPending: first.remainingPending,
      },
      { attempted: 2, imported: 2, duplicates: 0, failed: 0, remainingPending: 0 },
    );
    assert.equal(state.repository.list().length, 2);
    assert.equal(reloaded.listDrafts({ status: 'CONFIRMED' }).every((draft) => draft.importMode === 'automatic'), true);
    assert.equal(reloaded.listDrafts({ status: 'IGNORED' }).length, 1);

    const replay = reloaded.autoImportPendingDrafts();
    assert.deepEqual(
      { attempted: replay.attempted, imported: replay.imported, failed: replay.failed },
      { attempted: 0, imported: 0, failed: 0 },
    );
    assert.equal(state.repository.list().length, 2);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('removing one imported record is terminal and the same envelope cannot revive it', () => {
  const state = workflow();
  try {
    const input = platformDraft('bank', '2');
    const imported = state.instance.autoImportDraft(input);
    const removed = state.instance.removeRecord(imported.record.id);
    assert.deepEqual(
      {
        removed: removed.removed,
        alreadyMissing: removed.alreadyMissing,
        linkedDraftCount: removed.linkedDraftCount,
      },
      { removed: true, alreadyMissing: false, linkedDraftCount: 1 },
    );
    assert.equal(state.repository.list().length, 0);
    const terminal = state.instance.listDrafts()[0];
    assert.equal(terminal.status, 'REMOVED');
    assert.equal(terminal.resolution, 'USER_REMOVED');
    assert.equal(terminal.canUndo, false);
    assert.equal(terminal.canRemove, false);

    const replay = state.instance.autoImportDraft(input);
    assert.equal(replay.imported, false);
    assert.equal(replay.skipped, true);
    assert.equal(replay.draft.status, 'REMOVED');
    assert.equal(state.repository.list().length, 0);
    assert.throws(
      () => state.instance.undoDraft(input.draftId),
      (error) => error.code === 'MOBILE_DRAFT_REMOVED',
    );
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('cross-app evidence within the payment window merges into one canonical transaction', () => {
  const state = workflow();
  try {
    const occurredAtEpochMs = 1_788_547_200_000;
    const alipay = platformDraft('alipay', '7', { occurredAtEpochMs, merchant: '星枢书店', evidenceReferences: ['7'.repeat(64)] });
    const bank = platformDraft('bank', '8', { occurredAtEpochMs: occurredAtEpochMs + 30_000, merchant: '支付宝-星枢书店', evidenceReferences: ['8'.repeat(64)] });
    const first = state.instance.autoImportDraft(alipay);
    const merged = state.instance.autoImportDraft(bank);
    assert.equal(first.imported, true);
    assert.equal(merged.duplicate, true);
    assert.equal(merged.draft.evidenceCount, 2);
    assert.deepEqual(merged.draft.sourceApplications.sort(), ['synthetic.alipay', 'synthetic.bank']);
    assert.equal(merged.draft.changeHistory.some((entry) => entry.action === 'EVIDENCE_MERGED'), true);
    assert.equal(state.repository.list().length, 1);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('low confidence remains pending while high confidence is eligible for automatic posting', () => {
  const state = workflow();
  try {
    state.instance.createDraft(platformDraft('wechat', '9', { confidence: 0.65 }));
    state.instance.createDraft(platformDraft('alipay', 'a', { confidence: 0.95 }));
    const result = state.instance.autoImportPendingDrafts();
    assert.equal(result.attempted, 1);
    assert.equal(state.instance.listDrafts({ status: 'PENDING' }).length, 1);
    assert.equal(state.instance.listDrafts({ status: 'CONFIRMED' }).length, 1);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('manual merge preserves deterministic facts and keeps both audit histories', () => {
  const state = workflow();
  try {
    const first = platformDraft('wechat', 'b', { confidence: 0.61, sourceApplication: 'com.tencent.mm' });
    const second = platformDraft('wechat', 'c', { confidence: 0.58, sourceApplication: 'com.example.merchant' });
    state.instance.createDraft(first);
    state.instance.createDraft(second);
    const merged = state.instance.mergeDrafts(first.draftId, second.draftId);
    assert.equal(merged.canonical.amountCents, first.amountCents);
    assert.equal(merged.canonical.evidenceCount, 2);
    assert.deepEqual(merged.canonical.sourceApplications.sort(), ['com.example.merchant', 'com.tencent.mm']);
    assert.equal(merged.canonical.changeHistory.at(-1).action, 'MANUAL_EVIDENCE_MERGED');
    assert.equal(merged.evidence.status, 'IGNORED');
    assert.equal(merged.evidence.resolution, 'MERGED_INTO');
    assert.equal(merged.evidence.changeHistory.at(-1).action, 'MERGED_INTO');
    assert.throws(
      () => state.instance.mergeDrafts(first.draftId, platformDraft('wechat', 'd', { amountCents: 1300 }).draftId),
      (error) => error.code === 'MOBILE_DRAFT_NOT_FOUND',
    );
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});
