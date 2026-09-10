import assert from 'node:assert/strict';
import test from 'node:test';
import { createExpenseLocalAiAdapter } from '../src/services/expenseLocalAiAdapter.mjs';

const MODEL_ID = 'qwen3-4b-instruct-2507';
const RECORD = Object.freeze({
  id: 'r1', amountCents: 2350, currency: 'CNY', occurredAt: '2026-09-05', platform: 'wechat',
  sourceId: 'order-1', direction: 'expense', dedupeKey: 'src:wechat:order-1', merchant: '美团外卖', category: 'other',
  rawNotification: 'must never leave deterministic boundary',
});

function providerReturning(value) {
  return {
    getState() { return { model_id: MODEL_ID }; },
    async generateProposal() { return value; },
  };
}

test('AI suggestion preserves all deterministic fields and never receives raw evidence', async () => {
  let input;
  const adapter = createExpenseLocalAiAdapter({
    provider: { getState() { return { model_id: MODEL_ID }; }, async generateProposal(value) { input = value; return { suggested_category: '餐饮', suggested_display_name: '美团外卖', tags: ['外卖'], confidence: 0.92, reason: '商户语义' }; } },
    clock: () => '2026-09-05T01:00:00.000Z',
  });
  const result = await adapter.suggest(RECORD);
  assert.deepEqual(result.deterministic_fields, {
    id: 'r1', amountCents: 2350, currency: 'CNY', occurredAt: '2026-09-05', platform: 'wechat',
    sourceId: 'order-1', direction: 'expense', dedupeKey: 'src:wechat:order-1', merchant: '美团外卖', category: 'other',
  });
  assert.equal(result.source, 'local_ai');
  assert.equal(result.model_id, MODEL_ID);
  assert.equal(result.reason_identity, 'LOCAL_AI_SUGGESTION');
  assert.equal(result.category, '餐饮');
  assert.equal(result.confidence, 0.92);
  assert.equal(result.reason, '商户语义');
  assert.equal(result.status, 'SUGGESTED');
  assert.equal(result.category_source, 'local_ai');
  assert.equal(result.effective_category, '餐饮');
  assert.doesNotMatch(JSON.stringify(input), /rawNotification|must never/);
});

test('ambiguous merchant suggestion never invents card, order, platform, or amount facts', async () => {
  const ambiguous = { ...RECORD, merchant: '便利店', amountCents: 990, sourceId: 'ambiguous-1' };
  const adapter = createExpenseLocalAiAdapter({ provider: providerReturning({ suggested_category: 'other', suggested_display_name: '便利店', tags: [], confidence: 0.45, reason: '商户含义不明确' }) });
  const result = await adapter.suggest(ambiguous);
  assert.equal(result.status, 'PENDING_CONFIRMATION');
  assert.deepEqual(result.deterministic_fields.amountCents, 990);
  assert.equal(result.deterministic_fields.platform, 'wechat');
  assert.equal(result.deterministic_fields.sourceId, 'ambiguous-1');
  assert.deepEqual(Object.keys(result.suggestion).sort(), ['confidence', 'reason', 'suggested_category', 'suggested_display_name', 'tags']);
  assert.doesNotMatch(JSON.stringify(result.suggestion), /card|银行卡|order|订单|amountCents|platform/u);
});

test('low confidence suggestion remains pending for confirmation', async () => {
  const adapter = createExpenseLocalAiAdapter({ provider: providerReturning({ suggested_category: '餐饮', suggested_display_name: '', tags: [], confidence: 0.69, reason: '不确定' }) });
  const result = await adapter.suggest(RECORD);
  assert.equal(result.status, 'PENDING_CONFIRMATION');
  assert.equal(result.reviewed, false);
});

test('manual category permanently wins over an AI suggestion', async () => {
  const adapter = createExpenseLocalAiAdapter({ provider: providerReturning({ suggested_category: '餐饮', suggested_display_name: '', tags: [], confidence: 0.6, reason: 'fallback' }) });
  const result = await adapter.suggest(RECORD, { manualCategory: '工作报销' });
  assert.equal(result.effective_category, '工作报销');
  assert.equal(result.category_source, 'manual');
  assert.equal(result.reviewed, true);
  assert.equal(result.status, 'CONFIRMED_MANUAL');
});

test('natural language expense query is constrained to deterministic filters', async () => {
  const adapter = createExpenseLocalAiAdapter({ provider: providerReturning({ startDate: '2026-09-01', endDate: '2026-09-05', category: '餐饮', merchant: null, platform: null, direction: 'expense' }) });
  assert.deepEqual(await adapter.queryToFilter('本月餐饮支出'), { startDate: '2026-09-01', endDate: '2026-09-05', category: '餐饮', direction: 'expense' });
});
