import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const NOTIFICATION_RECONCILIATION_VERSION = '0.1.0';
export const TRANSACTION_TYPES = Object.freeze(['expense', 'income', 'refund', 'transfer', 'repayment', 'non_transaction', 'ambiguous']);

function bounded(value, max = 160) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function idFor(ids) { return `txn:${createHash('sha256').update([...ids].sort().join('\u0000')).digest('hex')}`; }
function normalizedMerchant(value) { return bounded(value, 120).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
function instant(value) { const result = Date.parse(value); return Number.isFinite(result) ? result : null; }

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new TypeError('candidate must be an object'), { code: 'INVALID_NOTIFICATION_CANDIDATE' });
  const eventId = bounded(value.event_id || value.eventId, 200);
  const amountMinor = Number(value.amount_minor ?? value.amountCents);
  const type = TRANSACTION_TYPES.includes(value.transaction_type || value.type) ? value.transaction_type || value.type : 'ambiguous';
  if (!eventId) throw Object.assign(new TypeError('event id is required'), { code: 'INVALID_NOTIFICATION_CANDIDATE' });
  return Object.freeze({
    event_id: eventId, occurred_at: bounded(value.occurred_at || value.occurredAt, 64), timestamp: instant(value.occurred_at || value.occurredAt),
    amount_minor: Number.isSafeInteger(amountMinor) ? amountMinor : null, currency: bounded(value.currency, 3).toUpperCase() || 'CNY',
    merchant: bounded(value.merchant, 120), platform: bounded(value.platform, 64), order_id: bounded(value.order_id || value.orderId, 120),
    card_tail: bounded(value.card_tail || value.cardTail, 12), transaction_type: type,
    category: bounded(value.category, 64) || 'other', manual_category: bounded(value.manual_category || value.manualCategory, 64),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)), source_record_ref: bounded(value.source_record_ref || value.sourceReference, 300),
    sensitivity: value.sensitivity === 'restricted' || value.sensitivity === 'RESTRICTED' ? 'restricted' : 'normal',
  });
}

function matches(left, right, windowMs) {
  if (left.order_id && right.order_id) return left.order_id === right.order_id;
  if (left.amount_minor == null || right.amount_minor == null || left.amount_minor !== right.amount_minor || left.currency !== right.currency) return false;
  if (left.timestamp == null || right.timestamp == null || Math.abs(left.timestamp - right.timestamp) > windowMs) return false;
  if (left.card_tail && right.card_tail && left.card_tail === right.card_tail) return true;
  const leftMerchant = normalizedMerchant(left.merchant); const rightMerchant = normalizedMerchant(right.merchant);
  return Boolean(leftMerchant && rightMerchant && (leftMerchant.includes(rightMerchant) || rightMerchant.includes(leftMerchant)));
}

export function reconcileNotificationTransactions(values, { windowMs = 120_000 } = {}) {
  const candidates = (Array.isArray(values) ? values : []).map(normalizeCandidate);
  const parents = candidates.map((_, index) => index);
  const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (a, b) => { const left = find(a); const right = find(b); if (left !== right) parents[right] = left; };
  for (let left = 0; left < candidates.length; left += 1) for (let right = left + 1; right < candidates.length; right += 1) if (matches(candidates[left], candidates[right], windowMs)) union(left, right);
  const groups = new Map();
  candidates.forEach((candidate, index) => { const key = find(index); groups.set(key, [...(groups.get(key) || []), candidate]); });
  return Object.freeze([...groups.values()].map((evidence) => {
    const primary = [...evidence].sort((a, b) => Number(Boolean(b.order_id)) - Number(Boolean(a.order_id)) || b.confidence - a.confidence)[0];
    const manual = evidence.find((item) => item.manual_category);
    return Object.freeze({
      reconciliation_version: NOTIFICATION_RECONCILIATION_VERSION,
      transaction_id: idFor(evidence.map((item) => item.event_id)),
      primary: Object.freeze({
        transaction_type: primary.transaction_type, amount_minor: primary.amount_minor, currency: primary.currency,
        occurred_at: primary.occurred_at, merchant: primary.merchant, platform: primary.platform, order_id: primary.order_id || null,
        card_tail: primary.card_tail || null, category: manual?.manual_category || primary.category,
        category_source: manual ? 'manual' : 'deterministic', confidence: primary.confidence,
      }),
      evidence_refs: Object.freeze(evidence.map((item) => Object.freeze({ event_id: item.event_id, platform: item.platform, source_record_ref: item.source_record_ref }))),
    });
  }));
}

export function createNotificationBatchProcessor({ checkpointPath, processor, clock = () => new Date().toISOString() } = {}) {
  if (!path.isAbsolute(checkpointPath || '') || typeof processor !== 'function') throw new TypeError('checkpointPath and processor are required');
  let state = { version: 1, processed: {}, failed: {}, ai_pending: {} };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) }; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  function save() {
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true }); const temporary = `${checkpointPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), 'utf8'); fs.renameSync(temporary, checkpointPath);
  }
  return Object.freeze({
    async run(values, { limit = 100, aiAvailable = false } = {}) {
      const pending = (Array.isArray(values) ? values : []).map(normalizeCandidate)
        .filter((item) => !state.processed[item.event_id]).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit);
      for (const item of pending) {
        try {
          const result = await processor(item);
          state.processed[item.event_id] = { at: clock(), result: bounded(result?.status || 'processed', 64) };
          if (!aiAvailable && item.transaction_type === 'ambiguous' && item.sensitivity === 'normal') state.ai_pending[item.event_id] = { queued_at: clock() };
          if (item.sensitivity === 'restricted') delete state.ai_pending[item.event_id];
        } catch (error) { state.failed[item.event_id] = { at: clock(), code: bounded(error?.code || 'PROCESS_FAILED', 64) }; }
        save();
      }
      return Object.freeze({ processed: Object.keys(state.processed).length, pending: Math.max(0, values.length - Object.keys(state.processed).length), failed: Object.keys(state.failed).length, ai_pending: Object.keys(state.ai_pending).length });
    },
    snapshot() { return structuredClone(state); },
  });
}
