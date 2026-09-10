import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createNotificationBatchProcessor, reconcileNotificationTransactions } from '../src/services/notificationTransactionReconciler.mjs';

test('cross-app duplicates become one canonical transaction with every raw evidence reference', () => {
  const groups = reconcileNotificationTransactions([
    { event_id: 'alipay-1', occurred_at: '2026-09-05T01:00:00Z', amount_minor: 4280, currency: 'CNY', merchant: '星巴克咖啡', platform: 'alipay', type: 'expense', confidence: .8, source_record_ref: 'raw:alipay-1' },
    { event_id: 'bank-1', occurred_at: '2026-09-05T01:00:30Z', amount_minor: 4280, currency: 'CNY', merchant: '星巴克', platform: 'bank', type: 'expense', confidence: .95, source_record_ref: 'raw:bank-1' },
  ]);
  assert.equal(groups.length, 1); assert.equal(groups[0].evidence_refs.length, 2);
  assert.deepEqual(groups[0].evidence_refs.map((item) => item.event_id).sort(), ['alipay-1', 'bank-1']);
});

test('manual category has permanent priority while raw deterministic facts remain unchanged', () => {
  const [transaction] = reconcileNotificationTransactions([{ event_id: 'a', occurred_at: '2026-09-05T01:00:00Z', amount_minor: -500, currency: 'CNY', platform: 'bank', type: 'refund', category: 'other', manual_category: '售后退款', confidence: .9 }]);
  assert.equal(transaction.primary.category, '售后退款'); assert.equal(transaction.primary.category_source, 'manual');
  assert.equal(transaction.primary.amount_minor, -500); assert.equal(transaction.primary.transaction_type, 'refund');
});

test('checkpoint resumes and sensitive candidates never enter AI pending queue', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-notification-batch-')); const checkpointPath = path.join(root, 'checkpoint.json');
  const values = [
    { event_id: 'normal', occurred_at: '2026-09-05T01:00:00Z', type: 'ambiguous', sensitivity: 'normal' },
    { event_id: 'otp', occurred_at: '2026-09-05T01:01:00Z', type: 'ambiguous', sensitivity: 'restricted' },
  ];
  let calls = 0; const first = createNotificationBatchProcessor({ checkpointPath, processor: async () => { calls += 1; return { status: 'deterministic' }; } });
  assert.equal((await first.run(values, { aiAvailable: false })).ai_pending, 1); assert.equal(calls, 2);
  const resumed = createNotificationBatchProcessor({ checkpointPath, processor: async () => { calls += 1; } });
  await resumed.run(values); assert.equal(calls, 2);
});
